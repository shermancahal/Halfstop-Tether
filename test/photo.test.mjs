import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, shutterFor, apertureFor, isoFor, snap, stopsBetween, formatShutter } from '../src/photo/units.mjs';
import { profile, NIKON_Z5, pixelPitchUm } from '../src/photo/bodies.mjs';
import { npfLimit, rule500, handheldLimit, subjectMotionLimit, waterShutter } from '../src/photo/motion.mjs';
import { hyperfocalMm, depthOfField, diffractionLimitedAperture, airyDiskUm } from '../src/photo/depth.mjs';
import { ndStopsNeeded, chooseNd, ndName, POLARISER_STOPS } from '../src/photo/filters.mjs';
import { planTimelapse, clipFromInterval, feasibility, planStarTrail } from '../src/photo/sequence.mjs';

const Z5 = profile(NIKON_Z5);
const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/* ---------- the exposure equation ---------- */

test('sunny-16 and the overcast reference land where they should', () => {
  close(ev({ aperture: 16, shutter: 1 / 100, iso: 100 }), 14.64, 0.02);
  close(ev({ aperture: 11, shutter: 1 / 34, iso: 100 }), 12, 0.02);
});

test('each solver inverts the others', () => {
  const target = ev({ aperture: 5.6, shutter: 1 / 250, iso: 400 });
  close(shutterFor({ ev: target, aperture: 5.6, iso: 400 }), 1 / 250, 1e-9);
  close(apertureFor({ ev: target, shutter: 1 / 250, iso: 400 }), 5.6, 1e-9);
  close(isoFor({ ev: target, aperture: 5.6, shutter: 1 / 250 }), 400, 1e-6);
});

test('doubling ISO buys exactly one stop', () => {
  close(ev({ aperture: 4, shutter: 1 / 60, iso: 200 }) - ev({ aperture: 4, shutter: 1 / 60, iso: 400 }), 1);
});

test('snapping picks the nearest legal value in stops, not in units', () => {
  /*
   * 0.024s sits between 1/60 and 1/30, past their geometric mean but short of
   * their arithmetic one — the window where the two measures disagree. Linear
   * distance would reach for 1/60; the ear and the sensor both work in stops,
   * so 1/30 is the right answer.
   */
  const r = snap(0.024, [1 / 60, 1 / 30]);
  close(r.value, 1 / 30, 1e-9);
  assert.equal(r.exact, false);
  assert.ok(Math.abs(0.024 - 1 / 60) < Math.abs(0.024 - 1 / 30), 'linear distance really does prefer the other one');
});

test('an exact legal value snaps to itself and says so', () => {
  const r = snap(1 / 250, [1 / 125, 1 / 250, 1 / 500]);
  assert.equal(r.exact, true);
  assert.equal(r.offBy, 0);
});

test('an empty legal list passes the value through rather than inventing one', () => {
  assert.deepEqual(snap(0.5, []), { value: 0.5, exact: true, offBy: 0 });
});

test('shutter formatting reads the way a photographer writes it', () => {
  assert.equal(formatShutter(1 / 250), '1/250');
  assert.equal(formatShutter(2.5), '2.5s');
  assert.equal(formatShutter(30), '30s');
});

/* ---------- the body ---------- */

test('the Z5 sensor yields the pixel pitch the NPF rule needs', () => {
  close(Z5.pixelPitchUm, 5.97, 0.01);
  close(pixelPitchUm({ sensorWidthMm: 35.9, widthPx: 6016 }), 5.97, 0.01);
});

test('the pixel circle of confusion is far tighter than the traditional one', () => {
  assert.ok(Z5.cocPixelMm < Z5.cocMm / 2);
});

/* ---------- motion ---------- */

test('NPF at 20mm f/1.8 is twelve seconds, where the 500 rule says twenty-five', () => {
  close(npfLimit({ focalLength: 20, aperture: 1.8, pixelPitchUm: Z5.pixelPitchUm }), 12.1, 0.1);
  close(rule500({ focalLength: 20 }), 25, 0.01);
});

test('stars nearer the pole allow a longer exposure', () => {
  const equator = npfLimit({ focalLength: 20, aperture: 1.8, pixelPitchUm: Z5.pixelPitchUm, declinationDeg: 0 });
  const core = npfLimit({ focalLength: 20, aperture: 1.8, pixelPitchUm: Z5.pixelPitchUm, declinationDeg: -29 });
  const pole = npfLimit({ focalLength: 20, aperture: 1.8, pixelPitchUm: Z5.pixelPitchUm, declinationDeg: 80 });
  assert.ok(core > equator, 'the galactic core sits off the equator and allows longer');
  assert.ok(pole > core * 3, 'near the pole the stars barely move');
});

test('a longer lens allows less time', () => {
  const wide = npfLimit({ focalLength: 14, aperture: 2.8, pixelPitchUm: Z5.pixelPitchUm });
  const long = npfLimit({ focalLength: 50, aperture: 2.8, pixelPitchUm: Z5.pixelPitchUm });
  assert.ok(wide > long * 3);
});

test('stabilisation buys stops against the reciprocal rule', () => {
  close(handheldLimit({ focalLength: 20, stabilisationStops: 0 }), 1 / 20, 1e-9);
  close(handheldLimit({ focalLength: 20, stabilisationStops: 5 }), 1.6, 1e-9);
});

test('a subject crossing the frame blurs sooner than one coming at you', () => {
  const base = { speedKmh: 30, distanceM: 20, focalLength: 200, pixelPitchUm: Z5.pixelPitchUm };
  const across = subjectMotionLimit({ ...base, angleDeg: 90 });
  const oblique = subjectMotionLimit({ ...base, angleDeg: 20 });
  assert.ok(oblique > across * 2);
  assert.ok(across < 1 / 500, 'a bird at 30km/h and 20m needs a fast shutter');
});

