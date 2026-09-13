import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, jpegSize } from '../tools/probe.mjs';

/* Real gphoto2 --list-all-config shape, including the cases that trip parsers:
 * a read-only entry, a choice list with index prefixes, and a value with
 * spaces and a slash in it. */
const SAMPLE = `/main/imgsettings/iso
Label: ISO Speed
Readonly: 0
Type: RADIO
Current: 100
Choice: 0 100
Choice: 1 125
Choice: 2 Auto ISO
END
/main/capturesettings/shutterspeed
Label: Shutter Speed
Readonly: 1
Type: RADIO
Current: 1/250
Choice: 0 1/250
END
/main/status/batterylevel
Label: Battery Level
Readonly: 1
Type: TEXT
Current: 87%
END
`;

test('parses every config block', () => {
  const c = parseConfig(SAMPLE);
  assert.equal(Object.keys(c).length, 3);
});

test('reads the readonly flag as a boolean, both ways', () => {
  const c = parseConfig(SAMPLE);
  assert.equal(c['/main/imgsettings/iso'].readonly, false);
  assert.equal(c['/main/capturesettings/shutterspeed'].readonly, true);
});

test('strips the index prefix from choices but keeps spaces in the value', () => {
  const { choices } = parseConfig(SAMPLE)['/main/imgsettings/iso'];
  assert.deepEqual(choices, ['100', '125', 'Auto ISO']);
});

test('keeps a value containing a slash intact', () => {
  assert.equal(parseConfig(SAMPLE)['/main/capturesettings/shutterspeed'].value, '1/250');
});

test('carries label and type through', () => {
  const c = parseConfig(SAMPLE)['/main/status/batterylevel'];
  assert.equal(c.label, 'Battery Level');
  assert.equal(c.type, 'TEXT');
  assert.equal(c.value, '87%');
});

test('an empty dump is not a crash', () => {
  assert.deepEqual(parseConfig(''), {});
});

test('stray lines before the first path are ignored', () => {
  const c = parseConfig('noise\nLabel: orphan\n' + SAMPLE);
  assert.equal(Object.keys(c).length, 3);
});

test('reads dimensions out of a JPEG frame header', () => {
  /* SOI, an APP0 segment to skip over, then SOF0 declaring 480x640. */
  const buf = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80,
  ]);
  assert.deepEqual(jpegSize(buf), { height: 480, width: 640 });
});

test('a truncated JPEG yields null rather than throwing', () => {
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff])), null);
});
