/*
 * What is sharp, and the point past which stopping down stops helping.
 *
 * All distances in millimetres inside, because the lens formulae want them
 * that way; the callers deal in metres and convert at the edge.
 */

/** Hyperfocal distance in mm: focus here and everything from half of it is sharp. */
export function hyperfocalMm({ focalLength, aperture, cocMm }) {
  return (focalLength * focalLength) / (aperture * cocMm) + focalLength;
}

/**
 * Near and far limits of acceptable sharpness for a given focus distance.
 * `far` is Infinity once the subject is at or beyond the hyperfocal distance.
 */
export function depthOfField({ focalLength, aperture, distanceMm, cocMm }) {
  const H = hyperfocalMm({ focalLength, aperture, cocMm });
  const s = distanceMm;
  const near = (H * s) / (H + (s - focalLength));
  const denominator = H - (s - focalLength);
  const far = denominator <= 0 ? Infinity : (H * s) / denominator;
  return { near, far, hyperfocal: H, total: far - near };
}

/*
 * Where diffraction starts to cost more than the depth it buys.
 *
 * The Airy disk is 2.44·lambda·N across. Once that spans more than a couple of
 * pixels there is no more detail to be had by stopping down — which is why
 * "just use f/22" is bad advice on a modern sensor rather than merely cautious.
 * This is where softening becomes measurable, not where a photograph is ruined.
 */
export function diffractionLimitedAperture({ pixelPitchUm, wavelengthUm = 0.55, pixelsAcross = 2 }) {
  return (pixelsAcross * pixelPitchUm) / (2.44 * wavelengthUm);
}

/** Airy disk diameter in microns at a given f-number. */
export function airyDiskUm({ aperture, wavelengthUm = 0.55 }) {
  return 2.44 * wavelengthUm * aperture;
}
