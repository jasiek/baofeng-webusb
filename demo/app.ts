import { factory, WebSerialBackend } from '../src/browser';
import {
  runDownloadScenario,
  runUploadScenario,
  runSynthWriteVerifyScenario,
  SessionRunner
} from '../src/scenarios/bf888';

const statusEl = document.getElementById('status') as HTMLDivElement;
const selectBtn = document.getElementById('selectPort') as HTMLButtonElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const uploadBtn = document.getElementById('upload') as HTMLButtonElement;
const testBtn = document.getElementById('testScenario') as HTMLButtonElement;
const fileInput = document.getElementById('file') as HTMLInputElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;

let port: SerialPort | null = null;

function log(message: string) {
  statusEl.textContent = message;
}

function enableActions(enabled: boolean) {
  downloadBtn.disabled = !enabled;
  uploadBtn.disabled = !enabled;
  testBtn.disabled = !enabled;
}

selectBtn.addEventListener('click', async () => {
  try {
    log('Requesting serial port...');
    port = await navigator.serial.requestPort({});
    enableActions(true);
    log('Port selected. Ready.');
  } catch (err) {
    log(`Port selection failed: ${stringifyError(err)}`);
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!port) return;
  const model = modelSelect.value as 'bf-888';

  const runSession = createSessionRunner(port, model);
  try {
    const data = await runDownloadScenario(runSession, { log });
    saveBlob(data, `${model}-codeplug.bin`);
  } catch (err) {
    log(`Operation failed: ${stringifyError(err)}`);
  }
});

uploadBtn.addEventListener('click', async () => {
  if (!port) return;
  const file = fileInput.files?.[0];
  if (!file) {
    log('Select a firmware/codeplug file first.');
    return;
  }
  const model = modelSelect.value as 'bf-888';

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const runSession = createSessionRunner(port, model);
  try {
    await runUploadScenario(runSession, data, { log });
  } catch (err) {
    log(`Operation failed: ${stringifyError(err)}`);
  }
});

testBtn.addEventListener('click', async () => {
  if (!port) return;
  const model = modelSelect.value as 'bf-888';
  const runSession = createSessionRunner(port, model);
  try {
    await runSynthWriteVerifyScenario(runSession, { log });
  } catch (err) {
    log(`Operation failed: ${stringifyError(err)}`);
  }
});

function createSessionRunner(port: SerialPort, model: 'bf-888'): SessionRunner {
  return async fn => {
    const backend = new WebSerialBackend(port, { baudRate: 9600 });
    const driver = factory.createRadio(model, backend, {
      log
    });

    try {
      await driver.connect();
      return await fn(driver);
    } catch (err) {
      log(`Operation failed: ${stringifyError(err)}`);
      throw err;
    } finally {
      await driver.disconnect();
    }
  };
}

function saveBlob(data: Uint8Array, filename: string) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
