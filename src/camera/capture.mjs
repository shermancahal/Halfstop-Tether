/*
 * Firing the shutter, and firing it repeatedly on a schedule.
 *
 * The intervalometer and the timelapse have been in the catalogue since the
 * first screen and could not do the one thing they exist for. The solver
 * already produces the sequence — how many frames, how far apart — so this is
 * only the part that makes the camera act on it.
 *
 * Nothing here decides anything. It takes a sequence, presses the button, and
 * waits for the body to say it has finished before pressing it again, which is
 * the difference between a timelapse and a pile of missed frames.
 */

import { OC } from '../ptp/codec.mjs';

/** Standard first, vendor second: portable where possible, working always. */
const CAPTURE_OPS = [
  { opcode: OC.InitiateCapture, params: [0, 0], name: 'InitiateCapture' },
  { opcode: OC.NikonInitiateCaptureRecInMedia, params: [0xffffffff, 0], name: 'NikonInitiateCaptureRecInMedia' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One frame.
 *
 * Which operation a body actually honours is not something its operation list
 * settles — plenty of them advertise the standard one and record nothing — so
 * the first frame finds out and every frame after it uses what worked.
 */
export async function fireShutter(session) {
  const offered = CAPTURE_OPS.filter((op) => session.supports(op.opcode));
  if (!offered.length) throw new Error('This body offers no capture operation over PTP.');

  const known = offered.find((op) => op.name === session.captureOp);
  for (const op of known ? [known] : offered) {
    try {
      await session.transaction({ opcode: op.opcode, params: op.params });
      session.captureOp = op.name;
      return op.name;
    } catch (error) {
      /* Keep the last refusal to report if nothing works. */
      if (op === offered.at(-1) || known) throw error;
    }
  }
  throw new Error('No capture operation was accepted.');
}

/**
 * Wait for the body to finish what it is doing.
 *
 * Nikon answers DeviceReady with Device Busy until the exposure is written,
 * which is a better clock than any number we could compute: bulb, long-
 * exposure noise reduction and a slow card all extend it, and none of them are
 * visible from here. Bodies without it get the arithmetic instead.
 */
export async function waitUntilReady(session, {
  exposureS = 0, timeoutMs = 120000, pollMs = 250, settleMs = 1500,
} = {}) {
  if (!session.supports(OC.NikonDeviceReady)) {
    /* The exposure, plus enough for a raw file to reach the card. A guess,
     * and named as one — the body that can be asked is asked below. */
    await sleep(exposureS * 1000 + settleMs);
    return 'waited';
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await session.transaction({ opcode: OC.NikonDeviceReady });
      return 'ready';
    } catch (error) {
      /* 0x2019 and 0x2013 are both "busy" in the wild. Anything else is real. */
      if (error.code !== 0x2019 && error.code !== 0x2013) throw error;
      await sleep(pollMs);
    }
  }
  throw new Error(`The camera was still busy after ${Math.round(timeoutMs / 1000)}s.`);
}

/**
 * A run of frames, spaced as the plan asked.
 *
 * The interval is measured from the start of one frame to the start of the
 * next, not from the end of one to the start of the next — a timelapse whose
 * spacing drifts by the exposure length is a timelapse that speeds up when the
 * light fails. If a frame overruns its slot the next one starts immediately
 * and the run says so afterwards rather than silently falling behind.
 */
export async function runSequence({
  session, frames, intervalS, exposureS = 0, settleMs,
  onProgress, stopped = () => false, now = () => Date.now(),
}) {
  const started = now();
  const taken = [];
  let overran = 0;

  for (let frame = 1; frame <= frames; frame++) {
    if (stopped()) break;
    const slotBegan = now();

    onProgress?.({ frame, frames, phase: 'firing', elapsedS: (slotBegan - started) / 1000 });
    await fireShutter(session);
    await waitUntilReady(session, { exposureS, settleMs });

    taken.push({ frame, atS: (slotBegan - started) / 1000 });
    onProgress?.({ frame, frames, phase: 'taken', elapsedS: (now() - started) / 1000 });

    if (frame === frames) break;
    const dueAt = slotBegan + intervalS * 1000;
    if (now() > dueAt) overran += 1;
    /* Sliced, so Stop is answered within a quarter second rather than a slot. */
    while (now() < dueAt && !stopped()) await sleep(Math.min(250, dueAt - now()));
  }

  return {
    taken: taken.length,
    asked: frames,
    stoppedEarly: taken.length < frames,
    overran,
    elapsedS: (now() - started) / 1000,
  };
}
