/*
 * Frames on a timer, kept as frames.
 *
 * The distinction from a timelapse is the output, and it changes every number.
 * A timelapse works backwards from how long the clip should run, so the frame
 * count is derived and the interval falls out of it. Here the interval is the
 * thing being asked for — one every thirty seconds, for two hours — and what
 * matters is whether the camera can sustain it until the card or the battery
 * gives out.
 */

import { feasibility } from '../../photo/sequence.mjs';
import { solveExposure, SCENE_EV } from '../../photo/exposure.mjs';
import { formatShutter } from '../../photo/units.mjs';
import { makePlan, modeCheck, foldExposureNotes } from '../plan.mjs';

/** A raw frame off a 24-megapixel body, near enough for a card warning. */
const RAW_BYTES = 25e6;

export const intervalometer = {
  id: 'intervalometer',
  title: 'Intervalometer',
  pins: ['shutter', 'aperture'],

  options: [
    {
      id: 'every',
      label: 'One frame every',
      choices: [
        { id: '5', label: '5s' },
        { id: '30', label: '30s' },
        { id: '60', label: '1 min' },
        { id: '300', label: '5 min' },
      ],
    },
    {
      id: 'lasting',
      label: 'For',
      choices: [
        { id: '900', label: '15 min' },
        { id: '3600', label: '1 hour' },
        { id: '14400', label: '4 hours' },
        { id: '43200', label: '12 hours' },
      ],
    },
  ],

  plan({ camera, want = {}, light = 'overcast' }) {
    const p = makePlan({ intent: this.id, title: this.title });
    p.options = this.options;
    p.want = want;

    const intervalS = Number(want.every ?? 30);
    const durationS = Number(want.lasting ?? 3600);
    const frames = Math.max(1, Math.floor(durationS / intervalS) + 1);

    /*
     * The exposure has to finish inside the interval with room to write, or
     * every frame arrives late and the spacing the whole point of this intent
     * quietly stops being true.
     */
    const aperture = want.aperture ?? 8;
    const solved = solveExposure({
      evScene: SCENE_EV[light] ?? SCENE_EV.overcast,
      want: { aperture, iso: camera.baseIso ?? 100 }, absorb: 'shutter',
      bounds: { shutter: [1 / 8000, Math.max(1 / 8000, Math.min(30, intervalS - 1.5))] },
      legal: camera.legal ?? {},
    });
    p.set('aperture', aperture, 'Fixed for the run — an aperture that moves between frames flickers');
    p.set('iso', solved.iso, 'Held constant, so the frames can be compared to each other');
    p.set('shutter', solved.shutter,
      `Fits inside the ${intervalS}s interval with room to write the file`);
    foldExposureNotes(p, solved);

    p.sequence = {
      frames, intervalS, totalS: frames * intervalS,
      says: `${frames} frames, one every ${intervalS}s, kept as frames`,
    };

    const { problems } = feasibility({
      frames, intervalS, exposureS: solved.shutter,
      cardFreeBytes: camera.cardFreeBytes, frameBytes: camera.frameBytes ?? RAW_BYTES,
      batteryPercent: camera.batteryPercent,
    });
    for (const problem of problems) {
      p.check({ kind: problem.kind, says: problem.says, fix: problem.fix, appCanFix: false });
    }

    modeCheck({ plan: p, camera, pins: this.pins });

    if (solved.shutter > intervalS / 2) {
      p.warn(`At ${formatShutter(solved.shutter)} the camera is exposing for more than half of every interval. `
        + 'There is little margin if the light drops.');
    }
    p.warn('The camera will not sleep between frames on its own — set auto power off long enough to cover the run, or it stops without saying so.');
    return p;
  },
};
