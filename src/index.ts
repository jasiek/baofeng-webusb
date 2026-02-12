import type { BF888DriverOptions } from './drivers/bf888';

export type RadioModel = 'bf-888';

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
      return new BF888Driver(backend, options as BF888DriverOptions | undefined);
    }
    throw new NotImplementedError(`Unsupported radio model: ${model}`);
  }
};

export { NodeSerialBackend } from './node/serialBackend';
export type { BF888DriverOptions, ChecksumValidator } from './drivers/bf888';
