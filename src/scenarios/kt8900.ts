import type { RadioDriver } from '../core';

export type SessionRunner = <T>(
  fn: (driver: RadioDriver) => Promise<T>
) => Promise<T>;

export interface ScenarioLogger {
  log(message: string): void;
}

const UPLOAD_MEM_SIZE = 0x3100;

export async function runDownloadScenario(
  runSession: SessionRunner,
  logger?: ScenarioLogger
): Promise<Uint8Array> {
  logger?.log('Downloading codeplug...');
  const data = await runSession(driver => driver.readCodeplug());
  logger?.log(`Downloaded ${data.length} bytes.`);
  return data;
}

export async function runUploadScenario(
  runSession: SessionRunner,
  data: Uint8Array,
  logger?: ScenarioLogger
): Promise<void> {
  logger?.log('Uploading codeplug...');
  await runSession(driver => driver.writeCodeplug(data));
  logger?.log(`Uploaded ${data.length} bytes.`);
}

export async function runSynthWriteVerifyScenario(
  runSession: SessionRunner,
  logger?: ScenarioLogger
): Promise<void> {
  logger?.log('Reading current codeplug...');
  const original = await runSession(driver => driver.readCodeplug());

  logger?.log('Writing codeplug back for verification...');
  await runSession(driver => driver.writeCodeplug(original));

  logger?.log('Re-reading codeplug for verification...');
  const readBack = await runSession(driver => driver.readCodeplug());

  verifyWrittenRegion(original, readBack);
  logger?.log('Verification passed for written region.');
}

export function verifyWrittenRegion(expected: Uint8Array, actual: Uint8Array) {
  const length = Math.min(expected.length, actual.length, UPLOAD_MEM_SIZE);
  for (let i = 0; i < length; i += 1) {
    if (expected[i] !== actual[i]) {
      throw new Error(`Mismatch at 0x${i.toString(16).padStart(4, '0')}`);
    }
  }
}
