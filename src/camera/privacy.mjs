/*
 * Things a camera knows about its owner.
 *
 * A body carries the photographer's name in its Artist field, its own serial
 * number, and whatever was typed into the image comment. None of that is
 * needed to plan a photograph, and all of it ends up in a probe run — which
 * docs/other-cameras.md asks strangers to send us.
 *
 * So it is removed where it is written, not where it is published. A person
 * contributing a fixture should not have to know this file exists.
 */

/** Settings whose value identifies a person or a particular body. */
const PRIVATE = /serial|artist|copyright|comment|owner|username|nickname/i;

export const REDACTED = '[redacted]';

export function isPrivate(path, label = '') {
  return PRIVATE.test(String(path)) || PRIVATE.test(String(label));
}

/**
 * Blank the values of identifying settings, keeping everything else.
 *
 * The property itself stays — its code, its type, whether it is writable — so
 * a fixture still describes the camera completely. Only the contents go.
 */
export function scrubConfigs(configs) {
  const out = {};
  for (const [path, config] of Object.entries(configs)) {
    out[path] = isPrivate(path, config?.label) && config?.value
      ? { ...config, value: REDACTED }
      : config;
  }
  return out;
}

/**
 * The same, over gphoto2's text dump, which is blocks of
 * path / Label / Readonly / Type / Current / END.
 */
export function scrubDump(text) {
  const lines = String(text).split('\n');
  let privateBlock = false;
  return lines.map((line) => {
    if (line.startsWith('/')) { privateBlock = PRIVATE.test(line); return line; }
    const label = line.match(/^Label:\s*(.*)$/);
    if (label) { privateBlock = privateBlock || PRIVATE.test(label[1]); return line; }
    if (line === 'END') { privateBlock = false; return line; }
    if (privateBlock && /^Current:\s*\S/.test(line)) return 'Current: ' + REDACTED;
    return line;
  }).join('\n');
}

/**
 * gphoto2's --summary, which states the same things a third way.
 *
 * Two shapes appear in it: the device header, "Serial Number: 0001...", and
 * the property listing, "Artist  (501e ro str): 'Sherman Cahal'". Both carry
 * the owner, so both are covered — a scrubber that catches one and not the
 * other is worse than none, because it looks like it worked.
 */
export function scrubSummary(text) {
  return String(text)
    .replace(/^(\s*serial\s*number\s*:\s*)(\S.*)$/gim, `$1${REDACTED}`)
    .replace(/^(.*?)(\([0-9a-f]{4}\s+(?:ro|rw)\s+\w+\s*\):\s*)'(.*)'$/gim,
      (line, label, middle, value) => (isPrivate('', label) && value ? `${label}${middle}'${REDACTED}'` : line));
}
