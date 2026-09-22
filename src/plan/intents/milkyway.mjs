/*
 * The Milky Way.
 *
 * Answers the schedule question before the settings question, because tonight
 * may be the wrong night and no exposure triangle fixes that.
 */

import { npfLimit, rule500 } from '../../photo/motion.mjs';
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

  plan({ camera, lens, sky, site = {}, want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });

    /* The schedule comes first. A perfect exposure on a night with no window
     * is still a wasted drive. */
    if (sky) {
      p.schedule = sky;
      if (!sky.window) {
        p.warn('There is no window tonight when the core is up and the sky is dark and moonless.');
      }
    }

    const declinationDeg = want.declinationDeg ?? -29;  /* the galactic centre */
    const shutter = npfLimit({
      focalLength: lens.focalLength, aperture: lens.maxAperture,
      pixelPitchUm: camera.pixelPitchUm, declinationDeg,
    });
    p.set('shutter', shutter,
      `The longest the stars stay points at ${lens.focalLength}mm on a ${camera.widthPx}px sensor. `
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
    foldExposureNotes(p, solved);

    /* Stacking is the answer to noise that ISO cannot fix. */
    const frames = want.frames ?? 16;
    p.sequence = { frames, intervalS: shutter + 2, totalS: frames * (shutter + 2) };

    modeCheck({ plan: p, camera, pins: this.pins });
    for (const advice of stabilityAdvice({
      shutterS: shutter, focalLength: lens.focalLength, support: 'tripod',
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
