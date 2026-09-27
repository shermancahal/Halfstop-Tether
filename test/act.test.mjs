/*
 * The half that touches the camera: writing settings, and pressing the button.
 *
 * Everything here is about not lying. A write that was refused says refused, a
 * value the camera took somewhere else says how far, and a sequence that was
 * stopped says how many frames it actually got.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OC, RESPONSE_OK } from '../src/ptp/codec.mjs';
import { PtpSession, PtpError } from '../src/ptp/session.mjs';
import { DPC } from '../src/camera/live.mjs';
import { applyPlan, confirm, describeApply } from '../src/camera/apply.mjs';
import { fireShutter, waitUntilReady, runSequence } from '../src/camera/capture.mjs';

/* A camera that records what it was asked and answers as told. */
function fakeCamera({ writable = true, supports = [OC.InitiateCapture], answer } = {}) {
  const sent = [];
  return {
    sent,
    supports: (op) => supports.includes(op),
    captureOp: undefined,
    async getPropDesc(code) {
      return { code, dataType: code === DPC.ExposureTime ? 0x0006 : 0x0004, writable, current: 0, form: 'none' };
    },
    async transaction(request) {
      sent.push(request);
      if (answer) return answer(request);
      return { data: null, params: [] };
    },
  };
}

const planOf = (settings) => ({ settings });
const stateOf = (axes) => ({ axes });

test('only the axes the camera says are writable get written', async () => {
  const session = fakeCamera();
  const rows = await applyPlan({
    session,
    state: stateOf({
      shutter: { writable: true, value: 1 / 60 },
      aperture: { writable: false, value: 2.8 },
      iso: { writable: true, value: 100 },
    }),
    plan: planOf({ shutter: 1 / 125, aperture: 8, iso: 400 }),
  });

  const by = Object.fromEntries(rows.map((r) => [r.axis, r]));
  assert.equal(by.shutter.outcome, 'wrote');
  assert.equal(by.aperture.outcome, 'refused');
  assert.match(by.aperture.says, /setting it itself/);
  assert.equal(by.iso.outcome, 'wrote');

  const written = session.sent.filter((s) => s.opcode === OC.SetDevicePropValue).map((s) => s.params[0]);
  assert.deepEqual(written, [DPC.ExposureTime, DPC.ExposureIndex], 'and aperture was never sent');
});

test('an axis already at the asked value is left alone', async () => {
  const session = fakeCamera();
  const rows = await applyPlan({
    session,
    state: stateOf({ aperture: { writable: true, value: 8 } }),
    plan: planOf({ aperture: 8 }),
  });
  assert.equal(rows[0].outcome, 'already');
  assert.equal(session.sent.length, 0, 'no write at all');
});

test('a write that returns OK and changes nothing is caught by looking', () => {
  /* Cameras do this. The only defence is to re-read and compare. */
  const rows = [{ axis: 'aperture', wanted: 8, outcome: 'wrote' }];
  const stuck = confirm(rows, stateOf({ aperture: { value: 3.5 } }));
  assert.equal(stuck[0].outcome, 'drifted');
  assert.match(stuck[0].says, /stops away from what was asked/);

  const landed = confirm(rows, stateOf({ aperture: { value: 8 } }));
  assert.equal(landed[0].outcome, 'set');
});

test('the one-line summary leads with what went wrong', () => {
  const rows = [
    { axis: 'shutter', outcome: 'set' },
    { axis: 'aperture', outcome: 'refused', says: 'the camera is setting it itself in this mode' },
  ];
  const said = describeApply(rows);
  assert.match(said, /shutter set/);
  assert.match(said, /aperture: the camera is setting it itself/);
});

test('capture falls back to the vendor operation and then stops asking', async () => {
  let standardTried = 0;
  const session = fakeCamera({
    supports: [OC.InitiateCapture, OC.NikonInitiateCaptureRecInMedia],
    answer: (request) => {
      if (request.opcode === OC.InitiateCapture) { standardTried += 1; throw new PtpError(0x2005, 'InitiateCapture'); }
      return { data: null, params: [] };
    },
  });

  assert.equal(await fireShutter(session), 'NikonInitiateCaptureRecInMedia');
  assert.equal(await fireShutter(session), 'NikonInitiateCaptureRecInMedia');
  assert.equal(standardTried, 1, 'the standard one is tried once, not once per frame');
});

test('busy is waited out; anything else is a real failure', async () => {
  let asked = 0;
  const session = fakeCamera({
    supports: [OC.NikonDeviceReady],
    answer: () => {
      asked += 1;
      if (asked < 3) throw new PtpError(0x2019, 'DeviceReady');
      return { data: null, params: [] };
    },
  });
  assert.equal(await waitUntilReady(session, { pollMs: 1 }), 'ready');
  assert.equal(asked, 3);

  const broken = fakeCamera({
    supports: [OC.NikonDeviceReady],
    answer: () => { throw new PtpError(0x2002, 'DeviceReady'); },
  });
  await assert.rejects(() => waitUntilReady(broken, { pollMs: 1 }), /General error|0x2002/);
});

test('a body with no readiness check gets the arithmetic instead', async () => {
  const session = fakeCamera({ supports: [] });
  const began = Date.now();
  assert.equal(await waitUntilReady(session, { exposureS: 0.05 }), 'waited');
  assert.ok(Date.now() - began >= 1500, 'exposure plus a margin');
});

test('the interval is measured frame to frame, not gap to gap', async () => {
  /*
   * A timelapse spaced from the end of one frame to the start of the next
   * speeds up as the light fails and the exposures shorten. The slot has to
   * start when the frame starts.
   */
  const session = fakeCamera({ supports: [OC.InitiateCapture, OC.NikonDeviceReady] });
  const starts = [];
  const result = await runSequence({
    session, frames: 3, intervalS: 0.12, exposureS: 0,
    onProgress: (p) => { if (p.phase === 'firing') starts.push(Date.now()); },
  });

  assert.equal(result.taken, 3);
  assert.equal(result.stoppedEarly, false);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= 110 && gap < 400, `frame ${i} started ${gap}ms after the one before`);
  }
});

test('stopping is answered inside a slot, not at the end of one', async () => {
  const session = fakeCamera({ supports: [OC.InitiateCapture, OC.NikonDeviceReady] });
  let stop = false;
  const began = Date.now();
  const run = runSequence({
    session, frames: 20, intervalS: 30, exposureS: 0,
    onProgress: (p) => { if (p.frame === 1 && p.phase === 'taken') stop = true; },
    stopped: () => stop,
  });
  const result = await run;

  assert.equal(result.taken, 1, 'the frame in flight finishes');
  assert.equal(result.stoppedEarly, true);
  assert.ok(Date.now() - began < 2000, 'and it does not sit out the thirty-second interval');
});

test('frames that do not fit their slot are counted, not hidden', async () => {
  /*
   * An interval shorter than the exposure plus the write is a request the
   * camera cannot meet. Falling behind silently turns a five-minute timelapse
   * into a twelve-minute one with no explanation.
   */
  const session = fakeCamera({ supports: [OC.InitiateCapture] });
  const result = await runSequence({
    session, frames: 3, intervalS: 0.05, exposureS: 0, settleMs: 120,
  });
  assert.equal(result.taken, 3, 'every frame is still taken');
  assert.equal(result.overran, 2, 'and both gaps are reported as overrun');
});
