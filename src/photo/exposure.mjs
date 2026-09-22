/*
 * The triangle, solved under whatever the intent holds fixed.
 *
 * The important decision here is that this solver does NOT force a balanced
 * exposure. When all three corners are pinned — which is exactly what a
 * waterfall does, wanting two seconds at f/11 and base ISO — there is no
 * solution, and inventing one would mean quietly abandoning something the
 * photographer asked for. So it reports the gap instead, and the caller decides
 * what closes it: neutral density for the waterfall, more ISO for the stars,
 * a wider aperture for a handheld frame.
 *
 * That is also what keeps this a solver rather than a recipe. Nothing here
 * knows what a waterfall is.
 */

import { ev, shutterFor, apertureFor, isoFor, snap, stopsBetween } from './units.mjs';

const AXES = ['shutter', 'aperture', 'iso'];

function clamp(value, bounds) {
  if (!bounds) return { value, clamped: null };
  const [low, high] = bounds;
  if (low != null && value < low) return { value: low, clamped: 'min' };
  if (high != null && value > high) return { value: high, clamped: 'max' };
  return { value, clamped: null };
}

/**
 * @param evScene   brightness of the scene, in EV at ISO 100
 * @param want      the values the intent asks for; any may be null, meaning free
 * @param absorb    which axis takes up the slack — must be one the intent left free
 * @param bounds    [min, max] per axis, the camera's or the photographer's
 * @param legal     the camera's own lists, so the answer is one it will accept
 */
export function solveExposure({ evScene, want = {}, absorb = 'iso', bounds = {}, legal = {} }) {
  const notes = [];
  const settings = { ...want };

  /* Anything the intent left free, other than the absorber, falls back to a
   * sensible default rather than being invented: base ISO, and the widest
   * aperture available, because those are what the intents that leave them
   * free actually mean. */
  if (settings.iso == null && absorb !== 'iso') settings.iso = bounds.iso?.[0] ?? 100;
  if (settings.aperture == null && absorb !== 'aperture') settings.aperture = bounds.aperture?.[0] ?? 5.6;
  if (settings.shutter == null && absorb !== 'shutter') settings.shutter = bounds.shutter?.[1] ?? 1 / 125;

  /* Solve the absorbing axis from the other two. */
  const solveAbsorber = () => {
    if (absorb === 'iso') {
      settings.iso = isoFor({ ev: evScene, aperture: settings.aperture, shutter: settings.shutter });
    } else if (absorb === 'shutter') {
      settings.shutter = shutterFor({ ev: evScene, aperture: settings.aperture, iso: settings.iso });
    } else if (absorb === 'aperture') {
      settings.aperture = apertureFor({ ev: evScene, shutter: settings.shutter, iso: settings.iso });
    }
  };

  /* Hold an axis to what is possible, and to what the camera will accept. */
  const settle = (axis) => {
    const bounded = clamp(settings[axis], bounds[axis]);
    if (bounded.clamped) {
      notes.push({ axis, kind: 'clamped', at: bounded.clamped, says: `${axis} hit its ${bounded.clamped === 'min' ? 'lowest' : 'highest'} allowed value` });
      settings[axis] = bounded.value;
    }
    const snapped = snap(settings[axis], legal[axis]);
    if (!snapped.exact && legal[axis]?.length) {
      notes.push({ axis, kind: 'snapped', offBy: snapped.offBy, says: `${axis} moved ${Math.abs(snapped.offBy).toFixed(2)} stops to a value the camera offers` });
    }
    settings[axis] = snapped.value;
  };

  /*
   * Order matters, and it used to be the other way round.
   *
   * The pinned axes settle first, then the free one is solved against what
   * they actually became. Solving it first meant a tracker asking for 240
   * seconds got an ISO for 240 seconds, and then the shutter quietly snapped
   * to the 30 the body's dial stops at — two numbers on screen, three stops
   * apart, answering different questions.
   *
   * This is not forcing a balanced exposure. The absorbing axis is the free
   * one by definition; a pinned axis that cannot be reached still reports its
   * gap, and that gap is where the ND requirement comes from.
   */
  for (const axis of AXES) if (axis !== absorb) settle(axis);
  solveAbsorber();
  settle(absorb);

  const evAchieved = ev(settings);
  /*
   * Positive means the scene is brighter than these settings expect: too much
   * light, so reach for neutral density. Negative means the opposite.
   */
  const errorStops = evScene - evAchieved;
  return {
    ...settings,
    evScene,
    evAchieved,
    errorStops,
    balanced: Math.abs(errorStops) < 1 / 6,
    notes,
  };
}

/**
 * How bright is it? Used when there is no meter reading to hand — an estimate
 * the photographer can overrule, never a measurement dressed as one.
 */
export const SCENE_EV = {
  'bright sun': 15,
  'hazy sun': 14,
  overcast: 12,
  'heavy overcast': 11,
  'open shade': 12,
  sunset: 10,
  'blue hour': 7,
  'city at night': 5,
  'full moon landscape': -2,
  'moonless milky way': -6,
};

/** The gap between two exposures, in stops. */
export function exposureDifference(a, b) {
  return ev(b) - ev(a);
}

export { stopsBetween };
