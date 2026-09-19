/*
 * Timelapse: mostly arithmetic, and the arithmetic is where it goes wrong.
 *
 * The interval has to clear the exposure plus the write, the card has to hold
 * the frames, and the battery has to last. Each of those ends a run early and
 * none of them announces itself at frame one.
 */

import { planTimelapse, feasibility } from '../../photo/sequence.mjs';
import { solveExposure, SCENE_EV } from '../../photo/exposure.mjs';
import { makePlan, modeCheck, foldExposureNotes } from '../plan.mjs';

export const timelapse = {
  id: 'timelapse',
  title: 'Timelapse',
  pins: ['shutter', 'aperture'],

  plan({ camera, lens, light = 'overcast', want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });

    const durationS = want.durationS ?? 7200;
    const clipSeconds = want.clipSeconds ?? 20;
    const fps = want.fps ?? 30;
    const seq = planTimelapse({ durationS, clipSeconds, fps });

    const aperture = want.aperture ?? 8;
    const solved = solveExposure({
      evScene: SCENE_EV[light] ?? SCENE_EV.overcast,
      want: { aperture, iso: camera.baseIso ?? 100 }, absorb: 'shutter',
      bounds: { shutter: [1 / 8000, Math.min(30, seq.intervalS - 1.5)] },
      legal: camera.legal ?? {},
    });
    p.set('aperture', aperture, 'Fixed for the whole run; a changing aperture flickers between frames');
    p.set('iso', solved.iso, 'Base ISO, held constant so the frames match');
    p.set('shutter', solved.shutter, `Fits inside the ${seq.intervalS.toFixed(1)}s interval with room to write`);
    foldExposureNotes(p, solved);

    p.sequence = {
      ...seq,
      says: `${seq.frames} frames, ${seq.intervalS.toFixed(1)}s apart, for ${clipSeconds}s at ${fps}fps`,
    };

    const check = feasibility({
      frames: seq.frames, intervalS: seq.intervalS, exposureS: solved.shutter,
      writeS: want.writeS ?? 1.5,
      cardFreeBytes: camera.cardFreeBytes, frameBytes: camera.frameBytes,
      batteryPercent: camera.batteryPercent,
    });
    for (const problem of check.problems) {
      p.check({ kind: problem.kind, says: problem.says, fix: problem.fix, appCanFix: false });
    }

    /*
     * A run that crosses sunset is a different problem: the light falls away by
     * several stops and a fixed exposure cannot follow it.
     */
    if (want.crossesSunset) {
      p.warn('This run crosses sunset, so the light will drop faster than a fixed exposure can follow. That wants a ramp, which is its own plan.');
    }

    modeCheck({ plan: p, camera, pins: this.pins });
    return p;
  },
};
