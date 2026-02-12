# baofeng-webusb

TypeScript library and tooling to program supported radios over serial, usable from both Node.js and the browser (WebSerial).

## What this repo contains

- **Core driver interfaces** for radios and backends.
- **BF-888 and KT-8900 drivers** implementing the programming protocol.
- **Node serial backend** using `serialport`.
- **WebSerial backend** for browser use.
- **Shared scenarios** used by both CLI tests and the web demo.
- **Hardware tests** that exercise read/write against a real radio.
- **Demo web UI** to download/upload codeplugs via WebSerial.

## What you can do

- Read a BF-888 or KT-8900 codeplug from a connected radio.
- Upload a codeplug to a BF-888 or KT-8900.
- Run a synthesized write/verify scenario against a real BF-888.
- Run a read/write/verify scenario against a real KT-8900.
- Use the same logic from CLI tests or from a browser UI.

## Quick start

### Install

```
npm install
```

### Run hardware tests (Node.js + serial cable)

```
HARDWARE_TESTS=1 SERIAL_PORT=/dev/tty.usbserial-XXXX RADIO_MODEL=bf-888 npm run test:hw
```

Enable actual programming (writes):

```
HARDWARE_TESTS=1 SERIAL_PORT=/dev/tty.usbserial-XXXX RADIO_MODEL=kt-8900 ENABLE_PROGRAMMING=1 npm run test:hw -- tests/hardware/kt8900.program.test.ts
```

### Run the WebSerial demo

```
npm run demo
```

Open `http://localhost:5173` in Chrome/Edge, select the port, then download/upload codeplugs or run the test scenario.

## Project layout

- `src/core.ts`: shared types and factory.
- `src/drivers/bf888.ts`: BF-888 radio driver.
- `src/drivers/kt8900.ts`: KT-8900 radio driver.
- `src/node/serialBackend.ts`: Node serial backend.
- `src/web/webSerialBackend.ts`: WebSerial backend.
- `src/scenarios/bf888.ts`: shared test/demo scenarios.
- `src/scenarios/kt8900.ts`: shared test/demo scenarios.
- `tests/hardware/`: real-radio tests.
- `demo/`: WebSerial demo UI.
- `scripts/demo.mjs`: demo build + HTTP server.

## Notes

- Tests run serially to avoid port conflicts.
- The demo uses WebSerial and requires a compatible browser.
