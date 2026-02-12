import { factory, NodeSerialBackend } from '../../src/index';

const hardwareEnabled = process.env.HARDWARE_TESTS === '1';
const portPath = process.env.SERIAL_PORT;
const radioModel = (process.env.RADIO_MODEL || 'bf-888') as 'bf-888';
const programmingEnabled = process.env.ENABLE_PROGRAMMING === '1';

const canRun = hardwareEnabled && !!portPath;
const describeIf = canRun ? describe : describe.skip;
const itIfWrite = programmingEnabled ? it : it.skip;

describeIf('BF-888 programming (hardware)', () => {
  it('connects, reads codeplug, and optionally writes it back', async () => {
    if (!portPath) {
      throw new Error('SERIAL_PORT is required when HARDWARE_TESTS=1');
    }

    const driver = factory.createRadio(radioModel, createBackend(portPath));

    const codeplug = await withSession(driver, async session => {
      const data = await session.readCodeplug();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBeGreaterThan(0);
      return data;
    });

    if (programmingEnabled) {
      const writer = factory.createRadio(radioModel, createBackend(portPath));
      await withSession(writer, async session => {
        await session.writeCodeplug(codeplug);
      });
    }
  });

  itIfWrite('writes and verifies a synthesized full-channel codeplug', async () => {
    if (!portPath) {
      throw new Error('SERIAL_PORT is required when HARDWARE_TESTS=1');
    }

    const reader = factory.createRadio(radioModel, createBackend(portPath));
    const original = await withSession(reader, session => session.readCodeplug());

    const synthesized = synthesizeFullCodeplug(original);

    const writer = factory.createRadio(radioModel, createBackend(portPath));
    await withSession(writer, session => session.writeCodeplug(synthesized));

    const verifier = factory.createRadio(radioModel, createBackend(portPath));
    const readBack = await withSession(verifier, session => session.readCodeplug());

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const offset = CHANNEL_BASE + channel * CHANNEL_SIZE;
      const expected = synthesized.slice(offset, offset + CHANNEL_SIZE);
      const actual = readBack.slice(offset, offset + CHANNEL_SIZE);
      expect(actual).toEqual(expected);
    }
  });
});

function createBackend(path: string) {
  return new NodeSerialBackend({ path, baudRate: 9600 });
}

async function withSession<T>(
  driver: ReturnType<typeof factory.createRadio>,
  fn: (driver: ReturnType<typeof factory.createRadio>) => Promise<T>
): Promise<T> {
  await driver.connect();
  try {
    return await fn(driver);
  } finally {
    await driver.disconnect();
    await delay(200);
  }
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

function synthesizeFullCodeplug(base: Uint8Array): Uint8Array {
  if (base.length < 0x03e0) {
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
