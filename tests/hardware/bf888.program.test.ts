import { factory, NodeSerialBackend } from '../../src/index';

const hardwareEnabled = process.env.HARDWARE_TESTS === '1';
const portPath = process.env.SERIAL_PORT;
const radioModel = (process.env.RADIO_MODEL || 'bf-888') as 'bf-888';
const programmingEnabled = process.env.ENABLE_PROGRAMMING === '1';

const canRun = hardwareEnabled && !!portPath;
const describeIf = canRun ? describe : describe.skip;

describeIf('BF-888 programming (hardware)', () => {
  it('connects, reads codeplug, and optionally writes it back', async () => {
    if (!portPath) {
      throw new Error('SERIAL_PORT is required when HARDWARE_TESTS=1');
    }

    const driver = factory.createRadio(radioModel, createBackend(portPath));

    await driver.connect();
    const codeplug = await driver.readCodeplug();
    expect(codeplug).toBeInstanceOf(Uint8Array);
    expect(codeplug.length).toBeGreaterThan(0);

    if (programmingEnabled) {
      await driver.writeCodeplug(codeplug);
    }

    await driver.disconnect();
  });
});

function createBackend(path: string) {
  return new NodeSerialBackend({ path, baudRate: 9600 });
}
