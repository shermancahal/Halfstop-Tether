/*
 * Setting what the plan worked out, on the camera in front of you.
 *
 * Everything above this file has been a very good calculator: it reads the
 * body, says which settings are the app's to set, and then leaves them to be
 * dialled in by hand. This is the part that makes it a tether.
 *
 * The rule throughout is the same one the reading half follows — the camera is
 * the authority. Nothing is written without asking the descriptor whether it
 * may be, nothing is assumed to have landed, and an axis that refuses is
 * reported as refused rather than quietly dropped.
 */

import { setAxis } from './live.mjs';
import { stopsBetween } from '../photo/units.mjs';

export const AXES = ['shutter', 'aperture', 'iso'];

/** Within a sixth of a stop is the same value as far as a photograph cares. */
const SAME = 1 / 6;

/**
 * Write the plan's settings to the camera, one axis at a time.
 *
 * @returns one row per axis: what was asked, what happened, and why not.
 */
export async function applyPlan({ session, state, plan, axes = AXES }) {
  const rows = [];

  for (const axis of axes) {
    const wanted = plan.settings[axis];
    if (wanted == null) continue;

    const known = state.axes?.[axis];
    if (!known) {
      rows.push({ axis, wanted, outcome: 'absent', says: 'this body does not offer it' });
      continue;
    }
    /*
     * The mode dial decides this, and it can have moved since the plan was
     * drawn. Checking here as well as in the plan is not redundant: one is a
     * statement about a screen, the other about a write that is about to
     * happen.
     */
    if (!known.writable) {
      rows.push({ axis, wanted, outcome: 'refused', says: 'the camera is setting it itself in this mode' });
      continue;
    }
    if (known.value != null && Math.abs(stopsBetween(known.value, wanted)) < SAME) {
      rows.push({ axis, wanted, outcome: 'already', says: 'already there' });
      continue;
    }

    try {
      await setAxis(session, axis, wanted);
      rows.push({ axis, wanted, outcome: 'wrote' });
    } catch (error) {
      rows.push({ axis, wanted, outcome: 'failed', says: error.message });
    }
  }

  return rows;
}

/**
 * Did it land? Asked of a state read back *after* the write, never of the one
 * that went in — a write that returns OK and changes nothing is a thing
 * cameras do, and the only way to know is to look.
 */
export function confirm(rows, state) {
  return rows.map((row) => {
    if (row.outcome === 'failed' || row.outcome === 'absent' || row.outcome === 'refused') return row;
    const now = state.axes?.[row.axis]?.value;
    if (now == null) return { ...row, outcome: 'unconfirmed', says: 'the camera stopped reporting it' };
    const off = stopsBetween(now, row.wanted);
    if (Math.abs(off) < SAME) return { ...row, outcome: 'set', got: now };
    return {
      ...row, outcome: 'drifted', got: now,
      says: `the camera took ${Math.abs(off).toFixed(2)} stops away from what was asked`,
    };
  });
}

/** One line a person can read, from the rows. */
export function describeApply(rows) {
  const set = rows.filter((r) => r.outcome === 'set' || r.outcome === 'already');
  const trouble = rows.filter((r) => !['set', 'already'].includes(r.outcome));
  if (!trouble.length) {
    return set.length
      ? `${set.map((r) => r.axis).join(', ')} set on the camera.`
      : 'Nothing to set — the plan matches the camera already.';
  }
  const parts = trouble.map((r) => `${r.axis}: ${r.says ?? r.outcome}`);
  return [set.length ? `${set.map((r) => r.axis).join(', ')} set.` : null, ...parts]
    .filter(Boolean).join(' ');
}
