import type { RadioBackend } from '../index';

interface WebSerialBackendOptions {
  baudRate?: number;
}

export class WebSerialBackend implements RadioBackend {
  private port: SerialPort;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private pending = new Uint8Array();

  constructor(port: SerialPort, options: WebSerialBackendOptions = {}) {
    this.port = port;
    this.options = {
      baudRate: options.baudRate ?? 9600
    };
  }

  private options: Required<WebSerialBackendOptions>;

  async open(): Promise<void> {
    if (!this.port.readable || !this.port.writable) {
      await this.port.open({ baudRate: this.options.baudRate });
    }
    this.reader = this.port.readable?.getReader() ?? null;
    this.writer = this.port.writable?.getWriter() ?? null;
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel();
    } catch (_) {
      // ignore
    }
    try {
      await this.writer?.close();
    } catch (_) {
      // ignore
    }
    this.reader = null;
    this.writer = null;
    if (this.port.readable || this.port.writable) {
      await this.port.close();
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('WebSerial writer not available');
    await this.writer.write(data);
  }

  async readExactly(length: number, timeoutMs = 1000): Promise<Uint8Array> {
    if (!this.reader) throw new Error('WebSerial reader not available');
    const deadline = Date.now() + timeoutMs;

    while (this.pending.length < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timeout waiting for ${length} bytes`);
      }
      const chunk = await this.readChunk(remaining);
      this.pending = concatBytes(this.pending, chunk);
    }

    const out = this.pending.slice(0, length);
    this.pending = this.pending.slice(length);
    return out;
  }

  private async readChunk(timeoutMs: number): Promise<Uint8Array> {
    if (!this.reader) return new Uint8Array();

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for data')), timeoutMs);

      this.reader!
        .read()
        .then(({ value, done }) => {
          clearTimeout(timer);
          if (done || !value) {
            resolve(new Uint8Array());
            return;
          }
          resolve(value);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
