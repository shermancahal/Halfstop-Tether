import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DPC, MODES, toSeconds, toFNumber, toMillimetres, fromSeconds, fromFNumber,
  readCameraState, toPlannerContext, lensFrom,
} from '../src/camera/live.mjs';
import { planFor } from '../src/plan/index.mjs';

/* A session that answers with descriptors, the way a camera would. */
const fakeSession = (descs) => ({
  async getPropDesc(code) {
    const d = descs[code];
    if (!d) throw new Error(`Operation not supported (property 0x${code.toString(16)})`);
    return d;
  },
});

const enumDesc = (current, values, writable = true, dataType = 0x0004) =>
  ({ code: 0, dataType, writable, current, form: 'enum', values, range: null });

/* A Z5 in manual: shutter and aperture writable, as the probe measured. */
const Z5_MANUAL = {
  [DPC.ExposureTime]: enumDesc(120000, [1250, 10000, 120000, 300000], true, 0x0006),
  [DPC.FNumber]: enumDesc(180, [180, 280, 400, 560, 800]),
  [DPC.ExposureIndex]: enumDesc(400, [100, 200, 400, 800, 1600, 3200, 6400]),
  [DPC.ExposureProgramMode]: enumDesc(1, [1, 2, 3, 4], false),
  [DPC.FocalLength]: enumDesc(2000, [2000], false, 0x0006),
  [DPC.BatteryLevel]: enumDesc(87, [], true, 0x0002),
};

test('PTP integers become the units a photographer uses', () => {
  assert.equal(toSeconds(120000), 12, '120000 tenths of a millisecond is twelve seconds');
  assert.equal(toSeconds(80), 0.008);
  assert.equal(toFNumber(280), 2.8);
  assert.equal(toMillimetres(2000), 20);
});

test('and back again, for writing', () => {
  assert.equal(fromSeconds(12), 120000);
  assert.equal(fromFNumber(2.8), 280);
  assert.equal(fromSeconds(toSeconds(1250)), 1250, 'a round trip changes nothing');
});

test('exposure program numbers are the letters on the dial', () => {
  assert.deepEqual([MODES[1], MODES[2], MODES[3], MODES[4]], ['M', 'P', 'A', 'S']);
});

test('reading a camera yields decoded values and who may set them', async () => {
  const { axes, missing } = await readCameraState(fakeSession(Z5_MANUAL));
  assert.equal(axes.shutter.value, 12);
  assert.equal(axes.aperture.value, 1.8);
  assert.equal(axes.iso.value, 400);
  assert.equal(axes.mode.value, 'M');
  assert.equal(axes.focalLength.value, 20);
  assert.deepEqual(axes.aperture.legal, [1.8, 2.8, 4, 5.6, 8]);
  assert.equal(axes.mode.writable, false, 'the dial is not ours');
  assert.deepEqual(missing, []);
});

test('a property this body does not offer is recorded, not fatal', async () => {
  const partial = { ...Z5_MANUAL };
  delete partial[DPC.FocalLength];
  const { axes, missing } = await readCameraState(fakeSession(partial));
  assert.ok(axes.shutter, 'the rest still read');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, 'focalLength');
  assert.match(missing[0].why, /not supported/i);
});

test('the planner context reports only the mode the camera is in', async () => {
  const state = await readCameraState(fakeSession(Z5_MANUAL));
  const ctx = toPlannerContext(state, { model: 'Nikon Z5', pixelPitchUm: 5.97, widthPx: 6016 });
  assert.equal(ctx.mode, 'M');
  assert.deepEqual(Object.keys(ctx.writableByMode), ['M'], 'a connected body can only speak for where the dial is');
  assert.deepEqual(ctx.writableByMode.M.sort(), ['aperture', 'iso', 'shutter']);
  assert.equal(ctx.batteryPercent, 87);
});

test('in aperture priority the camera owns the shutter, and says so', async () => {
  const inA = {
    ...Z5_MANUAL,
    [DPC.ExposureProgramMode]: enumDesc(3, [1, 2, 3, 4], false),
    [DPC.ExposureTime]: enumDesc(120000, [1250, 10000, 120000], false, 0x0006),
  };
  const ctx = toPlannerContext(await readCameraState(fakeSession(inA)), { pixelPitchUm: 5.97, widthPx: 6016 });
  assert.equal(ctx.mode, 'A');
  assert.ok(!ctx.writableByMode.A.includes('shutter'));
  assert.ok(ctx.writableByMode.A.includes('aperture'));
});

test('a plan against a live camera in the wrong mode asks for the dial', async () => {
  const inA = {
    ...Z5_MANUAL,
    [DPC.ExposureProgramMode]: enumDesc(3, [1, 2, 3, 4], false),
    [DPC.ExposureTime]: enumDesc(120000, [1250, 10000, 120000], false, 0x0006),
  };
  const state = await readCameraState(fakeSession(inA));
  const camera = toPlannerContext(state, { pixelPitchUm: 5.97, widthPx: 6016 });
  const plan = planFor('milky-way', { camera, lens: lensFrom(state), site: { bortle: 2 } });
  const dial = plan.checks.find((c) => c.kind === 'mode-dial');
  assert.ok(dial, 'the camera is in A and this plan sets both corners');
  assert.equal(dial.appCanFix, false);
});

test('the lens reports itself when it can, and is assumed when it cannot', async () => {
  const withLens = lensFrom(await readCameraState(fakeSession(Z5_MANUAL)));
  assert.equal(withLens.focalLength, 20);
  assert.equal(withLens.maxAperture, 1.8, 'the widest legal aperture is the lens speed');
  assert.equal(withLens.reported, true);

  const noLens = { ...Z5_MANUAL };
  delete noLens[DPC.FocalLength];
  const guessed = lensFrom(await readCameraState(fakeSession(noLens)), { focalLength: 35 });
  assert.equal(guessed.focalLength, 35);
  assert.equal(guessed.reported, false, 'so the interface can say it is assuming');
});

test('a plan solved against a live camera uses values it will accept', async () => {
  const state = await readCameraState(fakeSession(Z5_MANUAL));
  const camera = toPlannerContext(state, { pixelPitchUm: 5.97, widthPx: 6016 });
  const plan = planFor('milky-way', { camera, lens: lensFrom(state), site: { bortle: 2 } });
  assert.ok(camera.legal.iso.includes(plan.settings.iso), `ISO ${plan.settings.iso} is not on this camera`);
  assert.equal(plan.settings.aperture, 1.8);
});
