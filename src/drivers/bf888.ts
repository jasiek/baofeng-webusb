import type { RadioBackend, RadioDriver } from '../index';

const ACK = 0x06;
const BLOCK_SIZE = 8;
const MEM_SIZE = 0x03e0;
const IDENT_PREFIX = 'P3107';

const WRITE_RANGES: Array<{ start: number; end: number }> = [
  { start: 0x0000, end: 0x0110 },
  { start: 0x02b0, end: 0x02c0 },
  { start: 0x0380, end: 0x03e0 }
];

export type ChecksumValidator = (data: Uint8Array) => void;

export interface BF888DriverOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
  checksumValidators?: ChecksumValidator[];
}

export class BF888Driver implements RadioDriver {
  private backend: RadioBackend;
  private connected = false;
  private dryRun: boolean;
  private log: (message: string) => void;
  private checksumValidators: ChecksumValidator[];

  constructor(backend: RadioBackend, options: BF888DriverOptions = {}) {
    this.backend = backend;
    this.dryRun = options.dryRun ?? false;
    const shouldLog = this.dryRun || !!options.log;
    this.log = options.log ?? (shouldLog ? (msg: string) => console.log(msg) : () => {});
    this.checksumValidators = options.checksumValidators ?? [];
  }

  async connect(): Promise<void> {
    await this.backend.open();
    try {
      this.log('BF888: sending PROGRAM');
      await this.backend.write(new Uint8Array([0x02]));
      await delay(100);
      await this.backend.write(encodeCommand('PROGRAM'));
      await this.readUntilAck('PROGRAM');

      this.log('BF888: requesting ident');
      await this.backend.write(new Uint8Array([0x02]));
      const identBytes = await this.backend.readExactly(8, 2000);
      const ident = decodeAscii(identBytes);
      this.log(`BF888: ident ${ident}`);
      if (!ident.startsWith(IDENT_PREFIX)) {
        throw new Error(`Unexpected ident string: ${ident}`);
      }

      await this.backend.write(new Uint8Array([ACK]));
      await this.readUntilAck('ident');

      this.connected = true;
    } catch (err) {
      await this.backend.close().catch(() => undefined);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.backend.write(encodeCommand('E'));
    await this.backend.close();
    this.connected = false;
  }

  async readCodeplug(): Promise<Uint8Array> {
    this.ensureConnected();

    const buffer = new Uint8Array(MEM_SIZE);
    for (let addr = 0; addr < MEM_SIZE; addr += BLOCK_SIZE) {
      const block = await this.readBlock(addr, BLOCK_SIZE);
      buffer.set(block, addr);
    }
    return buffer;
  }

  async writeCodeplug(data: Uint8Array): Promise<void> {
    this.ensureConnected();

    if (data.length < MEM_SIZE) {
      throw new Error(`Codeplug is too small: ${data.length} bytes`);
    }

    this.validateChecksums(data);

    for (const range of WRITE_RANGES) {
      for (let addr = range.start; addr < range.end; addr += BLOCK_SIZE) {
        const block = data.slice(addr, addr + BLOCK_SIZE);
        if (this.dryRun) {
          this.log(
            `DRY-RUN write 0x${addr.toString(16).padStart(4, '0')}: ${bufferToHex(block)}`
          );
          continue;
        }
        await this.writeBlock(addr, block);
      }
    }
  }

  private async readBlock(address: number, length: number): Promise<Uint8Array> {
    const command = buildHeader('R', address, length);
    await this.backend.write(command);

    const response = await this.backend.readExactly(4 + length, 2000);
    const header = response.slice(0, 4);
    const expected = buildHeader('W', address, length);

    if (!buffersEqual(header, expected)) {
      throw new Error(
        `Unexpected block header at 0x${address.toString(16)}: ${bufferToHex(header)}`
      );
    }

    const data = response.slice(4);
    await this.backend.write(new Uint8Array([ACK]));
    await this.readUntilAck(`read 0x${address.toString(16)}`);

    return data;
  }

  private async writeBlock(address: number, data: Uint8Array): Promise<void> {
    if (data.length !== BLOCK_SIZE) {
      throw new Error(`Invalid block size: ${data.length}`);
    }

    const header = buildHeader('W', address, data.length);
    const payload = new Uint8Array(header.length + data.length);
    payload.set(header, 0);
    payload.set(data, header.length);

    await this.backend.write(payload);
    await this.readUntilAck(`write 0x${address.toString(16)}`);
  }

  private async readUntilAck(context: string, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const seen: number[] = [];

    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      let data: Uint8Array;
      try {
        data = await this.backend.readExactly(1, remaining);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed waiting for ACK after ${context}: ${message}`);
      }
      const value = data[0];
      if (value === ACK) {
        return;
      }
      seen.push(value);
    }

    throw new Error(
      `Timed out waiting for ACK after ${context}. Saw: ${seen
        .map(byte => `0x${byte.toString(16)}`)
        .join(' ')}`
    );
  }

  private ensureConnected() {
    if (!this.connected) {
      throw new Error('Radio is not connected. Call connect() first.');
    }
  }

  private validateChecksums(data: Uint8Array) {
    for (const validator of this.checksumValidators) {
      validator(data);
    }
  }
}

function buildHeader(command: 'R' | 'W', address: number, length: number): Uint8Array {
  return new Uint8Array([
    command.charCodeAt(0),
    (address >> 8) & 0xff,
    address & 0xff,
    length & 0xff
  ]);
}

function encodeCommand(command: string): Uint8Array {
  return new Uint8Array(Buffer.from(command, 'binary'));
}

function decodeAscii(data: Uint8Array): string {
  return Buffer.from(data).toString('ascii');
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bufferToHex(data: Uint8Array): string {
  return Array.from(data)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
