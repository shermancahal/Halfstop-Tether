/*
 * Whether the camera will hold still enough, and what to switch off so it does.
 *
 * Small rules, but they are the ones that turn a correct exposure into a soft
 * photograph, and nobody checks them at two in the morning.
 */

import { handheldLimit } from './motion.mjs';

/**
 * @param support  'hand' | 'tripod' | 'beanbag'
 * @returns advisories, each with something the app can either do or ask for
 */
export function stabilityAdvice({ shutterS, focalLength, stabilisationStops = 0, support = 'hand', stabilisationOn = true }) {
  const out = [];
  const limit = handheldLimit({ focalLength, stabilisationStops });

  if (support === 'hand' && shutterS > limit) {
    out.push({
      kind: 'too-slow-to-hold',
      byStops: Math.log2(shutterS / limit),
      says: `${shutterS.toFixed(2)}s is past what ${focalLength}mm holds steady, even with stabilisation.`,
      fix: 'Find something to rest on, or accept the shake.',
      appCanFix: false,
    });
  }

  /*
   * On a solid tripod the stabiliser has nothing to correct and can introduce
   * movement of its own looking for it. Nikon's own guidance is to switch it
   * off, and this is one the app can do itself.
   */
  if (support === 'tripod' && stabilisationOn && shutterS > 1 / 60) {
    out.push({
      kind: 'vr-on-tripod',
      says: 'Stabilisation is on and the camera is on a tripod, where it can cause the blur it exists to prevent.',
      fix: 'Turn it off for this run and put it back afterwards.',
      appCanFix: true,
    });
  }

  /*
   * Shutter shock: the mechanical curtain thumps the camera, and the window
   * where it shows is roughly an eighth of a second to two seconds. Longer
   * than that and the vibration is a small fraction of the exposure.
   */
  if (support !== 'hand' && shutterS >= 1 / 8 && shutterS <= 2) {
    out.push({
      kind: 'shutter-shock',
      says: 'This is the shutter-speed range where the shutter can shake the frame.',
      fix: 'Use the electronic first curtain, or an exposure delay of a couple of seconds.',
      appCanFix: true,
    });
  }

  if (shutterS > 30) {
    out.push({
      kind: 'past-thirty',
      says: 'Past 30 seconds the camera needs bulb, which the mode dial controls.',
      fix: 'Turn the mode dial to M — bulb is not ours to set.',
      appCanFix: false,
    });
  }

  return out;
}

/** True when nothing in the advisories needs a hand on the camera. */
export function appCanResolve(advisories) {
  return advisories.every((a) => a.appCanFix);
}
