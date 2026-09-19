import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveExposure, SCENE_EV, exposureDifference } from '../src/photo/exposure.mjs';
import { stabilityAdvice, appCanResolve } from '../src/photo/stability.mjs';
import { ev } from '../src/photo/units.mjs';
import { profile, NIKON_Z5 } from '../src/photo/bodies.mjs';
import { npfLimit } from '../src/photo/motion.mjs';
import { ndStopsNeeded, chooseNd } from '../src/photo/filters.mjs';

const Z5 = profile(NIKON_Z5);
const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/* ---------- solving the triangle ---------- */

test('with one axis free the exposure balances', () => {
  const r = solveExposure({ evScene: 12, want: { shutter: 1 / 125, aperture: 5.6 }, absorb: 'iso' });
  assert.equal(r.balanced, true);
  close(ev(r), 12, 0.02);
});

test('any of the three can be the absorber', () => {
  for (const absorb of ['iso', 'shutter', 'aperture']) {
    const want = { shutter: 1 / 60, aperture: 8, iso: 400 };
    delete want[absorb];
    const r = solveExposure({ evScene: 11, want, absorb });
    assert.equal(r.balanced, true, `${absorb} should have absorbed the difference`);
  }
});

test('pinning all three leaves a gap, and the gap is the answer', () => {
  /*
   * A waterfall wants two seconds at f/11 and base ISO. On an overcast day
   * that is six stops too much light, and those six stops are the filter —
   * not a failure to solve.
   */
  const r = solveExposure({ evScene: SCENE_EV.overcast, want: { shutter: 2, aperture: 11, iso: 100 }, absorb: 'none' });
  assert.equal(r.balanced, false);
  close(r.errorStops, 6.09, 0.02);
  const viaFilters = ndStopsNeeded({ meteredShutter: 1 / 34, targetShutter: 2 });
  close(r.errorStops, viaFilters, 0.05);
  assert.deepEqual(chooseNd(r.errorStops).filters, [6]);
});

test('the sign says which way the light is wrong', () => {
  const tooMuch = solveExposure({ evScene: 15, want: { shutter: 2, aperture: 11, iso: 100 }, absorb: 'none' });
  const tooLittle = solveExposure({ evScene: 5, want: { shutter: 1 / 500, aperture: 11, iso: 100 }, absorb: 'none' });
  assert.ok(tooMuch.errorStops > 0, 'positive means reach for neutral density');
  assert.ok(tooLittle.errorStops < 0, 'negative means there is not enough light');
});

test('a clamped axis says so rather than returning an impossible value', () => {
  const r = solveExposure({
    evScene: SCENE_EV['moonless milky way'],
    want: { shutter: 12, aperture: 5.6 },
    absorb: 'iso',
    bounds: { iso: [100, 6400] },
  });
  const clamped = r.notes.find((n) => n.kind === 'clamped');
  assert.ok(clamped, 'a slow kit zoom under the Milky Way cannot reach a balanced exposure');
  assert.equal(clamped.axis, 'iso');
  assert.equal(r.iso, 6400);
  assert.ok(r.errorStops < 0, 'and it is still short of light');
});

test('the answer is one the camera will actually accept', () => {
  const legal = { iso: [100, 200, 400, 800, 1600, 3200, 6400], shutter: [1 / 125, 1 / 60, 1 / 30], aperture: [1.8, 2.8, 4, 5.6, 8, 11] };
  /* EV 8.32 at f/4 and 1/60 wants ISO 300, which this camera does not offer. */
  const r = solveExposure({ evScene: 8.32, want: { shutter: 1 / 60, aperture: 4 }, absorb: 'iso', legal });
  assert.ok(legal.iso.includes(r.iso), `${r.iso} is not a value this camera offers`);
  assert.equal(r.iso, 400, 'and 400 is the nearer of the two it does offer, in stops');
  const snapped = r.notes.find((n) => n.kind === 'snapped');
  assert.ok(snapped, 'moving to a legal value is a compromise and should be recorded');
  assert.ok(Math.abs(snapped.offBy) < 0.5);
});

test('snapping is reported, so the plan can admit it is a third of a stop off', () => {
  const r = solveExposure({ evScene: 12.3, want: { shutter: 1 / 125, aperture: 5.6 }, absorb: 'iso', legal: { iso: [100, 200] } });
  assert.ok(!r.balanced || r.notes.some((n) => n.kind === 'snapped'));
});

