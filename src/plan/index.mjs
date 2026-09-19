/*
 * The intents the app can solve for, and the one entry point that runs them.
 *
 * Each is a thin configuration over the six solvers in src/photo. Adding one
 * is a small file, which is the whole reason the solvers were written first.
 */

import { milkyWay } from './intents/milkyway.mjs';
import { waterfall } from './intents/waterfall.mjs';
import { timelapse } from './intents/timelapse.mjs';

export const INTENTS = { [milkyWay.id]: milkyWay, [waterfall.id]: waterfall, [timelapse.id]: timelapse };

export function listIntents() {
  return Object.values(INTENTS).map(({ id, title }) => ({ id, title }));
}

/** Solve one intent against the gear that is actually mounted and the light that is there. */
export function planFor(intentId, context) {
  const intent = INTENTS[intentId];
  if (!intent) throw new Error(`No intent called ${intentId}. Known: ${Object.keys(INTENTS).join(', ')}`);
  return intent.plan(context);
}

export { makePlan, modesThatAllow } from './plan.mjs';
