import { SerialPort } from 'serialport';
import type { RadioBackend, SerialBackendOptions } from '../index';

export class NodeSerialBackend implements RadioBackend {
  private port: SerialPort;
  private isOpen = false;
  private pending = Buffer.alloc(0);

  constructor(options: SerialBackendOptions) {
    this.port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate ?? 9600,
      autoOpen: false
    });
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    await new Promise<void>((resolve, reject) => {
      this.port.open(err => (err ? reject(err) : resolve()));
    });
    this.isOpen = true;
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    await new Promise<void>((resolve, reject) => {
      this.port.close(err => (err ? reject(err) : resolve()));
    });
    this.isOpen = false;
  }

  async write(data: Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.port.write(data, err => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      this.port.drain(err => (err ? reject(err) : resolve()));
    });
  }

  async readExactly(length: number, timeoutMs = 1000): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array();

    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      if (this.pending.length > 0) {
        chunks.push(this.pending);
        total += this.pending.length;
        this.pending = Buffer.alloc(0);
        if (total >= length) {
          const buffer = Buffer.concat(chunks, total);
          this.pending = buffer.slice(length);
          resolve(new Uint8Array(buffer.slice(0, length)));
          return;
        }
      }

      const onData = (data: Buffer) => {
        chunks.push(data);
        total += data.length;
        if (total >= length) {
          cleanup();
          const buffer = Buffer.concat(chunks, total);
          this.pending = buffer.slice(length);
          resolve(new Uint8Array(buffer.slice(0, length)));
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onTimeout = () => {
        cleanup();
        reject(new Error(`Timeout waiting for ${length} bytes`));
      };

      const timer = setTimeout(onTimeout, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.port.off('data', onData);
        this.port.off('error', onError);
      };

      this.port.on('data', onData);
      this.port.on('error', onError);
    });
  }
}
