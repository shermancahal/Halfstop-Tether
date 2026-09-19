/*
 * How many stops stand between the exposure the scene gives and the exposure
 * the photograph wants.
 *
 * This is the answer a recipe cannot give, because it depends on the light
 * that is actually there — and it is worth knowing at the car rather than at
 * the rail.
 */

import { stopsBetween } from './units.mjs';

/** Common neutral density strengths, by the stops they take away. */
export const ND_FILTERS = [
  { stops: 1, names: ['ND2', '0.3'] },
  { stops: 2, names: ['ND4', '0.6'] },
  { stops: 3, names: ['ND8', '0.9'] },
  { stops: 6, names: ['ND64', '1.8'] },
  { stops: 10, names: ['ND1000', '3.0'] },
  { stops: 15, names: ['ND32000', '4.5'] },
];

/** A circular polariser costs light as well as glare. */
export const POLARISER_STOPS = 1.5;

/**
 * Stops of ND needed to stretch `meteredShutter` out to `targetShutter`,
 * counting any filter already on the front.
 */
export function ndStopsNeeded({ meteredShutter, targetShutter, polariser = false }) {
  const needed = stopsBetween(meteredShutter, targetShutter);
  return needed - (polariser ? POLARISER_STOPS : 0);
}

/**
 * What to actually reach for. Filters stack, so the answer may be two of them,
 * and the residual says how far off the target the combination lands — which
 * the app can close with ISO or aperture rather than pretending it is exact.
 */
export function chooseNd(stopsNeeded, { owned = ND_FILTERS.map((f) => f.stops) } = {}) {
  if (stopsNeeded <= 0.34) return { filters: [], total: 0, residual: stopsNeeded };
  const available = [...owned].sort((a, b) => b - a);
  const chosen = [];
  let remaining = stopsNeeded;
  for (const stops of available) {
    while (remaining >= stops - 0.34 && chosen.length < 3) {
      chosen.push(stops);
      remaining -= stops;
    }
  }
  const total = chosen.reduce((sum, s) => sum + s, 0);
  return { filters: chosen, total, residual: stopsNeeded - total };
}

/** The name a photographer would use for a given strength. */
export function ndName(stops) {
  return ND_FILTERS.find((f) => f.stops === stops)?.names[0] ?? `${stops} stops`;
}
