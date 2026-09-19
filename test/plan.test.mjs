import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFor, listIntents, modesThatAllow } from '../src/plan/index.mjs';
import { makePlan } from '../src/plan/plan.mjs';

/* The writability map the probe measured on the Z5, which is the point: this is
 * reported by the camera, not chosen by us. */
const WRITABLE_BY_MODE = {
  M: ['shutter', 'aperture', 'iso'],
  A: ['aperture', 'iso'],
  S: ['shutter', 'iso'],
  P: ['iso'],
};

const camera = (over = {}) => ({
  pixelPitchUm: 5.97, widthPx: 6016, baseIso: 100, mode: 'M',
  stabilisationOn: false, longExposureNR: false,
  writableByMode: WRITABLE_BY_MODE,
  legal: { iso: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] },
  ...over,
});
const lens = (over = {}) => ({ focalLength: 20, maxAperture: 1.8, ...over });

/* ---------- the shape of a plan ---------- */

test('every value carries the reason it holds', () => {
  const p = planFor('milky-way', { camera: camera(), lens: lens(), site: { bortle: 2 } });
  for (const axis of Object.keys(p.settings)) {
    assert.ok(p.reasons[axis]?.length > 10, `${axis} has a value but no reason`);
  }
});

test('a value cannot be set without one', () => {
  const p = makePlan({ intent: 'x', title: 'X' });
  p.set('iso', 400, 'because');
  assert.equal(p.reasons.iso, 'because');
});

test('the catalogue lists what it can solve', () => {
  const ids = listIntents().map((i) => i.id);
  assert.deepEqual(ids.sort(), ['milky-way', 'timelapse', 'waterfall']);
});

test('an unknown intent fails loudly and says what it knows', () => {
  assert.throws(() => planFor('underwater-basketweaving', {}), /Known: /);
});

/* ---------- the mode check derives itself ---------- */

test('modes are derived from what the camera reports, not a table', () => {
  assert.deepEqual(modesThatAllow({ pins: ['shutter', 'aperture'], writableByMode: WRITABLE_BY_MODE }), ['M']);
  assert.deepEqual(modesThatAllow({ pins: ['aperture'], writableByMode: WRITABLE_BY_MODE }), ['M', 'A']);
  assert.deepEqual(modesThatAllow({ pins: ['shutter'], writableByMode: WRITABLE_BY_MODE }), ['M', 'S']);
});

test('a plan pinning both corners asks for the dial when it is on A', () => {
  const p = planFor('milky-way', { camera: camera({ mode: 'A' }), lens: lens() });
  const dial = p.checks.find((c) => c.kind === 'mode-dial');
  assert.ok(dial);
  assert.match(dial.says, /on A/);
  assert.match(dial.fix, /M/);
  assert.equal(dial.appCanFix, false, 'no app turns a dial');
  assert.equal(p.ready, false);
});

test('the same plan in M raises nothing about the dial', () => {
  const p = planFor('milky-way', { camera: camera({ mode: 'M' }), lens: lens() });
  assert.equal(p.checks.filter((c) => c.kind === 'mode-dial').length, 0);
});

test('a camera that reports a different map gets a different answer', () => {
  /* A body where aperture stays writable in S would allow S as well as M. */
  const odd = { M: ['shutter', 'aperture'], S: ['shutter', 'aperture'], A: ['aperture'] };
  assert.deepEqual(modesThatAllow({ pins: ['shutter', 'aperture'], writableByMode: odd }), ['M', 'S']);
});

/* ---------- the Milky Way ---------- */

test('the shutter is the NPF limit and the reason names the rule it beat', () => {
  const p = planFor('milky-way', { camera: camera(), lens: lens(), site: { bortle: 2 } });
  assert.ok(p.settings.shutter > 12 && p.settings.shutter < 15);
  assert.match(p.reasons.shutter, /NPF/);
  assert.match(p.reasons.shutter, /25s/, 'it should say what the 500 rule would have cost');
});

test('a darker sky asks for more ISO than a brighter one', () => {
  const dark = planFor('milky-way', { camera: camera(), lens: lens(), site: { bortle: 1 } });
  const town = planFor('milky-way', { camera: camera(), lens: lens(), site: { bortle: 7 } });
  assert.ok(dark.settings.iso > town.settings.iso);
});

