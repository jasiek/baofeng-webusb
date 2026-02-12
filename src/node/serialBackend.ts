import { SerialPort } from 'serialport';
import type { RadioBackend, SerialBackendOptions } from '../core';

export class NodeSerialBackend implements RadioBackend {
  private port: SerialPort;
  private isOpen = false;
  private pending = Buffer.alloc(0);
  private waiters: Array<() => void> = [];

  constructor(options: SerialBackendOptions) {
    this.port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate ?? 9600,
      autoOpen: false
    });

    this.port.on('data', data => {
      this.pending = Buffer.concat([this.pending, data]);
      const waiters = this.waiters.slice();
      this.waiters = [];
      for (const wake of waiters) {
        wake();
      }
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
    const deadline = Date.now() + timeoutMs;

    while (this.pending.length < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timeout waiting for ${length} bytes`);
      }
      await this.waitForData(remaining);
    }

    const chunk = this.pending.slice(0, length);
    this.pending = this.pending.slice(length);
    return new Uint8Array(chunk);
  }

  private waitForData(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for data'));
      }, timeoutMs);

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.port.off('error', onError);
        this.waiters = this.waiters.filter(wake => wake !== onData);
      };

      const onData = () => {
        cleanup();
        resolve();
      };

      this.waiters.push(onData);
      this.port.on('error', onError);
    });
  }
}
