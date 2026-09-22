/*
 * Readings that came off a real Z 5 and were wrong on screen.
 *
 * Every case here was found by looking at the app next to the camera, which is
 * the only way these are ever found: each one is a number the code was happy
 * with and a photographer knew at a glance could not be true.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DPC, readCameraState, toPlannerContext, lensFrom, describeLens } from '../src/camera/live.mjs';
import { formatShutter } from '../src/photo/units.mjs';
import { formatAxis } from '../src/ui/app.mjs';
import { stabilityAdvice } from '../src/photo/stability.mjs';
import { npfLimit } from '../src/photo/motion.mjs';
import { planFor } from '../src/plan/index.mjs';

const fakeSession = (descs) => ({
  async getPropDesc(code) {
    const d = descs[code];
    if (!d) throw new Error(`Operation not supported (property 0x${code.toString(16)})`);
    return d;
  },
});

const desc = (current, extra = {}) =>
  ({ code: 0, dataType: 0x0006, writable: true, current, form: 'none', values: null, range: null, ...extra });

test('0xffffffff is not 429497 seconds', async () => {
  /* What the body reported with the shutter on bulb. Divided by the scale it
   * reads as a real exposure, which is how it reached the screen. */
  const state = await readCameraState(fakeSession({
    [DPC.ExposureTime]: desc(0xffffffff),
    [DPC.FNumber]: desc(280, { dataType: 0x0004 }),
  }));

  assert.equal(state.axes.shutter.value, null, 'no number is offered');
  assert.equal(state.axes.shutter.special, 'bulb', 'because Nikon spends that value on bulb');
  assert.equal(state.axes.shutter.raw, 0xffffffff, 'the raw reading is kept, for when it matters');
  assert.equal(formatAxis('shutter', null, 'bulb'), 'Bulb');
  assert.equal(state.axes.aperture.value, 2.8, 'a real value still decodes');
});

test('a placeholder never becomes a legal value to choose from', async () => {
  const state = await readCameraState(fakeSession({
    [DPC.ExposureTime]: desc(10000, { form: 'enum', values: [1250, 10000, 300000, 0xffffffff] }),
  }));
  assert.deepEqual(state.axes.shutter.legal, [0.125, 1, 30], 'bulb is not a shutter speed');
});

test('the planner is told which axes had no number', async () => {
  const state = await readCameraState(fakeSession({ [DPC.ExposureTime]: desc(0xffffffff) }));
  const camera = toPlannerContext(state, { model: 'Nikon Z 5' });
  assert.equal(camera.specials.shutter, 'bulb');
  assert.equal(camera.current.shutter, null);
});

test('a 24-70 is not at 327.84mm, and the lens itself says so', () => {
  /* The descriptor carries the zoom range in the same units as the current
   * value, so the two disagreeing is proof without knowing the true scale. */
  const lens = lensFrom({ axes: {
    focalLength: { value: 327.84, range: { min: 24, max: 70 } },
    aperture: { legal: [2.8, 4, 5.6] },
  } });

  assert.equal(lens.reported, false, 'the reading is not trusted');
  assert.equal(lens.disagreed, 327.84, 'and what it said is kept to show');
  assert.equal(lens.focalLength, 70, 'planning falls back to the long end');
  assert.match(describeLens(lens), /cannot be right/);
  assert.match(describeLens(lens), /planning for 70mm/);
});

test('the long end is the safe end, because NPF shortens as the lens grows', () => {
  const at = (focalLength) => npfLimit({ focalLength, aperture: 2.8, pixelPitchUm: 5.94 });
  assert.ok(at(70) < at(24), 'so a plan built for 70mm does not trail if it is really at 24mm');
});

test('a focal length inside the lens range is simply believed', () => {
  const lens = lensFrom({ axes: {
    focalLength: { value: 35, range: { min: 24, max: 70 } },
    aperture: { legal: [2.8] },
  } });
  assert.equal(lens.reported, true);
  assert.equal(lens.focalLength, 35);
  assert.equal(describeLens(lens), '35mm, opens to f/2.8');
});

