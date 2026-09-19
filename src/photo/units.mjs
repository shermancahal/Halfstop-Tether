/*
 * The exposure equation, and nothing else.
 *
 * Everything else in this folder leans on these four, so they are worth being
 * exact about. The relation is N²/t = 2^EV · (ISO/100): aperture squared over
 * shutter time, against a brightness expressed in stops from the ISO 100
 * reference.
 */

/** Exposure value of a settings triple. ISO 100, f/11, 1/34 s is EV 12. */
export function ev({ aperture, shutter, iso = 100 }) {
  return Math.log2((aperture * aperture) / shutter) - Math.log2(iso / 100);
}

/** The shutter time that lands on `ev` at this aperture and ISO. */
export function shutterFor({ ev: value, aperture, iso = 100 }) {
  return (aperture * aperture) / (Math.pow(2, value) * (iso / 100));
}

/** The f-number that lands on `ev` at this shutter and ISO. */
export function apertureFor({ ev: value, shutter, iso = 100 }) {
  return Math.sqrt(shutter * Math.pow(2, value) * (iso / 100));
}

/** The ISO that lands on `ev` at this aperture and shutter. */
export function isoFor({ ev: value, aperture, shutter }) {
  return (100 * (aperture * aperture)) / (shutter * Math.pow(2, value));
}

/** Stops between two values of the same kind. Positive means `to` is brighter. */
export function stopsBetween(from, to) {
  return Math.log2(to / from);
}

/*
 * The camera decides what it will accept, so a solved number is not a usable
 * one until it has been put on the camera's own list. The probe showed why this
 * cannot be a fixed table: this body offers 55 shutter values in M and 54 in A,
 * and the difference is bulb.
 */
export function snap(value, legal) {
  if (!legal?.length) return { value, exact: true, offBy: 0 };
  let best = legal[0];
  for (const candidate of legal) {
    if (Math.abs(Math.log2(candidate / value)) < Math.abs(Math.log2(best / value))) best = candidate;
  }
  return { value: best, exact: best === value, offBy: stopsBetween(value, best) };
}

/** A shutter time as a photographer writes it: 1/250, 2.5s, 30s. */
export function formatShutter(seconds) {
  if (seconds >= 1) return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))}s`;
  return `1/${Math.round(1 / seconds)}`;
}
