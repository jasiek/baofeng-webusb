import { SerialPort } from 'serialport';

const hardwareEnabled = process.env.HARDWARE_TESTS === '1';
const portPath = process.env.SERIAL_PORT;

const describeIf = hardwareEnabled ? describe : describe.skip;

describeIf('serialport smoke', () => {
  it('opens and closes the serial port', async () => {
    if (!portPath) {
      throw new Error('SERIAL_PORT is required when HARDWARE_TESTS=1');
    }

    const port = new SerialPort({
      path: portPath,
      baudRate: 9600,
      autoOpen: false
    });

    await new Promise<void>((resolve, reject) => {
      port.open(err => (err ? reject(err) : resolve()));
    });

    await new Promise<void>((resolve, reject) => {
      port.close(err => (err ? reject(err) : resolve()));
    });
  });
});
