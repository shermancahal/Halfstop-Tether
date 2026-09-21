import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivate, scrubConfigs, scrubDump, scrubSummary, REDACTED } from '../src/camera/privacy.mjs';

const REPO = new URL('..', import.meta.url).pathname;

test('the fields that identify a person or a body are recognised', () => {
  for (const path of ['/main/status/serialnumber', '/main/settings/artist', '/main/settings/copyright', '/main/settings/imagecomment']) {
    assert.ok(isPrivate(path), `${path} should be treated as private`);
  }
  assert.ok(isPrivate('/main/other/d072', 'Artist Name'), 'the label counts too, since vendor paths are opaque');
});

test('ordinary settings are left alone', () => {
  for (const path of ['/main/imgsettings/iso', '/main/capturesettings/f-number', '/main/capturesettings/shutterspeed']) {
    assert.equal(isPrivate(path), false);
  }
});

test('scrubbing keeps the property and removes only the value', () => {
  const before = {
    '/main/settings/artist': { label: 'Artist', type: 'TEXT', readonly: false, value: 'Sherman Cahal', choices: [] },
    '/main/imgsettings/iso': { label: 'ISO Speed', type: 'RADIO', readonly: false, value: '100', choices: ['100', '200'] },
  };
  const after = scrubConfigs(before);
  assert.equal(after['/main/settings/artist'].value, REDACTED);
  assert.equal(after['/main/settings/artist'].label, 'Artist', 'the property itself still describes the camera');
  assert.equal(after['/main/settings/artist'].readonly, false);
  assert.deepEqual(after['/main/imgsettings/iso'], before['/main/imgsettings/iso']);
});

test('an empty private field is not filled in with a redaction marker', () => {
  const after = scrubConfigs({ '/main/settings/copyright': { label: 'Copyright', value: '' } });
  assert.equal(after['/main/settings/copyright'].value, '');
});

test('the block dump loses the value and nothing else', () => {
  const dump = [
    '/main/status/serialnumber', 'Label: Serial Number', 'Readonly: 1', 'Type: TEXT',
    'Current: 00000000000000000000000003009146', 'END',
    '/main/imgsettings/iso', 'Label: ISO Speed', 'Readonly: 0', 'Type: RADIO',
    'Current: 100', 'Choice: 0 100', 'END', '',
  ].join('\n');
  const out = scrubDump(dump);
  assert.ok(!out.includes('03009146'));
  assert.ok(out.includes('Current: 100'), 'ISO is not private and must survive');
  assert.ok(out.includes('Label: Serial Number'), 'the property still exists');
  assert.ok(out.includes('Choice: 0 100'));
});

test('both shapes in the summary are covered, because one alone only looks like it worked', () => {
  const summary = [
    '  Serial Number: 00000000000000000000000003009146',
    "Artist                    (501e ro str): 'Sherman Cahal'",
    "Copyright Info            (501f ro str): ''",
    'Burst Number              (5018 rw u16): Range [1 - 65535, step 1] value: 1',
  ].join('\n');
  const out = scrubSummary(summary);
  assert.ok(!out.includes('03009146'));
  assert.ok(!out.includes('Sherman'));
  assert.ok(out.includes('Burst Number'), 'an ordinary property is untouched');
  assert.match(out, /Artist\s+\(501e ro str\): '\[redacted\]'/);
});

test('scrubbing twice changes nothing the second time', () => {
  const once = scrubSummary("Artist  (501e ro str): 'Someone'");
  assert.equal(scrubSummary(once), once);
});

/*
 * The guard that matters: this repository is public, and a probe run committed
 * without scrubbing would publish a stranger's name and serial. Fail here
 * rather than there.
 */
test('nothing committed carries an unscrubbed private value', () => {
  const suspects = [];
  for (const dir of ['probe-output', 'fixtures']) {
    const root = join(REPO, dir);
    if (!existsSync(root)) continue;
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const path = join(d, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.(json|txt)$/.test(entry.name)) continue;
        const text = readFileSync(path, 'utf8');
        /* The serial shape this body reports: a long run of digits under a
         * serial label, and any Artist line still carrying a value. */
        if (/serial\s*number["':\s]*[^"\n,]*\d{8}/i.test(text)) suspects.push(`${path}: a serial number`);
        if (/["']?artist[^:\n]*["']?\s*[:=]\s*["'][^"'\]]{2,}["']/i.test(text.replace(/\[redacted\]/g, ''))) {
          suspects.push(`${path}: an artist name`);
        }
      }
    };
    walk(root);
  }
  assert.deepEqual(suspects, [], 'run: node tools/scrub.mjs <dir>');
});
