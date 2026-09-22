/*
 * A star tracker, and what it actually buys you.
 *
 * Untracked, the NPF limit asks how long before the sky moves across a pixel.
 * A tracker turns with the sky, so the question becomes how much of that
 * motion it fails to cancel — and that is a much smaller number, which is why
 * a Move Shoot Move turns ISO 40000 into ISO 200 rather than shaving a stop.
 *
 * Same method as motion.mjs: count the pixels. Nothing here is a rule of
 * thumb, so nothing here goes stale when sensors get denser.
 */

const ARCSEC_PER_RADIAN = 206265;

/** Earth turns this far per second of time. */
export const SIDEREAL_ARCSEC_PER_SEC = 15.041;

/** How much sky one pixel covers, which is what decides whether drift shows. */
export function arcsecPerPixel({ focalLength, pixelPitchUm }) {
  return (ARCSEC_PER_RADIAN * (pixelPitchUm / 1000)) / focalLength;
}

/*
 * Drift from imperfect polar alignment.
 *
 * A tracker turns about the axis it was pointed at. Point it a degree away
 * from the pole and a degree's worth of the sky's rotation goes uncancelled:
 * the sine of the error, times the sidereal rate. One degree is about 0.26
 * arcseconds a second, or a quarter of a minute of arc every minute — the
 * number every polar-alignment guide quotes, derived rather than looked up.
 */
export function driftRate({ misalignmentDeg, declinationDeg = 0 }) {
  return SIDEREAL_ARCSEC_PER_SEC
    * Math.sin((misalignmentDeg * Math.PI) / 180)
    * Math.cos((declinationDeg * Math.PI) / 180);
}

/*
 * What alignment is worth attempting in the dark.
 *
 * A laser or a sighting hole gets you inside a degree without much trouble.
 * A polar scope or a phone app, patiently, gets a quarter of that. Beyond
 * there the tracker's own periodic error dominates and more care stops paying.
 */
export const ALIGNMENTS = {
  rough: { id: 'rough', label: 'Roughly aligned', says: 'Laser or sighting hole, a minute of fiddling', misalignmentDeg: 1 },
  careful: { id: 'careful', label: 'Carefully aligned', says: 'Polar scope or app, taking your time', misalignmentDeg: 0.25 },
};

/*
 * The longest exposure a tracker holds before drift crosses `allowedBlurPx`.
 *
 * Capped, because past a few minutes the limits are no longer the tracker:
 * sky glow, satellites, aircraft, and the cost of losing a whole frame to a
 * gust all argue for stacking shorter ones instead.
 */
export function trackedLimit({
  focalLength, pixelPitchUm, misalignmentDeg,
  declinationDeg = 0, allowedBlurPx = 1.5, capS = 240,
}) {
  const rate = driftRate({ misalignmentDeg, declinationDeg });
  if (rate <= 0) return capS;
  return Math.min(capS, (allowedBlurPx * arcsecPerPixel({ focalLength, pixelPitchUm })) / rate);
}
