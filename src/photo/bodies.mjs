/*
 * What the app knows about a camera before it is plugged in.
 *
 * Only what the solvers need and PTP will not tell us: sensor geometry, and the
 * stabilisation figure. Everything else — the settings, their legal values,
 * which of them are writable right now — comes from the camera itself, because
 * the probe showed those move with the mode dial and a stored table would go
 * stale the moment someone turned it.
 */

/** Pixel pitch in microns from sensor width and horizontal pixel count. */
export function pixelPitchUm({ sensorWidthMm, widthPx }) {
  return (sensorWidthMm / widthPx) * 1000;
}

/** Sensor diagonal, for the traditional circle of confusion. */
export function diagonalMm({ sensorWidthMm, sensorHeightMm }) {
  return Math.hypot(sensorWidthMm, sensorHeightMm);
}

export const NIKON_Z5 = {
  name: 'Nikon Z5',
  sensorWidthMm: 35.9,
  sensorHeightMm: 23.9,
  widthPx: 6016,
  heightPx: 4016,
  baseIso: 100,
  /* CIPA rating for the in-body stabilisation, in stops. */
  stabilisationStops: 5,
  continuousFps: 4.5,
  /* Measured by tools/probe.mjs, not assumed. */
  liveView: { widthPx: 640, heightPx: 424 },
};

/** Everything derived from the sensor, computed once. */
export function profile(body) {
  const pitch = pixelPitchUm(body);
  const diagonal = diagonalMm(body);
  return {
    ...body,
    pixelPitchUm: pitch,
    diagonalMm: diagonal,
    /* Two circles of confusion, because the right one depends on the question.
     * The traditional diagonal/1500 suits a print judged at arm's length; the
     * pixel-scale one suits anything that will be examined at 100%. */
    cocMm: diagonal / 1500,
    cocPixelMm: (pitch * 1.5) / 1000,
  };
}