test('the Milky Way case lands where the mockups said it would', () => {
  const shutter = npfLimit({ focalLength: 20, aperture: 1.8, pixelPitchUm: Z5.pixelPitchUm });
  const r = solveExposure({
    evScene: SCENE_EV['moonless milky way'],
    want: { shutter, aperture: 1.8 }, absorb: 'iso',
    bounds: { iso: [100, 25600] },
    legal: { iso: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] },
  });
  close(shutter, 12.1, 0.1);
  assert.equal(r.aperture, 1.8);
  assert.ok(r.iso >= 800 && r.iso <= 6400, `ISO ${r.iso} is not a plausible Milky Way exposure`);
});

test('exposure differences are symmetric and signed', () => {
  /* Exactly one stop apart. 1/60 against 1/125 would be 1.06, which is the
   * kind of near-miss that makes a tolerance hide a real error. */
  const a = { aperture: 5.6, shutter: 1 / 125, iso: 100 };
  const b = { aperture: 5.6, shutter: 1 / 250, iso: 100 };
  /* A shorter shutter suits a brighter scene, so b sits one EV higher. */
  close(exposureDifference(a, b), 1, 1e-9);
  close(exposureDifference(b, a), -1, 1e-9);
});

/* ---------- holding still ---------- */

test('a shutter past what the lens can be held at is called out', () => {
  const advice = stabilityAdvice({ shutterS: 1 / 4, focalLength: 200, stabilisationStops: 5, support: 'hand' });
  const slow = advice.find((a) => a.kind === 'too-slow-to-hold');
  assert.ok(slow);
  assert.equal(slow.appCanFix, false, 'no app can hold a camera steady');
});

test('stabilisation credited means a wide lens is fine where a long one is not', () => {
  const wide = stabilityAdvice({ shutterS: 1 / 8, focalLength: 20, stabilisationStops: 5, support: 'hand' });
  const long = stabilityAdvice({ shutterS: 1 / 8, focalLength: 400, stabilisationStops: 5, support: 'hand' });
  assert.equal(wide.filter((a) => a.kind === 'too-slow-to-hold').length, 0);
  assert.equal(long.filter((a) => a.kind === 'too-slow-to-hold').length, 1);
});

test('stabilisation on a tripod is flagged, and the app can fix it itself', () => {
  const advice = stabilityAdvice({ shutterS: 2, focalLength: 20, support: 'tripod', stabilisationOn: true });
  const vr = advice.find((a) => a.kind === 'vr-on-tripod');
  assert.ok(vr);
  assert.equal(vr.appCanFix, true);
});

test('stabilisation already off on a tripod raises nothing about it', () => {
  const advice = stabilityAdvice({ shutterS: 2, focalLength: 20, support: 'tripod', stabilisationOn: false });
  assert.equal(advice.filter((a) => a.kind === 'vr-on-tripod').length, 0);
});

test('shutter shock is flagged only in the window where it shows', () => {
  const inWindow = stabilityAdvice({ shutterS: 0.5, focalLength: 50, support: 'tripod', stabilisationOn: false });
  const wayLonger = stabilityAdvice({ shutterS: 20, focalLength: 50, support: 'tripod', stabilisationOn: false });
  assert.ok(inWindow.some((a) => a.kind === 'shutter-shock'));
  assert.equal(wayLonger.filter((a) => a.kind === 'shutter-shock').length, 0, 'vibration is a rounding error in a 20 second frame');
});

test('past thirty seconds it is bulb, and bulb belongs to the dial', () => {
  const advice = stabilityAdvice({ shutterS: 120, focalLength: 20, support: 'tripod', stabilisationOn: false });
  const bulb = advice.find((a) => a.kind === 'past-thirty');
  assert.ok(bulb);
  assert.equal(bulb.appCanFix, false);
  assert.equal(appCanResolve(advice), false);
});

test('a run the app can set up entirely says so', () => {
  const advice = stabilityAdvice({ shutterS: 0.5, focalLength: 20, support: 'tripod', stabilisationOn: true });
  assert.ok(advice.length > 0);
  assert.equal(appCanResolve(advice), true);
});
