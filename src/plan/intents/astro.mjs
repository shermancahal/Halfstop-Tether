/*
 * Everything else that is up there: trails, aurora, meteors.
 *
 * The Milky Way intent is about holding stars still. These three are the
 * opposite or the unrelated case — a trail is motion you want, an aurora moves
 * on its own and does not care that the sky rotates, and a meteor shower is a
 * numbers game where the exposure matters less than how many hours of frames
 * you come home with.
 */

import { npfLimit } from '../../photo/motion.mjs';
import { arcsecPerPixel, SIDEREAL_ARCSEC_PER_SEC } from '../../photo/tracking.mjs';
import { planStarTrail } from '../../photo/sequence.mjs';
import { solveExposure } from '../../photo/exposure.mjs';
import { stabilityAdvice } from '../../photo/stability.mjs';
import { formatShutter } from '../../photo/units.mjs';
import { makePlan, modeCheck, foldExposureNotes } from '../plan.mjs';

const SKY_EV = { 1: -6.5, 2: -6, 3: -5.5, 4: -5, 5: -4.5, 6: -4, 7: -3.5, 8: -3, 9: -2.5 };

/*
 * An aurora is not a fixed brightness and not a fixed speed. A quiet arc sits
 * still and is faint; a substorm moves visibly in a second and is bright
 * enough to overexpose at the settings the quiet arc needed. These are the
 * windows, and the shutter is what has to change — not the ISO.
 */
const AURORA = {
  quiet: { shutterS: 8, evBoost: 0, says: 'a still arc, faint enough to need the time' },
  active: { shutterS: 3, evBoost: 1.5, says: 'moving enough that longer smears the structure' },
  storm: { shutterS: 1, evBoost: 3, says: 'bright and fast — anything longer is a green smudge' },
};

/** How far a star moves in the frame over a whole run, in pixels. */
export function trailLengthPx({ totalS, focalLength, pixelPitchUm, declinationDeg = 45 }) {
  const arcsec = SIDEREAL_ARCSEC_PER_SEC * totalS * Math.cos((declinationDeg * Math.PI) / 180);
  return arcsec / arcsecPerPixel({ focalLength, pixelPitchUm });
}

export const astro = {
  id: 'astro',
  title: 'Astro',
  pins: ['shutter', 'aperture'],

  options: [
    {
      id: 'subject',
      label: 'What is up there',
      choices: [
        { id: 'trails', label: 'Star trails', says: 'Arcs around the pole, stacked from many frames' },
        { id: 'aurora', label: 'Aurora', says: 'Moves on its own; the shutter has to keep up' },
        { id: 'meteors', label: 'Meteors', says: 'Hours of frames, hoping for a few' },
      ],
    },
    {
      id: 'pace',
      label: 'How it is behaving',
      says: 'Aurora only',
      choices: [
        { id: 'quiet', label: 'Quiet arc' },
        { id: 'active', label: 'Active' },
        { id: 'storm', label: 'Substorm' },
      ],
    },
  ],

  plan({ camera, lens, site = {}, want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });
    p.options = this.options;
    p.want = want;

    const subject = want.subject ?? 'trails';
    const bortle = site.bortle ?? 4;
    const aperture = lens.maxAperture;
    let evScene = SKY_EV[bortle] ?? -5;
    let shutter;

    if (subject === 'aurora') {
      const behaviour = AURORA[want.pace ?? 'active'];
      shutter = behaviour.shutterS;
      evScene += behaviour.evBoost;
      p.set('shutter', shutter, `${behaviour.says}. An aurora sets its own shutter speed; the sky's rotation is not the limit here.`);
    } else if (subject === 'trails') {
      /* Thirty seconds is the longest most bodies offer without bulb, and the
       * gap between frames is what shows in the trail, so shorter frames would
       * only add dashes. */
      shutter = Math.min(30, camera.legal?.shutter?.at(-1) ?? 30);
      p.set('shutter', shutter, 'The longest timed frame the body offers — the gaps between frames are what break a trail, so fewer, longer frames is the whole trick');
    } else {
      shutter = npfLimit({
        focalLength: lens.focalLength, aperture,
        pixelPitchUm: camera.pixelPitchUm, declinationDeg: want.declinationDeg ?? 0,
      });
      p.set('shutter', shutter, `The NPF limit at ${lens.focalLength}mm. Meteors arrive whenever they arrive, so the stars staying round is the only thing the shutter has to get right.`);
    }

    p.set('aperture', aperture, 'Wide open; none of these have light to spare');

    const solved = solveExposure({
      evScene, want: { shutter, aperture }, absorb: 'iso',
      bounds: { iso: camera.isoBounds ?? [100, 25600] },
      legal: camera.legal ?? {},
    });
    p.set('shutter', solved.shutter, p.reasons.shutter);
    p.set('aperture', solved.aperture, p.reasons.aperture);
    p.set('iso', solved.iso, `For a Bortle ${bortle} sky at this shutter and aperture`);
    foldExposureNotes(p, solved);

    const taken = p.settings.shutter;

    if (subject === 'trails') {
      const totalMinutes = want.totalMinutes ?? 60;
      const seq = planStarTrail({ totalMinutes, exposureS: taken, writeS: 1.5 });
      p.sequence = { ...seq, totalS: seq.frames * seq.intervalS };
      const px = trailLengthPx({
        totalS: seq.frames * seq.intervalS, focalLength: lens.focalLength,
        pixelPitchUm: camera.pixelPitchUm, declinationDeg: want.declinationDeg ?? 45,
      });
      p.warn(`${Math.round(totalMinutes)} minutes draws a trail about ${Math.round(px)} pixels long at `
        + `${lens.focalLength}mm — ${(px / camera.widthPx * 100).toFixed(1)}% of the frame's width. ${seq.says}`);
      p.warn('Stack the frames with a lighten blend. One 60-minute exposure would be a white sky in any light-polluted place.');
    } else if (subject === 'meteors') {
      const hours = want.hours ?? 3;
      const intervalS = taken + 1.5;
      const frames = Math.floor((hours * 3600) / intervalS);
      p.sequence = { frames, intervalS, totalS: frames * intervalS, says: `${hours} hours of frames, back to back` };
      p.warn('Point away from the radiant, not at it — meteors near the radiant are foreshortened to dots.');
    } else {
      const frames = want.frames ?? 12;
      p.sequence = { frames, intervalS: taken + 1.5, totalS: frames * (taken + 1.5) };
    }

    modeCheck({ plan: p, camera, pins: this.pins });
    for (const advice of stabilityAdvice({
      shutterS: taken, focalLength: lens.focalLength, support: 'tripod',
      stabilisationOn: camera.stabilisationOn ?? true,
    })) p.check(advice);

    if (subject !== 'aurora' && taken > 1) {
      p.warn(`Long-exposure noise reduction doubles every frame at ${formatShutter(taken)}. Switch it off and stack instead.`);
    }
    return p;
  },
};
