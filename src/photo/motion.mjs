/*
 * How long the shutter may be open before something moves too far.
 *
 * Two different questions wear the same clothes: how long *can* it stay open
 * before the subject smears, and how long *should* it, when the smear is the
 * point. Waterfalls want the second one.
 */

const ARCSEC_PER_SECOND = 15.041;  /* Earth's rotation, sidereal. */

/*
 * The NPF rule: how long before stars trail, given the aperture, the pixel
 * pitch and the focal length. It beats the 500 rule because it knows what the
 * sensor can resolve — on 24 megapixels the 500 rule trails visibly.
 *
 * Declination matters because stars near the pole travel slower: allowed time
 * scales as 1/cos(declination). The default of 0 is the celestial equator,
 * which is the worst case and the safe one.
 */
export function npfLimit({ focalLength, aperture, pixelPitchUm, declinationDeg = 0 }) {
  const base = (35 * aperture + 30 * pixelPitchUm) / focalLength;
  return base / Math.cos((declinationDeg * Math.PI) / 180);
}

/** The old rule, kept only to show what it would have cost. */
export function rule500({ focalLength }) {
  return 500 / focalLength;
}

/*
 * Handheld: the reciprocal rule, with stabilisation credited against it. Five
 * stops of IBIS turns 1/20 at 20mm into something around half a second, which
 * is true of a steady hand on a good day and optimistic on a cold one.
 */
export function handheldLimit({ focalLength, stabilisationStops = 0 }) {
  return (1 / focalLength) * Math.pow(2, stabilisationStops);
}

/*
 * A moving subject, from the image's point of view: how long before it crosses
 * more than `allowedBlurPx` pixels. Perpendicular motion is the worst case, so
 * that is the default; motion straight at the camera barely blurs at all.
 */
export function subjectMotionLimit({
  speedKmh, distanceM, focalLength, pixelPitchUm, widthPx, sensorWidthMm,
  allowedBlurPx = 1, angleDeg = 90,
}) {
  const speedMs = (speedKmh * 1000) / 3600;
  const across = speedMs * Math.sin((angleDeg * Math.PI) / 180);
  /* Image-plane speed = subject speed x magnification, and magnification is
   * focal length over distance once the distance is many focal lengths. */
  const magnification = focalLength / (distanceM * 1000);
  const mmPerSecond = across * 1000 * magnification;
  const pxPerSecond = mmPerSecond / (pixelPitchUm / 1000);
  void widthPx; void sensorWidthMm;
  return allowedBlurPx / pxPerSecond;
}

/*
 * Flowing water, where blur is the subject rather than the failure. These are
 * looks, not limits, and which one is right depends on how fast the water is
 * actually moving — so the app asks for the look and scales it by the flow.
 */
export const WATER_LOOKS = {
  texture: { seconds: [0.25, 0.5], says: 'strands stay separate' },
  silk: { seconds: [1, 2], says: 'silk with structure left in it' },
  fog: { seconds: [4, 15], says: 'smooth, and the detail is gone' },
};

export function waterShutter({ look = 'silk', flow = 'average' }) {
  const [low, high] = WATER_LOOKS[look].seconds;
  /* A fast chute reaches a look sooner than a slow wide fall does. */
  const scale = { fast: 0.5, average: 1, slow: 2 }[flow] ?? 1;
  return { low: low * scale, high: high * scale, says: WATER_LOOKS[look].says };
}

export { ARCSEC_PER_SECOND };
