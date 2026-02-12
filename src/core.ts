export type RadioModel = 'bf-888' | 'kt-8900';

export interface SerialBackendOptions {
  path: string;
  baudRate?: number;
}

export interface RadioBackend {
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  readExactly(length: number, timeoutMs?: number): Promise<Uint8Array>;
}

export interface RadioDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readCodeplug(): Promise<Uint8Array>;
  writeCodeplug(data: Uint8Array): Promise<void>;
}

export interface RadioFactory {
  createRadio(model: RadioModel, backend: RadioBackend, options?: unknown): RadioDriver;
}

export class NotImplementedError extends Error {}

export const factory: RadioFactory = {
  createRadio(model: RadioModel, backend: RadioBackend, options?: unknown): RadioDriver {
    if (model === 'bf-888') {
      const { BF888Driver } = require('./drivers/bf888');
      return new BF888Driver(backend, options as import('./drivers/bf888').BF888DriverOptions);
    }
    if (model === 'kt-8900') {
      const { KT8900Driver } = require('./drivers/kt8900');
      return new KT8900Driver(backend, options as import('./drivers/kt8900').KT8900DriverOptions);
    }
    throw new NotImplementedError(`Unsupported radio model: ${model}`);
  }
};
