/*
 * A plan is a function, not a saved value.
 *
 * Every number carries the line that produced it, so it can be argued with and
 * so it recomputes when its inputs change. A number without a reason is a
 * recipe wearing a disguise.
 */

export function makePlan({ intent, title }) {
  return {
    intent, title,
    settings: {}, reasons: {}, checks: [], warnings: [],
    sequence: null, filters: null, schedule: null,

    /** Record a value and why it holds. Both, always — there is no other setter. */
    set(axis, value, because) {
      this.settings[axis] = value;
      this.reasons[axis] = because;
      return this;
    },
    check(entry) { this.checks.push(entry); return this; },
    warn(text) { this.warnings.push(text); return this; },

    /** What a hand has to do before this can run. */
    get blockers() { return this.checks.filter((c) => !c.appCanFix); },
    get ready() { return this.blockers.length === 0; },
  };
}

/*
 * Which exposure modes leave the app in charge of what this intent pins.
 *
 * Derived from what the camera reports as writable, never from a table: the
 * probe found F-Number writable in M and A only, and shutter in M and S only,
 * so an intent pinning both needs M — and that conclusion should keep holding
 * on a body nobody has plugged in yet.
 */
export function modesThatAllow({ pins, writableByMode }) {
  const modes = Object.keys(writableByMode);
  return modes.filter((mode) => pins.every((axis) => writableByMode[mode]?.includes(axis)));
}

/**
 * The reality check the control screen shows: can the app set this, or must you?
 *
 * Asked of the mode the camera is in, not of the map as a whole. A connected
 * body can only report where its dial is now, so a map with one entry is the
 * normal runtime case — and an intent it cannot satisfy there is exactly when
 * this has to speak, rather than the case to stay quiet about.
 */
export function modeCheck({ plan, camera, pins }) {
  const map = camera.writableByMode ?? {};
  if (!Object.keys(map).length) return plan;      /* nothing known; do not invent */

  const here = map[camera.mode] ?? [];
  const missing = pins.filter((axis) => !here.includes(axis));
  if (!missing.length) return plan;

  /* Somewhere else on the dial that would work, if we happen to know the map. */
  const elsewhere = modesThatAllow({ pins, writableByMode: map }).filter((m) => m !== camera.mode);
  return plan.check({
    kind: 'mode-dial',
    says: `The mode dial is on ${camera.mode}, where the camera sets ${missing.join(' and ')} itself.`,
    fix: elsewhere.length
      ? `Turn it to ${elsewhere[0]} — that one is not mine to set.`
      : 'Turn it to M. That one is not mine to set.',
    appCanFix: false,
  });
}

/** Fold a solver's own compromises into the plan, so nothing is silently absorbed. */
export function foldExposureNotes(plan, solved) {
  for (const note of solved.notes) {
    if (note.kind === 'clamped') {
      plan.warn(`${note.says} — the exposure is ${Math.abs(solved.errorStops).toFixed(1)} stops short of balanced.`);
    } else if (note.kind === 'snapped' && Math.abs(note.offBy) > 0.34) {
      plan.warn(`${note.says}.`);
    }
  }
  return plan;
}
