import { factory, NodeSerialBackend } from '../../src/index';
import {
  runDownloadScenario,
  runUploadScenario,
  runSynthWriteVerifyScenario,
  SessionRunner
} from '../../src/scenarios/kt8900';

const hardwareEnabled = process.env.HARDWARE_TESTS === '1';
const portPath = process.env.SERIAL_PORT;
const radioModel = (process.env.RADIO_MODEL || 'kt-8900') as 'kt-8900';
const programmingEnabled = process.env.ENABLE_PROGRAMMING === '1';

const canRun = hardwareEnabled && !!portPath;
const describeIf = canRun ? describe : describe.skip;
const itIfWrite = programmingEnabled ? it : it.skip;

describeIf('KT-8900 programming (hardware)', () => {
  jest.setTimeout(120000);

  it('connects, reads codeplug, and optionally writes it back', async () => {
    if (!portPath) {
      throw new Error('SERIAL_PORT is required when HARDWARE_TESTS=1');
    }

    const runSession = createSessionRunner(portPath);
    const codeplug = await runDownloadScenario(runSession);
    expect(codeplug).toBeInstanceOf(Uint8Array);
    expect(codeplug.length).toBeGreaterThan(0);

    if (programmingEnabled) {
      await runUploadScenario(runSession, codeplug);
    }
  });

  itIfWrite('writes and verifies a round-trip codeplug', async () => {
    if (!portPath) {
      throw new Error('SERIAL_PORT is required when HARDWARE_TESTS=1');
    }

    const runSession = createSessionRunner(portPath);
    await runSynthWriteVerifyScenario(runSession);
  });
});

function createBackend(path: string) {
  return new NodeSerialBackend({ path, baudRate: 9600 });
}

function createSessionRunner(path: string): SessionRunner {
  return async fn => {
    const driver = factory.createRadio(radioModel, createBackend(path));
    await driver.connect();
    try {
      return await fn(driver);
    } finally {
      await driver.disconnect();
      await delay(2000);
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
