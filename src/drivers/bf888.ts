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
    const envDryRun =
      typeof process !== 'undefined' && process.env && process.env.BF888_DRY_RUN === '1';
    this.dryRun = options.dryRun ?? envDryRun;
    this.log = options.log ?? (this.dryRun ? (msg: string) => console.log(msg) : () => {});
    this.checksumValidators = options.checksumValidators ?? [];
  }

  async connect(): Promise<void> {
    await this.backend.open();

    await this.backend.write(encodeCommand('\x02PROGRAM'));
    const ack = await this.readByte();
    if (ack !== ACK) {
      throw new Error(`Unexpected ACK after PROGRAM: 0x${ack.toString(16)}`);
    }

    await this.backend.write(new Uint8Array([0x02]));
    const identBytes = await this.backend.readExactly(8, 2000);
    const ident = decodeAscii(identBytes);
    if (!ident.startsWith(IDENT_PREFIX)) {
      throw new Error(`Unexpected ident string: ${ident}`);
    }

    await this.backend.write(new Uint8Array([ACK]));
    const ack2 = await this.readByte();
    if (ack2 !== ACK) {
      throw new Error(`Unexpected ACK after ident: 0x${ack2.toString(16)}`);
    }

    this.connected = true;
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
    const ack = await this.readByte();
    if (ack !== ACK) {
      throw new Error(`Unexpected ACK after read: 0x${ack.toString(16)}`);
    }

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
    const ack = await this.readByte();
    if (ack !== ACK) {
      throw new Error(`Unexpected ACK after write: 0x${ack.toString(16)}`);
    }
  }

  private async readByte(): Promise<number> {
    const data = await this.backend.readExactly(1, 2000);
    return data[0];
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