test('there is no such shutter speed as 1/1', () => {
  assert.equal(formatShutter(0.769), '1/1.3', 'what the camera itself displays');
  assert.equal(formatShutter(0.625), '1/1.6');
  assert.equal(formatShutter(1), '1s', 'one second is a second, not a fraction');
  assert.equal(formatShutter(0.5), '1/2');
  assert.equal(formatShutter(1 / 125), '1/125', 'and the fast end stays whole');
  assert.equal(formatShutter(30), '30s');
});

test('a caution is marked as one, so it can be coloured as one', () => {
  const advice = stabilityAdvice({ shutterS: 1, focalLength: 24, support: 'tripod', stabilisationOn: true });
  const kinds = Object.fromEntries(advice.map((a) => [a.kind, a]));

  assert.equal(kinds['vr-on-tripod'].severity, 'warn');
  assert.equal(kinds['shutter-shock'].severity, 'warn');
  /* Turning the mode dial is still a job, not a caution. */
  const past = stabilityAdvice({ shutterS: 60, focalLength: 24, support: 'tripod' });
  assert.equal(past.find((a) => a.kind === 'past-thirty').severity, undefined);
});

test('a placeholder one short of the ceiling is still a placeholder', async () => {
  /*
   * 429497s came back after the exact-value check was in place. Vendors do not
   * agree on which near-maximum value means bulb, means time, or means "ask me
   * later", so equality is not enough — no camera holds the shutter open for
   * five days either way.
   */
  for (const raw of [0xfffffff0, 4294970000]) {
    const state = await readCameraState(fakeSession({ [DPC.ExposureTime]: desc(raw) }));
    assert.equal(state.axes.shutter.value, null, `${raw} is not an exposure time`);
    assert.equal(state.axes.shutter.special, 'none');
  }
  const real = await readCameraState(fakeSession({ [DPC.ExposureTime]: desc(120000) }));
  assert.equal(real.axes.shutter.value, 12, 'and twelve seconds still is');
});

test('a tracker is worth stops, and the plan says how it got them', () => {
  const camera = {
    model: 'Z 5', pixelPitchUm: 5.94, widthPx: 6016, mode: 'M',
    writableByMode: { M: ['shutter', 'aperture', 'iso'] },
    legal: { shutter: [1 / 125, 1, 10, 15, 20, 25, 30], aperture: [2.8, 4], iso: [100, 400, 800, 1600, 3200, 6400] },
    isoBounds: [100, 25600], current: {}, specials: {},
  };
  const lens = { focalLength: 24, maxAperture: 2.8, reported: true };
  const at = (tracker) => planFor('milky-way', { camera, lens, site: { bortle: 3 }, want: { tracker } });

  const loose = at('');
  const tracked = at('careful');

  assert.ok(tracked.settings.shutter > loose.settings.shutter, 'a longer exposure');
  assert.ok(tracked.settings.iso < loose.settings.iso, 'bought with ISO');
  assert.match(tracked.reasons.shutter, /polar error/, 'and it says where the number came from');
  assert.match(tracked.reasons.shutter, /Off the tracker it would be/, 'against the untracked case');
});

test('the exposure on screen is internally consistent once everything has snapped', () => {
  /*
   * A tracker asks for 240s on a body whose dial stops at 30. Solving ISO
   * against the 240 and then showing the 30 put two numbers on screen three
   * stops apart, each correct for a different exposure.
   */
  const camera = {
    model: 'Z 5', pixelPitchUm: 5.94, widthPx: 6016, mode: 'M',
    writableByMode: { M: ['shutter', 'aperture', 'iso'] },
    legal: { shutter: [1, 10, 30], aperture: [2.8], iso: [100, 200, 400, 800, 1600, 3200] },
    isoBounds: [100, 25600], current: {}, specials: {},
  };
  const plan = planFor('milky-way', {
    camera, lens: { focalLength: 20, maxAperture: 2.8, reported: true },
    site: { bortle: 3 }, want: { tracker: 'careful' },
  });

  const { shutter, aperture, iso } = plan.settings;
  const evAchieved = Math.log2((aperture ** 2) / shutter) - Math.log2(iso / 100);
  assert.ok(Math.abs(evAchieved - -5.5) < 0.5,
    `the three settings shown agree with the sky they were solved for (got EV ${evAchieved.toFixed(2)})`);
  assert.ok(camera.legal.shutter.includes(shutter), 'and the shutter is one the camera offers');
});
