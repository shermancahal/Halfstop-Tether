#!/usr/bin/env node
/*
 * Turn a probe run into a fixture the test suite can keep.
 *
 *     node tools/make-fixture.mjs probe-output/<timestamp> fixtures/nikon-z5.json
 *
 * This is the step that makes "does it work with my camera?" answerable by a
 * stranger with three minutes and no interest in the codebase.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseConfig, jpegSize } from './probe.mjs';
import { fromProbe, validate } from '../src/camera/fixture.mjs';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: node tools/make-fixture.mjs <probe-output-dir> <fixture.json>');
  process.exit(1);
}

const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));

const modeDumps = {};
for (const mode of ['M', 'A', 'S', 'P']) {
  try {
    modeDumps[mode] = parseConfig(await readFile(join(dir, `config-mode-${mode}.txt`), 'utf8'));
  } catch { /* that dial position was skipped */ }
}

/* Measure any preview frame the run left behind, whatever gphoto2 named it. */
let liveViewFrame = null;
for (const name of await readdir(dir)) {
  if (!/liveview.*\.jpe?g$/i.test(name)) continue;
  const buf = await readFile(join(dir, name));
  const size = jpegSize(buf);
  if (size) { liveViewFrame = { ...size, bytes: buf.length }; break; }
}

const fixture = fromProbe({ report, modeDumps, liveViewFrame });
const problems = validate(fixture);
if (problems.length) {
  console.error(`${basename(out)} would not be a usable fixture:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

await writeFile(out, `${JSON.stringify(fixture, null, 2)}\n`);
const axes = Object.entries(fixture.axes).map(([a, e]) => `${a}:${e.legal.length}`).join(' ');
console.log(`${out} — ${fixture.camera.model}: ${axes}, modes ${Object.keys(fixture.writableByMode).join('/')}, live view ${fixture.capabilities.liveView ? `${fixture.capabilities.liveView.widthPx}x${fixture.capabilities.liveView.heightPx}` : 'no'}`);
