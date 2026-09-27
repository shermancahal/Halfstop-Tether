/*
 * A slow shutter, on anything that is not a waterfall.
 *
 * Clouds, traffic, sea, crowds. The photographer picks what should smear
 * rather than a number of seconds, because how long that takes depends on how
 * fast the thing is actually moving — and in daylight the answer is almost
 * always "longer than the light allows", which makes the filter the real
 * output here just as it is for waterfalls.
 */

import { blurShutter } from '../../photo/motion.mjs';
import { diffractionLimitedAperture } from '../../photo/depth.mjs';
import { solveExposure, SCENE_EV } from '../../photo/exposure.mjs';
import { stabilityAdvice } from '../../photo/stability.mjs';
import { chooseNd, ndName, POLARISER_STOPS } from '../../photo/filters.mjs';
import { formatShutter } from '../../photo/units.mjs';
import { makePlan, modeCheck } from '../plan.mjs';

export const longExposure = {
  id: 'long-exposure',
  title: 'Long exposure',
  pins: ['shutter', 'aperture'],

  options: [
    {
      id: 'subject',
      label: 'What should smear',
      says: 'The rest of the frame stays put',
      choices: [
        { id: 'clouds', label: 'Clouds', says: 'Weather drawn as streaks' },
        { id: 'traffic', label: 'Traffic', says: 'Headlights into unbroken lines' },
        { id: 'sea', label: 'Sea', says: 'Swell flattened to mist' },
        { id: 'crowds', label: 'Crowds', says: 'Everyone walking disappears' },
      ],
    },
    {
      id: 'light',
      label: 'The light',
      choices: [
        { id: 'bright sun', label: 'Bright sun' },
        { id: 'overcast', label: 'Overcast' },
        { id: 'sunset', label: 'Sunset' },
        { id: 'night city', label: 'Night' },
      ],
    },
  ],

  plan({ camera, lens, want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });
    p.options = this.options;
    p.want = want;

    const subject = want.subject ?? 'clouds';
    const light = want.light ?? 'overcast';
    const { low, high, says } = blurShutter({ subject, pace: want.pace ?? 'average' });
    const shutter = Math.sqrt(low * high);    /* the middle of the window, in stops */

    p.set('shutter', shutter, `${says} — ${formatShutter(low)} starts it, ${formatShutter(high)} is past where more helps`);

    const ceiling = Math.round(diffractionLimitedAperture({ pixelPitchUm: camera.pixelPitchUm }));
    const aperture = Math.min(want.aperture ?? 11, ceiling);
    p.set('aperture', aperture, aperture < (want.aperture ?? 11)
      ? `Held at f/${aperture}; past there diffraction softens more than the depth is worth on this sensor`
      : 'Deep enough for a foreground, short of the diffraction ceiling');
    p.set('iso', camera.baseIso ?? 100, 'Base ISO — nothing about a tripod shot wants noise');

    /*
     * Three pinned corners again, so the exposure is not meant to balance.
     * What is left over is the filter, and in daylight it is most of the
     * reason this shot needs planning at all.
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
    } else if (needed < -1) {
      p.warn(`There is ${Math.abs(needed).toFixed(1)} stops less light than this shutter wants. `
        + 'Open up, raise ISO, or accept a shorter exposure than the look needs.');
    }

    modeCheck({ plan: p, camera, pins: this.pins });
    for (const advice of stabilityAdvice({
      shutterS: shutter, focalLength: lens.focalLength, support: 'tripod',
      stabilisationOn: camera.stabilisationOn ?? true,
    })) p.check(advice);

    if (subject === 'traffic') {
      p.warn('Headlights clip long before the rest of the frame. Expose for the road, not the lights.');
    }
    return p;
  },
};
