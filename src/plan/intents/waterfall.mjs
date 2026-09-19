/*
 * Waterfalls, where the blur is the subject.
 *
 * The photographer picks a look rather than a shutter speed, because what each
 * speed buys depends on how fast the water is actually moving. The output other
 * apps never give is the filter.
 */

import { waterShutter } from '../../photo/motion.mjs';
import { diffractionLimitedAperture } from '../../photo/depth.mjs';
import { solveExposure, SCENE_EV } from '../../photo/exposure.mjs';
import { stabilityAdvice } from '../../photo/stability.mjs';
import { chooseNd, ndName, POLARISER_STOPS } from '../../photo/filters.mjs';
import { makePlan, modeCheck } from '../plan.mjs';

export const waterfall = {
  id: 'waterfall',
  title: 'Waterfalls',
  pins: ['shutter', 'aperture'],

  plan({ camera, lens, light = 'overcast', want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });

    const look = want.look ?? 'silk';
    const { low, high, says } = waterShutter({ look, flow: want.flow ?? 'average' });
    const shutter = (low + high) / 2;
    p.set('shutter', shutter, `${look} — ${says}, for water running ${want.flow ?? 'at an average pace'}`);

    /* Stopping down past where diffraction bites costs more than it buys. */
    const ceiling = diffractionLimitedAperture({ pixelPitchUm: camera.pixelPitchUm });
    const aperture = Math.min(want.aperture ?? 11, Math.round(ceiling));
    p.set('aperture', aperture,
      aperture < (want.aperture ?? 11)
        ? `Held at f/${aperture}; past there diffraction softens more than the depth is worth on this sensor`
        : 'Enough depth for a foreground without reaching the diffraction ceiling');
    p.set('iso', camera.baseIso ?? 100, 'Base ISO — there is no reason to add noise to a tripod shot');

    /*
     * All three corners are pinned, so the exposure will not balance. The gap
     * is not a failure; it is the filter.
     */
    const solved = solveExposure({
      evScene: SCENE_EV[light] ?? SCENE_EV.overcast,
      want: { shutter, aperture, iso: camera.baseIso ?? 100 },
      absorb: 'none',
    });
    const needed = solved.errorStops - (want.polariser ? POLARISER_STOPS : 0);
    if (needed > 0.34) {
      const pick = chooseNd(needed, want.ownedNd ? { owned: want.ownedNd } : undefined);
      p.filters = {
        stopsNeeded: needed, ...pick,
        names: pick.filters.map(ndName),
        says: `${needed.toFixed(1)} stops of neutral density in ${light}${want.polariser ? ', after the polariser' : ''}`,
      };
      if (Math.abs(pick.residual) > 0.34) {
        p.warn(`Those filters land ${pick.residual.toFixed(1)} stops off; close the rest with aperture or ISO.`);
      }
    }

    modeCheck({ plan: p, camera, pins: this.pins });
    for (const advice of stabilityAdvice({
      shutterS: shutter, focalLength: lens.focalLength, support: 'tripod',
      stabilisationOn: camera.stabilisationOn ?? true,
    })) p.check(advice);

    p.warn('White water clips before anything else in the frame and does not come back.');
    return p;
  },
};
