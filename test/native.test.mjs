/*
 * The native transport, and what it does when the camera says nothing.
 *
 * Silence is the failure mode that matters here. A body that has gone to sleep
 * does not refuse a command, it simply never answers, and the only evidence is
 * time passing — so these tests are about how that time is spent and what the
 * person is told at the end of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { NativeTransport, hasNativeBridge } from '../src/ptp/native.mjs';
import { describeOpcode, OC } from '../src/ptp/codec.mjs';

/* A response container, by hand: length, type 3, code, transaction id. */
function responseBytes(code = 0x2001, transactionId = 1) {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 12, true);
  view.setUint16(4, 3, true);
  view.setUint16(6, code, true);
  view.setUint32(8, transactionId, true);
  return bytes;
}

/** A stand-in for the Swift side, which either answers or does not. */
function fakeHost({ answer = null } = {}) {
  const posted = [];
  globalThis.window = {
    webkit: { messageHandlers: { ptp: { postMessage(message) {
      posted.push(message);
      if (!answer) return;                       /* the asleep camera */
      queueMicrotask(() => globalThis.window.__ptpReply(message.id, answer(message)));
    } } } },
  };
  return posted;
}

test.afterEach(() => { delete globalThis.window; });

test('a bridge is only there when the host put one there', () => {
  fakeHost();
  assert.equal(hasNativeBridge(), true);
  delete globalThis.window;
  assert.equal(hasNativeBridge(), false);
});

test('an opcode is named in English, because a person reads it', () => {
  assert.equal(describeOpcode(OC.GetDeviceInfo), 'GetDeviceInfo (0x1001)');
  assert.equal(describeOpcode(OC.NikonMfDrive), 'NikonMfDrive (0x9204)');
  assert.equal(describeOpcode(0x1234), 'opcode 0x1234');
});

test('silence becomes advice, not an opcode', async () => {
  fakeHost();
  const transport = new NativeTransport();
  const error = await transport.transact({ opcode: OC.GetDeviceInfo, timeoutMs: 20 })
    .then(() => null, (e) => e);

  assert.ok(error, 'it gave up rather than waiting forever');
  assert.match(error.message, /GetDeviceInfo \(0x1001\)/, 'says which command');
  assert.match(error.message, /gone to sleep/, 'names the likely cause');
  assert.match(error.message, /half-press the shutter, or turn any dial/i, 'and what to do about it');
});

test('a wedged session says so at once instead of waiting all over again', async () => {
  fakeHost();
  const transport = new NativeTransport();
  await transport.transact({ opcode: OC.GetDeviceInfo, timeoutMs: 20 }).catch(() => {});

  const started = Date.now();
  const error = await transport.transact({ opcode: OC.GetDevicePropDesc, timeoutMs: 5000 })
    .then(() => null, (e) => e);

  assert.ok(error, 'still a failure');
  assert.ok(Date.now() - started < 200, 'but not another five seconds of it');
  assert.match(error.message, /GetDeviceInfo/, 'and it still names the command that actually stalled');
});

test('closing clears the stall, since closing is how you recover from one', async () => {
  const posted = fakeHost({ answer: () => ({}) });
  const transport = new NativeTransport();
  transport.stalled = 'wedged';

  await transport.close();
  assert.equal(transport.stalled, null);
  assert.deepEqual(posted.map((m) => m.kind), ['close']);
});

test('a real answer comes back framed, with the response code intact', async () => {
  const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
  fakeHost({ answer: () => ({ response: toBase64(responseBytes(0x2001)) }) });

  const transport = new NativeTransport();
  const result = await transport.transact({ opcode: OC.SetDevicePropValue });
  assert.equal(result.responseCode, 0x2001);
  assert.equal(result.data, null, 'a command with no data phase brings none back');
});

test('a fresh transport after a stall talks to the same host', async () => {
  /*
   * The recovery the app now performs by itself: the first session is silent,
   * it is handed back, and a new one answers. Worth pinning because the retry
   * is only correct if a new transport is genuinely independent of the stalled
   * one — a stall recorded anywhere shared would poison the retry too.
   */
  let opened = 0;
  const posted = [];
  globalThis.window = {
    webkit: { messageHandlers: { ptp: { postMessage(message) {
      posted.push(message.kind);
      if (message.kind === 'open') opened += 1;
      if (message.kind === 'transact' && opened < 2) return;   /* the stale session */
      queueMicrotask(() => globalThis.window.__ptpReply(message.id, {}));
    } } } },
  };

  const first = new NativeTransport();
  await first.open();
  await first.transact({ opcode: OC.GetDeviceInfo, timeoutMs: 20 }).catch(() => {});
  assert.ok(first.stalled, 'the first one gave up');

  await first.close();
  const second = new NativeTransport();
  await second.open();
  await second.transact({ opcode: OC.GetDeviceInfo, timeoutMs: 200 });

  assert.equal(second.stalled, null, 'and the second one is clean');
  assert.deepEqual(posted, ['open', 'transact', 'close', 'open', 'transact']);
});
