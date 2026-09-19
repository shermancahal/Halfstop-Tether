/*
 * Frames, the gaps between them, and the three things that end a run early:
 * a card that fills, a battery that dies, and an interval shorter than the
 * exposure plus the time it takes to write the file.
 *
 * The last one is the quiet killer. A twelve-second interval around a
 * ten-second exposure looks fine until the card is slow.
 */

/** Frames and interval for a clip of a given length over a given window. */
export function planTimelapse({ durationS, clipSeconds, fps = 30 }) {
  const frames = Math.round(clipSeconds * fps);
  return { frames, intervalS: durationS / frames, durationS, clipSeconds, fps };
}

/** The inverse: what a chosen interval buys over a window. */
export function clipFromInterval({ durationS, intervalS, fps = 30 }) {
  const frames = Math.floor(durationS / intervalS);
  return { frames, clipSeconds: frames / fps, intervalS, fps };
}

/**
 * Will it finish? Every answer is a reason, not a boolean, because "no" is
 * only useful when it says which of the three walls was hit.
 */
export function feasibility({
  frames, intervalS, exposureS, writeS = 1.5,
  cardFreeBytes, frameBytes, batteryPercent, framesPerPercent = 6,
}) {
  const problems = [];
  const cycle = exposureS + writeS;
  if (intervalS < cycle) {
    problems.push({
      kind: 'interval',
      says: `The interval is ${intervalS.toFixed(1)}s but each frame needs ${cycle.toFixed(1)}s to expose and write.`,
      fix: `Lengthen the interval past ${Math.ceil(cycle)}s, or shorten the exposure.`,
    });
  }
  if (cardFreeBytes != null && frameBytes != null) {
    const fits = Math.floor(cardFreeBytes / frameBytes);
    if (fits < frames) {
      problems.push({
        kind: 'card',
        says: `The card holds ${fits} more frames; this run wants ${frames}.`,
        fix: 'Free space, drop to JPEG, or shorten the run.',
      });
    }
  }
  if (batteryPercent != null) {
    const affordable = Math.floor(batteryPercent * framesPerPercent);
    if (affordable < frames) {
      problems.push({
        kind: 'battery',
        says: `${batteryPercent}% is about ${affordable} frames; this run wants ${frames}.`,
        fix: 'Charge, swap, or run from USB power.',
      });
    }
  }
  return { ok: problems.length === 0, problems, cycleS: cycle, totalS: frames * intervalS };
}

/**
 * Star trails: gaps between frames become dashes in the trail, so the interval
 * wants to be the shortest the write speed allows rather than anything chosen.
 */
export function planStarTrail({ totalMinutes, exposureS, writeS = 1.5 }) {
  const intervalS = exposureS + writeS;
  const frames = Math.floor((totalMinutes * 60) / intervalS);
  return {
    frames, intervalS, exposureS,
    gapS: writeS,
    says: writeS > 2
      ? 'That write gap will show as dashes in the trail.'
      : 'The gap is short enough that the trail will read as continuous.',
  };
}
