/*
 * The Milky Way.
 *
 * Answers the schedule question before the settings question, because tonight
 * may be the wrong night and no exposure triangle fixes that.
 */

import { npfLimit, rule500 } from '../../photo/motion.mjs';
import { trackedLimit, driftRate, ALIGNMENTS } from '../../photo/tracking.mjs';
import { formatShutter } from '../../photo/units.mjs';
import { solveExposure, SCENE_EV } from '../../photo/exposure.mjs';
import { stabilityAdvice } from '../../photo/stability.mjs';
import { makePlan, modeCheck, foldExposureNotes } from '../plan.mjs';

/* Sky brightness by Bortle class, in EV at ISO 100. Darker sites need more ISO. */
const SKY_EV = { 1: -6.5, 2: -6, 3: -5.5, 4: -5, 5: -4.5, 6: -4, 7: -3.5, 8: -3, 9: -2.5 };

export const milkyWay = {
  id: 'milky-way',
  title: 'Milky Way',
  pins: ['shutter', 'aperture'],

  /*
   * What the app cannot see and has to be told. A tracker is bolted to the
   * tripod, not to the camera, so no property will ever report it — and it
   * changes the answer more than anything the camera could say.
   */
  options: [{
    id: 'tracker',
    label: 'Star tracker',
    says: 'A Move Shoot Move, Star Adventurer or similar',
    choices: [
      { id: '', label: 'None', says: 'Tripod only' },
      ...Object.values(ALIGNMENTS).map(({ id, label, says }) => ({ id, label, says })),
    ],
  }],

  plan({ camera, lens, sky, site = {}, want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });
    /* So the interface can offer them without knowing what they mean. */
    p.options = this.options;
    p.want = want;

    /* The schedule comes first. A perfect exposure on a night with no window
     * is still a wasted drive. */
    if (sky) {
      p.schedule = sky;
      if (!sky.window) {
        p.warn('There is no window tonight when the core is up and the sky is dark and moonless.');
      }
    }

    const declinationDeg = want.declinationDeg ?? -29;  /* the galactic centre */
    const geometry = { focalLength: lens.focalLength, pixelPitchUm: camera.pixelPitchUm, declinationDeg };
    const untracked = npfLimit({ ...geometry, aperture: lens.maxAperture });
    const tracker = ALIGNMENTS[want.tracker] ?? null;

    /*
     * Tracked, the question changes. Untracked you are racing the sky; on a
     * tracker you are only racing the part of the sky's motion the mount fails
     * to cancel, which is smaller by the sine of the polar error. That is the
     * difference between ISO 40000 and ISO 200, not a stop here or there.
     */
    const shutter = tracker ? trackedLimit({ ...geometry, misalignmentDeg: tracker.misalignmentDeg }) : untracked;

    p.set('shutter', shutter, tracker
      ? `${tracker.label.toLowerCase()}, so ${tracker.misalignmentDeg}° of polar error is left uncancelled — `
        + `${(driftRate({ misalignmentDeg: tracker.misalignmentDeg, declinationDeg }) * 60).toFixed(1)} arcsec a minute, `
        + `which crosses a pixel and a half at ${lens.focalLength}mm in this long. `
        + `Off the tracker it would be ${formatShutter(untracked)}.`
      : `The longest the stars stay points at ${lens.focalLength}mm on a ${camera.widthPx}px sensor. `
        + `That is the NPF limit, which counts the pixels the stars land on; the old 500 rule would `
        + `have allowed ${formatShutter(rule500({ focalLength: lens.focalLength }))} and trailed them.`);
    p.set('aperture', lens.maxAperture, 'Wide open; there is no light to spare');

    const evScene = SKY_EV[site.bortle ?? 4] ?? SCENE_EV['moonless milky way'];
    const solved = solveExposure({
      evScene, want: { shutter, aperture: lens.maxAperture }, absorb: 'iso',
      bounds: { iso: camera.isoBounds ?? [100, 25600] },
      legal: camera.legal ?? {},
    });
    p.set('iso', solved.iso, `For a Bortle ${site.bortle ?? 4} sky at this shutter and aperture`);
    /*
     * Show what the camera will take, not what the physics asked for. The
     * solver has already snapped every axis to the values this body offers,
     * and a plan that reads 240s on a camera whose dial stops at 30 is a plan
     * nobody can follow.
     */
    p.set('shutter', solved.shutter, p.reasons.shutter);
    p.set('aperture', solved.aperture, p.reasons.aperture);
    foldExposureNotes(p, solved);

    if (tracker) {
      const longest = camera.legal?.shutter?.at(-1);
      if (longest && shutter > longest * 1.05) {
        p.warn(`The tracker would hold ${formatShutter(shutter)}, but the longest timed exposure this `
          + `body offers is ${formatShutter(longest)} — go past that with bulb and a remote, or stack more frames at this length.`);
      }
      p.warn('The ground blurs while the sky is tracked. Shoot one untracked frame for the foreground and blend the two.');
    }

    /*
     * Everything below is about the exposure that will actually be taken, not
     * the one the physics asked for. Advising bulb for a 240-second exposure
     * the solver already cut to 30 is advice about a plan that is not on
     * screen - the same mistake as solving ISO against a shutter that then
     * snapped away from it.
     */
    const taken = p.settings.shutter;

    /* Stacking is the answer to noise that ISO cannot fix. */
    const frames = want.frames ?? (tracker ? 8 : 16);
    p.sequence = { frames, intervalS: taken + 2, totalS: frames * (taken + 2) };

    modeCheck({ plan: p, camera, pins: this.pins });
    for (const advice of stabilityAdvice({
      shutterS: taken, focalLength: lens.focalLength, support: 'tripod',
      stabilisationOn: camera.stabilisationOn ?? true,
    })) p.check(advice);

    if (camera.longExposureNR) {
      p.check({
        kind: 'long-exposure-nr',
        says: 'Long-exposure noise reduction is on, which doubles every frame.',
        fix: 'I will switch it off — stacking undoes the need for it.',
        appCanFix: true,
      });
    }
    return p;
  },
};
