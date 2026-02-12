import type { RadioBackend, RadioDriver } from '../core';

const ACK = 0x06;
const ACK_ALT = 0x05;
const MEM_SIZE = 0x4000;
const UPLOAD_MEM_SIZE = 0x3100;
const BLOCK_SIZE = 0x40;
const TX_BLOCK_SIZE = 0x10;
const IDENT_LENGTH = 50;
const EXTRA_ID_ADDR = 0x3df0;
const EXTRA_ID_LEN = 16;

const MAGIC = new Uint8Array([0x55, 0x20, 0x15, 0x09, 0x16, 0x45, 0x4d, 0x02]);

const asciiEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const FILE_IDS = [
  'M29154',
  'M2C234',
  'M2G1F4',
  'M2G2F4',
  'M2G304',
  'M2G314',
  'M2G424',
  'M27184',
  'M2C194'
].map(asciiEncode);

export interface KT8900DriverOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

export class KT8900Driver implements RadioDriver {
  private backend: RadioBackend;
  private connected = false;
  private dryRun: boolean;
  private log: (message: string) => void;

  constructor(backend: RadioBackend, options: KT8900DriverOptions = {}) {
    this.backend = backend;
    this.dryRun = options.dryRun ?? false;
    const shouldLog = this.dryRun || !!options.log;
    this.log = options.log ?? (shouldLog ? (msg: string) => console.log(msg) : () => {});
  }

  async connect(): Promise<void> {
    await this.backend.open();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.backend.close();
    this.connected = false;
  }

  async readCodeplug(): Promise<Uint8Array> {
    this.ensureConnected();
    await this.identifyWithRetry(false);

    const buffer = new Uint8Array(MEM_SIZE);
    for (let addr = 0; addr < MEM_SIZE; addr += BLOCK_SIZE) {
      const block = await this.readBlock(addr, BLOCK_SIZE);
      buffer.set(block, addr);
    }
    return buffer;
  }

  async writeCodeplug(data: Uint8Array): Promise<void> {
    this.ensureConnected();
    if (data.length < UPLOAD_MEM_SIZE) {
      throw new Error(`Codeplug is too small: ${data.length} bytes`);
    }

    await this.identifyWithRetry(true);

    for (let addr = 0; addr < UPLOAD_MEM_SIZE; addr += TX_BLOCK_SIZE) {
      const block = data.slice(addr, addr + TX_BLOCK_SIZE);
      if (this.dryRun) {
        this.log(
          `DRY-RUN write 0x${addr.toString(16).padStart(4, '0')}: ${bufferToHex(block)}`
        );
        continue;
      }
      await this.writeBlock(addr, block, addr === 0);
    }
  }

  private async identifyWithRetry(upload: boolean): Promise<void> {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.identifyOnce(upload);
        return;
      } catch (err) {
        if (attempt >= attempts || !isRetryableIdentError(err)) {
          throw err;
        }
        this.log(`KT8900: ident failed (attempt ${attempt}), retrying...`);
        await delay(500);
      }
    }
  }

  private async identifyOnce(upload: boolean): Promise<void> {
    this.log('KT8900: sending magic');
    await this.backend.write(MAGIC);

    const ident = await this.backend.readExactly(IDENT_LENGTH, 2000);
    if (ident[0] !== ACK) {
      throw new Error(`Bad ACK from radio: 0x${ident[0].toString(16)}`);
    }
    if (ident.length !== IDENT_LENGTH) {
      throw new Error(`Short ident block: ${ident.length} bytes`);
    }

    if (!FILE_IDS.some(id => containsSubarray(ident, id))) {
      throw new Error('Radio identification failed. Unsupported KT8900 ident.');
    }

    await delay(100);

    const extraFrame = buildFrame('S', EXTRA_ID_ADDR, EXTRA_ID_LEN);
    await this.backend.write(extraFrame);
    const extra = await this.backend.readExactly(1 + 4 + EXTRA_ID_LEN, 2000);
    const extraAck = extra[0];
    if (extraAck !== ACK && extraAck !== ACK_ALT) {
      throw new Error(`Bad ACK for extra ID block: 0x${extraAck.toString(16)}`);
    }
    if (extra.length < 1 + 4 + EXTRA_ID_LEN) {
      throw new Error(`Extra ID block is short: ${extra.length} bytes`);
    }

    if (upload) {
      await delay(300);
      await this.backend.write(new Uint8Array([ACK]));
      const ack = await readOptionalAck(this.backend, 2, 500);
      if (ack.length === 0 || ack[ack.length - 1] !== ACK) {
        throw new Error('Radio did not ACK upload mode');
      }
    }
  }

  private async readBlock(address: number, length: number): Promise<Uint8Array> {
    const frame = buildFrame('S', address, length);
    await this.backend.write(frame);

    const response = await this.backend.readExactly(1 + 4 + length, 2000);
    if (response[0] !== ACK) {
      throw new Error(`Bad ACK for read at 0x${address.toString(16)}`);
    }

    const cmd = response[1];
    const addr = (response[2] << 8) | response[3];
    const size = response[4];
    if (cmd !== 'X'.charCodeAt(0) || addr !== address || size !== length) {
      throw new Error(
        `Invalid header for block 0x${address.toString(16)}: ${bufferToHex(
          response.slice(1, 5)
        )}`
      );
    }

    return response.slice(5);
  }

  private async writeBlock(address: number, data: Uint8Array, omitLeadingAck: boolean) {
    if (data.length !== TX_BLOCK_SIZE) {
      throw new Error(`Invalid block size: ${data.length}`);
    }

    let frame = buildFrame('X', address, data.length, data);
    if (omitLeadingAck) {
      frame = frame.slice(1);
    }

    await this.backend.write(frame);
    const ack = await this.backend.readExactly(1, 1000);
    if (ack[0] !== ACK && ack[0] !== ACK_ALT) {
      throw new Error(
        `Bad ACK writing block 0x${address.toString(16)}: 0x${ack[0].toString(16)}`
      );
    }
  }

  private ensureConnected() {
    if (!this.connected) {
      throw new Error('Radio is not connected. Call connect() first.');
    }
  }
}

function buildFrame(
  command: 'S' | 'X',
  address: number,
  length: number,
  data?: Uint8Array
): Uint8Array {
  const header = new Uint8Array([
    ACK,
    command.charCodeAt(0),
    (address >> 8) & 0xff,
    address & 0xff,
    length & 0xff
  ]);
  if (!data || data.length === 0) {
    return header;
  }
  const out = new Uint8Array(header.length + data.length);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
}

async function readOptionalAck(
  backend: RadioBackend,
  maxBytes: number,
  timeoutMs: number
): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs;
  const out: number[] = [];
  for (let i = 0; i < maxBytes; i += 1) {
    const remaining = Math.max(1, deadline - Date.now());
    try {
      const byte = await backend.readExactly(1, remaining);
      out.push(byte[0]);
    } catch (err) {
      if (isTimeoutError(err)) {
        break;
      }
      throw err;
    }
  }
  return new Uint8Array(out);
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Timeout/i.test(err.message);
}

function bufferToHex(data: Uint8Array): string {
  return Array.from(data)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ');
}

function asciiEncode(value: string): Uint8Array {
  if (asciiEncoder) {
    return asciiEncoder.encode(value);
  }
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0x7f;
  }
  return out;
}

function containsSubarray(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableIdentError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Timeout|ACK|ident|upload/i.test(err.message);
}
