import type { RadioDriver } from '../core';

export type SessionRunner = <T>(
  fn: (driver: RadioDriver) => Promise<T>
) => Promise<T>;

export interface ScenarioLogger {
  log(message: string): void;
}

const CHANNEL_COUNT = 16;
const CHANNEL_SIZE = 16;
const CHANNEL_BASE = 0x0010;
const RX_FREQ_OFFSET = 0;
const TX_FREQ_OFFSET = 4;
const RX_TONE_OFFSET = 8;
const TX_TONE_OFFSET = 10;
const FLAGS_OFFSET = 12;
const TRAILER_OFFSET = 13;

const BASE_FREQUENCY_HZ = 462_000_000;
const CHANNEL_STEP_HZ = 12_500;
const MEM_SIZE = 0x03e0;

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
  const synthesized = synthesizeFullCodeplug(original);

  logger?.log('Writing synthesized codeplug...');
  await runSession(driver => driver.writeCodeplug(synthesized));

  logger?.log('Re-reading codeplug for verification...');
  const readBack = await runSession(driver => driver.readCodeplug());

  verifyChannelBlocks(synthesized, readBack);
  logger?.log('Verification passed for all channels.');
}

export function synthesizeFullCodeplug(base: Uint8Array): Uint8Array {
  if (base.length < MEM_SIZE) {
    throw new Error(`Unexpected codeplug length: ${base.length}`);
  }

  const image = new Uint8Array(base);
  const template = base.slice(CHANNEL_BASE, CHANNEL_BASE + CHANNEL_SIZE);
  const templateEmpty = isEmptyChannel(template);
  const flags = templateEmpty ? 0x00 : template[FLAGS_OFFSET];
  const trailer = templateEmpty
    ? new Uint8Array([0x00, 0x00, 0x00])
    : template.slice(TRAILER_OFFSET, TRAILER_OFFSET + 3);

  for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
    const offset = CHANNEL_BASE + channel * CHANNEL_SIZE;
    const frequencyHz = BASE_FREQUENCY_HZ + channel * CHANNEL_STEP_HZ;
    const freqBytes = encodeLbcdFrequency(frequencyHz);

    image.set(freqBytes, offset + RX_FREQ_OFFSET);
    image.set(freqBytes, offset + TX_FREQ_OFFSET);

    image[offset + RX_TONE_OFFSET] = 0xff;
    image[offset + RX_TONE_OFFSET + 1] = 0xff;
    image[offset + TX_TONE_OFFSET] = 0xff;
    image[offset + TX_TONE_OFFSET + 1] = 0xff;

    image[offset + FLAGS_OFFSET] = flags;
    image.set(trailer, offset + TRAILER_OFFSET);
  }

  return image;
}

export function verifyChannelBlocks(expected: Uint8Array, actual: Uint8Array) {
  for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
    const offset = CHANNEL_BASE + channel * CHANNEL_SIZE;
    const exp = expected.slice(offset, offset + CHANNEL_SIZE);
    const act = actual.slice(offset, offset + CHANNEL_SIZE);
    if (!bytesEqual(exp, act)) {
      throw new Error(`Channel ${channel + 1} did not match after write/read`);
    }
  }
}

function isEmptyChannel(slot: Uint8Array): boolean {
  return slot[0] === 0xff && slot[1] === 0xff && slot[2] === 0xff && slot[3] === 0xff;
}

function encodeLbcdFrequency(freqHz: number): Uint8Array {
  const value = Math.round(freqHz / 10);
  const digits = value.toString().padStart(8, '0');
  const bytes = new Uint8Array(4);

  for (let i = 0; i < 4; i += 1) {
    const pair = digits.slice(digits.length - 2 * (i + 1), digits.length - 2 * i);
    const high = parseInt(pair[0], 10);
    const low = parseInt(pair[1], 10);
    bytes[i] = (high << 4) | low;
  }

  return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
