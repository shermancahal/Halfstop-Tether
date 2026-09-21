import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCommand, encodeData, decodeContainer, parseDevicePropDesc, parseDeviceInfo,
  Reader, CONTAINER, RESPONSE_OK, OC, TYPE, describeResponse,
} from '../src/ptp/codec.mjs';

/* A little builder, so the fixtures below read as the wire format they are. */
const build = (...parts) => {
  const flat = parts.flat();
  const out = new Uint8Array(flat.length);
  out.set(flat);
  return out;
};
const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
/* PTP strings: a character count including the terminator, then UTF-16LE. */
const str = (s) => [s.length + 1, ...[...s].flatMap((c) => u16(c.charCodeAt(0))), ...u16(0)];

/* ---------- containers ---------- */

test('a command container is twelve bytes plus four per parameter', () => {
  const bytes = encodeCommand({ opcode: OC.GetDevicePropDesc, transactionId: 7, params: [0x5007] });
  assert.equal(bytes.length, 16);
  const c = decodeContainer(bytes);
  assert.equal(c.length, 16);
  assert.equal(c.type, CONTAINER.COMMAND);
  assert.equal(c.code, OC.GetDevicePropDesc);
  assert.equal(c.transactionId, 7);
  assert.deepEqual(c.params, [0x5007]);
});

test('everything is little-endian', () => {
  const bytes = encodeCommand({ opcode: 0x1234, transactionId: 0x0a0b0c0d, params: [] });
  assert.deepEqual([...bytes.slice(4, 8)], [0x01, 0x00, 0x34, 0x12]);
  assert.deepEqual([...bytes.slice(8, 12)], [0x0d, 0x0c, 0x0b, 0x0a]);
});

test('PTP allows five parameters and no more', () => {
  assert.doesNotThrow(() => encodeCommand({ opcode: 1, transactionId: 1, params: [1, 2, 3, 4, 5] }));
  assert.throws(() => encodeCommand({ opcode: 1, transactionId: 1, params: [1, 2, 3, 4, 5, 6] }), /five/);
});

test('a data container carries its payload after the header', () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const bytes = encodeData({ opcode: OC.SetDevicePropValue, transactionId: 3, data });
  const c = decodeContainer(bytes);
  assert.equal(c.type, CONTAINER.DATA);
  assert.deepEqual([...c.payload], [1, 2, 3, 4]);
});

test('a response carries its code and any parameters', () => {
  const bytes = build(u32(16), u16(CONTAINER.RESPONSE), u16(RESPONSE_OK), u32(9), u32(42));
  const c = decodeContainer(bytes);
  assert.equal(c.code, RESPONSE_OK);
  assert.deepEqual(c.params, [42]);
});

test('a container that claims less than it carries is read to its stated length', () => {
  /* Cameras pad bulk transfers; the length field is the authority. */
  const bytes = build(u32(12), u16(CONTAINER.RESPONSE), u16(RESPONSE_OK), u32(1), [0xff, 0xff, 0xff, 0xff]);
  assert.deepEqual(decodeContainer(bytes).params, []);
});

/* ---------- typed values ---------- */

test('strings are a count including the terminator, then UTF-16', () => {
  assert.equal(new Reader(build(str('Z 5'))).string(), 'Z 5');
  assert.equal(new Reader(build(str(''))).string(), '');
});

test('signed and unsigned are not the same byte read twice', () => {
  const r = new Reader(build([0xff], [0xff]));
  assert.equal(r.u8(), 255);
  assert.equal(r.i8(), -1);
});

test('arrays are a 32-bit count then that many values', () => {
  const r = new Reader(build(u32(3), u16(10), u16(20), u16(30)));
  assert.deepEqual(r.array(r.u16), [10, 20, 30]);
});

test('an unknown data type is refused rather than guessed at', () => {
  assert.throws(() => new Reader(build(u16(0))).typed(0x1234), /Unknown PTP data type/);
});

