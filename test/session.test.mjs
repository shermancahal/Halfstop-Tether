import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PtpSession, PtpError } from '../src/ptp/session.mjs';
import { encodeData, decodeContainer, CONTAINER, RESPONSE_OK, OC, TYPE } from '../src/ptp/codec.mjs';

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const str = (s) => [s.length + 1, ...[...s].flatMap((c) => u16(c.charCodeAt(0))), ...u16(0)];
const bytes = (...p) => Uint8Array.from(p.flat());

const response = (code = RESPONSE_OK, id = 1, params = []) =>
  bytes(u32(12 + params.length * 4), u16(CONTAINER.RESPONSE), u16(code), u32(id), params.flatMap(u32));

/** A transport that says whatever the test told it to, and records what it heard. */
class FakeTransport {
  constructor(replies = []) { this.replies = replies; this.sent = []; }
  async send(b) { this.sent.push(decodeContainer(b)); }
  async receive() {
    if (!this.replies.length) throw new Error('the test ran out of replies');
    return this.replies.shift();
  }
}

test('a transaction sends a command and reads the response', async () => {
  const t = new FakeTransport([response()]);
  const s = new PtpSession(t);
  await s.transaction({ opcode: OC.CloseSession });
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].code, OC.CloseSession);
  assert.equal(t.sent[0].type, CONTAINER.COMMAND);
});

test('transaction ids advance and never land on zero', async () => {
  const t = new FakeTransport([response(), response(), response()]);
  const s = new PtpSession(t);
  s.transactionId = 0xfffffffd;
  for (let i = 0; i < 3; i++) await s.transaction({ opcode: OC.CloseSession });
  const ids = t.sent.map((c) => c.transactionId);
  assert.equal(new Set(ids).size, 3, 'ids repeated');
  assert.ok(!ids.includes(0), 'zero is reserved');
});

test('a data phase is returned and the response still read', async () => {
  const payload = bytes(u32(0xdeadbeef));
  const t = new FakeTransport([encodeData({ opcode: OC.GetDevicePropValue, transactionId: 1, data: payload }), response()]);
  const s = new PtpSession(t);
  const { data } = await s.transaction({ opcode: OC.GetDevicePropValue, params: [0x5007], expectData: true });
  assert.deepEqual([...data], [...payload]);
});

test('data larger than one transfer is stitched back together', async () => {
  const whole = new Uint8Array(40).fill(7);
  const container = encodeData({ opcode: OC.GetDeviceInfo, transactionId: 1, data: whole });
  /* Split the container the way a bulk endpoint would. */
  const first = container.slice(0, 30);
  const rest = container.slice(30);
  const t = new FakeTransport([first, rest, response()]);
  const s = new PtpSession(t);
  const { data } = await s.transaction({ opcode: OC.GetDeviceInfo, expectData: true });
  assert.equal(data.byteLength, 40);
  assert.ok([...data].every((b) => b === 7));
});

test('a refusal becomes an error that says what it was', async () => {
  const t = new FakeTransport([response(0xa009)]);
  const s = new PtpSession(t);
  await assert.rejects(() => s.transaction({ opcode: OC.NikonMfDrive, params: [1, 10] }), (e) => {
    assert.ok(e instanceof PtpError);
    assert.equal(e.code, 0xa009);
    assert.match(e.message, /live view/i, 'the message should say the camera is not in live view');
    assert.match(e.message, /9204/, 'and which operation was refused');
    return true;
  });
});

test('a device busy response is an error rather than a silent nothing', async () => {
  const t = new FakeTransport([response(0x2019)]);
  const s = new PtpSession(t);
  await assert.rejects(() => s.transaction({ opcode: OC.InitiateCapture }), /busy/i);
});

test('opening a session reads device info first, then opens', async () => {
  const info = bytes(
    u16(100), u32(0x0a), u16(100), str(''), u16(0),
    u32(1), u16(OC.NikonMfDrive), u32(0), u32(1), u16(0x5007), u32(0), u32(0),
    str('Nikon'), str('Z 5'), str('1.40'), str('123'),
  );
  const t = new FakeTransport([encodeData({ opcode: OC.GetDeviceInfo, transactionId: 1, data: info }), response(), response()]);
  const s = new PtpSession(t);
  const got = await s.open();
  assert.equal(got.model, 'Z 5');
  assert.deepEqual(t.sent.map((c) => c.code), [OC.GetDeviceInfo, OC.OpenSession]);
  assert.equal(s.supports(OC.NikonMfDrive), true);
  assert.equal(s.supports(OC.NikonStartLiveView), false);
});

test('a property the camera lists and then refuses is recorded, not thrown', async () => {
  const good = bytes(u16(0x5007), u16(TYPE.UINT16), [1], u16(28), u16(56), [2], u16(2), u16(28), u16(56));
  const t = new FakeTransport([
    encodeData({ opcode: OC.GetDevicePropDesc, transactionId: 1, data: good }), response(),
    response(0x2005),  /* the second one is claimed and not implemented */
  ]);
  const s = new PtpSession(t);
  s.deviceInfo = { deviceProperties: [0x5007, 0xd999], operations: [] };
  const { props, elapsedMs } = await s.readAllProps();
  assert.equal(props[0x5007].writable, true);
  assert.deepEqual(props[0x5007].values, [28, 56]);
  assert.ok(props[0xd999].error, 'the refusal should be kept as a fact about this body');
  assert.equal(props[0xd999].claimed, true);
  assert.ok(elapsedMs >= 0);
});

test('closing a session that was never open does nothing', async () => {
  const t = new FakeTransport([]);
  await new PtpSession(t).close();
  assert.equal(t.sent.length, 0);
});