test('a slow lens cannot reach a balanced exposure, and the plan says so', () => {
  const p = planFor('milky-way', {
    camera: camera({ isoBounds: [100, 6400] }), lens: lens({ maxAperture: 5.6 }), site: { bortle: 2 },
  });
  assert.ok(p.warnings.some((w) => /stops short/.test(w)), 'it should admit the gap rather than pretend');
});

test('things the app can fix are marked differently from things you must', () => {
  const p = planFor('milky-way', {
    camera: camera({ mode: 'A', stabilisationOn: true, longExposureNR: true }), lens: lens(),
  });
  assert.ok(p.checks.some((c) => c.kind === 'long-exposure-nr' && c.appCanFix));
  assert.ok(p.blockers.every((c) => !c.appCanFix));
  assert.equal(p.blockers.length, 1, 'only the dial needs a hand');
});

/* ---------- waterfalls ---------- */

test('the filter is the output, and it changes with the light', () => {
  const dull = planFor('waterfall', { camera: camera(), lens: lens({ focalLength: 24 }), light: 'overcast' });
  const bright = planFor('waterfall', { camera: camera(), lens: lens({ focalLength: 24 }), light: 'bright sun' });
  assert.ok(bright.filters.stopsNeeded > dull.filters.stopsNeeded + 2);
  assert.ok(dull.filters.names.length >= 1);
});

test('a polariser already on the lens reduces what the ND must do', () => {
  const bare = planFor('waterfall', { camera: camera(), lens: lens(), light: 'overcast' });
  const cpl = planFor('waterfall', { camera: camera(), lens: lens(), light: 'overcast', want: { polariser: true } });
  assert.ok(cpl.filters.stopsNeeded < bare.filters.stopsNeeded);
});

test('it will not stop down past where diffraction costs more than it buys', () => {
  const p = planFor('waterfall', { camera: camera(), lens: lens(), want: { aperture: 22 } });
  assert.ok(p.settings.aperture <= 9, `f/${p.settings.aperture} is past the diffraction ceiling on this sensor`);
  assert.match(p.reasons.aperture, /diffraction/);
});

test('the look changes the shutter, and says what it buys', () => {
  const texture = planFor('waterfall', { camera: camera(), lens: lens(), want: { look: 'texture' } });
  const fog = planFor('waterfall', { camera: camera(), lens: lens(), want: { look: 'fog' } });
  assert.ok(fog.settings.shutter > texture.settings.shutter * 5);
  assert.match(texture.reasons.shutter, /strands/);
});

test('it only reaches for filters that are in the bag', () => {
  const p = planFor('waterfall', {
    camera: camera(), lens: lens(), light: 'bright sun', want: { ownedNd: [3] },
  });
  assert.ok(p.filters.filters.every((f) => f === 3));
});

/* ---------- timelapse ---------- */

test('a clip length and a window give the frames and the gap', () => {
  const p = planFor('timelapse', { camera: camera(), lens: lens(), want: { durationS: 7200, clipSeconds: 20 } });
  assert.equal(p.sequence.frames, 600);
  assert.ok(Math.abs(p.sequence.intervalS - 12) < 0.01);
});

test('the exposure is held inside the interval with room to write', () => {
  const p = planFor('timelapse', { camera: camera(), lens: lens(), light: 'blue hour', want: { durationS: 3600, clipSeconds: 20 } });
  assert.ok(p.settings.shutter <= p.sequence.intervalS - 1.5);
});

test('a battery that will not last is a check with a fix, not a silent failure', () => {
  const p = planFor('timelapse', {
    camera: camera({ batteryPercent: 20, cardFreeBytes: 64e9, frameBytes: 30e6 }),
    lens: lens(), want: { durationS: 7200, clipSeconds: 20 },
  });
  const battery = p.checks.find((c) => c.kind === 'battery');
  assert.ok(battery);
  assert.match(battery.fix, /USB|Charge|swap/i);
});

test('crossing sunset is called out as a different problem', () => {
  const p = planFor('timelapse', { camera: camera(), lens: lens(), want: { crossesSunset: true } });
  assert.ok(p.warnings.some((w) => /ramp/.test(w)));
});