/* ---------- the descriptor the whole design rests on ---------- */

test('an enumerated property yields its writability and its legal values', () => {
  /* ISO as UINT16: settable, currently 400, offering 100 / 200 / 400. */
  const desc = parseDevicePropDesc(build(
    u16(0x500f), u16(TYPE.UINT16), [1],
    u16(100), u16(400), [2],
    u16(3), u16(100), u16(200), u16(400),
  ));
  assert.equal(desc.code, 0x500f);
  assert.equal(desc.writable, true, 'getSet 1 means the app may set it');
  assert.equal(desc.current, 400);
  assert.equal(desc.factoryDefault, 100);
  assert.equal(desc.form, 'enum');
  assert.deepEqual(desc.values, [100, 200, 400]);
});

test('getSet zero means the camera owns it — the dial case', () => {
  const desc = parseDevicePropDesc(build(
    u16(0x500e), u16(TYPE.UINT16), [0],
    u16(2), u16(3), [2], u16(2), u16(2), u16(3),
  ));
  assert.equal(desc.writable, false);
});

test('a range property yields min, max and step instead of a list', () => {
  const desc = parseDevicePropDesc(build(
    u16(0xd001), u16(TYPE.UINT8), [1],
    [0], [5], [1],
    [0], [10], [1],
  ));
  assert.equal(desc.form, 'range');
  assert.deepEqual(desc.range, { min: 0, max: 10, step: 1 });
  assert.equal(desc.values, null);
});

test('a property with no form is still a value the app can read', () => {
  const desc = parseDevicePropDesc(build(u16(0xd002), u16(TYPE.UINT32), [1], u32(0), u32(1234), [0]));
  assert.equal(desc.form, 'none');
  assert.equal(desc.current, 1234);
});

test('a string-valued property parses like any other', () => {
  const desc = parseDevicePropDesc(build(u16(0xd003), u16(TYPE.STR), [1], str(''), str('Sherman'), [0]));
  assert.equal(desc.current, 'Sherman');
});

/* ---------- what the camera says it is ---------- */

test('device info names the body and lists what it claims to support', () => {
  const info = parseDeviceInfo(build(
    u16(100), u32(0x0a), u16(100), str('microsoft.com/PTP: 1.0'),
    u16(0),
    u32(2), u16(OC.GetDeviceInfo), u16(OC.NikonGetLiveViewImg),
    u32(1), u16(0x4002),
    u32(2), u16(0x5005), u16(0x500f),
    u32(0), u32(1), u16(0x3801),
    str('Nikon Corporation'), str('Z 5'), str('1.40'), str('6001234'),
  ));
  assert.equal(info.manufacturer, 'Nikon Corporation');
  assert.equal(info.model, 'Z 5');
  assert.equal(info.deviceVersion, '1.40');
  assert.ok(info.operations.includes(OC.NikonGetLiveViewImg), 'live view is claimed');
  assert.deepEqual(info.deviceProperties, [0x5005, 0x500f]);
});

test('claiming an operation is not the same as implementing it', () => {
  /* Recorded here because libgphoto2 is full of bodies that lie about this,
   * and the app must verify rather than trust the list. */
  const info = parseDeviceInfo(build(
    u16(100), u32(0x0a), u16(100), str(''), u16(0),
    u32(1), u16(OC.NikonStartLiveView),
    u32(0), u32(0), u32(0), u32(0),
    str('Nikon'), str('Z 5'), str('1.0'), str('1'),
  ));
  assert.ok(info.operations.includes(OC.NikonStartLiveView));
});

/* ---------- saying what went wrong ---------- */

test('response codes have names, because a hex number helps nobody', () => {
  assert.equal(describeResponse(RESPONSE_OK), 'OK');
  assert.match(describeResponse(0xa009), /live view/i);
  assert.match(describeResponse(0x9999), /Unknown response 0x9999/);
});