test('water looks scale with how fast the water moves', () => {
  const slow = waterShutter({ look: 'silk', flow: 'slow' });
  const fast = waterShutter({ look: 'silk', flow: 'fast' });
  assert.ok(slow.low > fast.low, 'a slow wide fall needs longer to look silky');
  assert.match(slow.says, /silk/);
});

/* ---------- depth ---------- */

test('hyperfocal shortens as the lens is stopped down', () => {
  const wide = hyperfocalMm({ focalLength: 20, aperture: 2.8, cocMm: Z5.cocMm });
  const stopped = hyperfocalMm({ focalLength: 20, aperture: 11, cocMm: Z5.cocMm });
  assert.ok(stopped < wide / 3);
});

test('focusing at or past hyperfocal reaches infinity', () => {
  const { hyperfocal, far, near } = depthOfField({ focalLength: 20, aperture: 8, distanceMm: 3000, cocMm: Z5.cocMm });
  assert.ok(3000 > hyperfocal);
  assert.equal(far, Infinity);
  close(near / 1000, 1.11, 0.02);
});

test('a near subject has a far limit, and it is beyond the subject', () => {
  const { near, far } = depthOfField({ focalLength: 85, aperture: 1.8, distanceMm: 2000, cocMm: Z5.cocMm });
  assert.ok(Number.isFinite(far));
  assert.ok(near < 2000 && far > 2000);
});

test('diffraction bites around f/9 on this sensor, which is why f/22 is bad advice', () => {
  close(diffractionLimitedAperture({ pixelPitchUm: Z5.pixelPitchUm }), 8.9, 0.1);
  assert.ok(airyDiskUm({ aperture: 22 }) > Z5.pixelPitchUm * 4);
});

/* ---------- filters ---------- */

test('two seconds at f/11 and ISO 100 needs six stops overcast and nine in sun', () => {
  const overcast = shutterFor({ ev: 12, aperture: 11, iso: 100 });
  const sun = shutterFor({ ev: 15, aperture: 11, iso: 100 });
  close(ndStopsNeeded({ meteredShutter: overcast, targetShutter: 2 }), 6.09, 0.02);
  close(ndStopsNeeded({ meteredShutter: sun, targetShutter: 2 }), 9.09, 0.02);
});

test('a polariser already on the lens counts toward the total', () => {
  const metered = shutterFor({ ev: 12, aperture: 11, iso: 100 });
  const bare = ndStopsNeeded({ meteredShutter: metered, targetShutter: 2 });
  const withCpl = ndStopsNeeded({ meteredShutter: metered, targetShutter: 2, polariser: true });
  close(bare - withCpl, POLARISER_STOPS, 1e-9);
});

test('filters stack when no single one is enough', () => {
  const six = chooseNd(6.09);
  assert.deepEqual(six.filters, [6]);
  assert.equal(ndName(6), 'ND64');
  const nine = chooseNd(9.09);
  assert.equal(nine.total, 9);
  assert.ok(nine.filters.length > 1, 'nine stops is not a filter anyone owns');
});

test('a third of a stop needs no filter at all', () => {
  assert.deepEqual(chooseNd(0.3).filters, []);
});

test('it only reaches for filters you actually own', () => {
  const pick = chooseNd(9.09, { owned: [3, 6] });
  assert.ok(pick.filters.every((f) => f === 3 || f === 6));
  assert.ok(pick.total <= 9.09 + 0.34);
});

/* ---------- sequences ---------- */

test('a twenty-second clip across two hours is 600 frames twelve seconds apart', () => {
  const plan = planTimelapse({ durationS: 7200, clipSeconds: 20, fps: 30 });
  assert.equal(plan.frames, 600);
  close(plan.intervalS, 12, 1e-9);
});

test('interval and clip length invert each other', () => {
  const back = clipFromInterval({ durationS: 7200, intervalS: 12, fps: 30 });
  assert.equal(back.frames, 600);
  close(back.clipSeconds, 20, 1e-9);
});

test('an interval shorter than exposure plus write is caught, and says by how much', () => {
  const { ok, problems } = feasibility({ frames: 100, intervalS: 8, exposureS: 10, writeS: 1.5 });
  assert.equal(ok, false);
  assert.equal(problems[0].kind, 'interval');
  assert.match(problems[0].fix, /12/);
});

test('the card and the battery are separate walls with separate fixes', () => {
  const tight = feasibility({
    frames: 600, intervalS: 12, exposureS: 10,
    cardFreeBytes: 2e9, frameBytes: 30e6, batteryPercent: 41,
  });
  assert.deepEqual(tight.problems.map((p) => p.kind), ['card', 'battery']);
  assert.ok(tight.problems.every((p) => p.fix.length > 0));
});

test('a run that fits reports no problems at all', () => {
  const fine = feasibility({
    frames: 600, intervalS: 12, exposureS: 10,
    cardFreeBytes: 40e9, frameBytes: 30e6, batteryPercent: 100,
  });
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.problems, []);
});

test('star trails push the interval down to the write time to avoid dashes', () => {
  const quick = planStarTrail({ totalMinutes: 120, exposureS: 30, writeS: 1 });
  close(quick.intervalS, 31, 1e-9);
  assert.equal(quick.frames, 232);
  assert.match(quick.says, /continuous/);
  assert.match(planStarTrail({ totalMinutes: 120, exposureS: 30, writeS: 4 }).says, /dashes/);
});
