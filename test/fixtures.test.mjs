import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate, toCameraContext, parseShutter, parseAperture, parseIso } from '../src/camera/fixture.mjs';
import { planFor, listIntents, modesThatAllow } from '../src/plan/index.mjs';

const DIR = new URL('../fixtures/', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

test('there is at least one camera to test against', () => {
  assert.ok(files.length > 0, 'fixtures/ is empty — run tools/make-fixture.mjs against a probe run');
});

/* ---------- parsing the strings cameras actually emit ---------- */

test('shutter values parse in every shape gphoto2 writes them', () => {
  assert.equal(parseShutter('0.0100s'), 0.01);
  assert.equal(parseShutter('1/100'), 0.01);
  assert.equal(parseShutter('30.0000s'), 30);
  assert.equal(parseShutter('30'), 30);
});

test('bulb, time and flash sync are not durations and do not pretend to be', () => {
  for (const odd of ['Bulb', 'Time', 'x 200']) assert.equal(parseShutter(odd), null);
});

test('apertures and ISOs reject what is not a number', () => {
  assert.equal(parseAperture('f/2.8'), 2.8);
  assert.equal(parseAperture('f/0'), null, 'a lens reporting f/0 is reporting nothing');
  assert.equal(parseIso('51200'), 51200);
  assert.equal(parseIso('Auto'), null);
});

/*
 * Everything below runs once per fixture. A camera joins the suite by having
 * its file dropped in this folder — no code is written for it.
 */
for (const file of files) {
  const fixture = load(file);
  const name = fixture.camera?.model ?? file;

  test(`${name}: the fixture is well formed`, () => {
    assert.deepEqual(validate(fixture), []);
  });

  test(`${name}: reports which modes leave each axis writable`, () => {
    const modes = Object.keys(fixture.writableByMode);
    assert.ok(modes.length >= 2, 'a single dial position cannot show writability moving');
    for (const axes of Object.values(fixture.writableByMode)) assert.ok(Array.isArray(axes));
  });

  test(`${name}: a plan pinning shutter and aperture names a mode this body allows`, () => {
    const allowed = modesThatAllow({ pins: ['shutter', 'aperture'], writableByMode: fixture.writableByMode });
    assert.ok(allowed.length > 0, 'no mode on this body lets the app set both — worth knowing before shipping');
    for (const mode of allowed) {
      assert.ok(fixture.writableByMode[mode].includes('shutter') && fixture.writableByMode[mode].includes('aperture'));
    }
  });

  test(`${name}: every intent produces a plan, and every value has a reason`, () => {
    const camera = toCameraContext(fixture, { pixelPitchUm: 5.97, widthPx: 6016, mode: 'M' });
    for (const { id } of listIntents()) {
      const plan = planFor(id, { camera, lens: { focalLength: 20, maxAperture: 1.8 }, site: { bortle: 3 } });
      for (const axis of Object.keys(plan.settings)) {
        assert.ok(plan.reasons[axis], `${id} set ${axis} on ${name} without a reason`);
        assert.ok(Number.isFinite(plan.settings[axis]), `${id} set ${axis} to something that is not a number`);
      }
    }
  });

  test(`${name}: solved values are ones this camera will accept`, () => {
    const camera = toCameraContext(fixture, { pixelPitchUm: 5.97, widthPx: 6016, mode: 'M' });
    const plan = planFor('milky-way', { camera, lens: { focalLength: 20, maxAperture: 1.8 }, site: { bortle: 2 } });
    assert.ok(fixture.axes.iso.legal.includes(plan.settings.iso),
      `ISO ${plan.settings.iso} is not among the ${fixture.axes.iso.legal.length} this body offers`);
  });

  test(`${name}: asks for the dial when the body is in a mode that will not allow the plan`, () => {
    const allowed = modesThatAllow({ pins: ['shutter', 'aperture'], writableByMode: fixture.writableByMode });
    const blocked = Object.keys(fixture.writableByMode).find((m) => !allowed.includes(m));
    if (!blocked) return;  /* a body where every mode allows everything needs no check */
    const camera = toCameraContext(fixture, { pixelPitchUm: 5.97, widthPx: 6016, mode: blocked });
    const plan = planFor('milky-way', { camera, lens: { focalLength: 20, maxAperture: 1.8 } });
    const dial = plan.checks.find((c) => c.kind === 'mode-dial');
    assert.ok(dial, `in ${blocked} this body cannot set both, and the plan should say so`);
    assert.equal(dial.appCanFix, false);
  });

  test(`${name}: capabilities are stated, so features can be gated on them`, () => {
    const caps = fixture.capabilities;
    assert.equal(typeof caps.manualFocusDrive, 'boolean');
    if (caps.liveView) {
      assert.ok(caps.liveView.widthPx > 0 && caps.liveView.heightPx > 0);
      /* Fine focus needs both: MfDrive only runs while live view is active. */
      assert.equal(typeof caps.manualFocusDrive, 'boolean');
    }
  });
}
