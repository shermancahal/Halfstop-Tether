/*
 * What the native side is doing, where a person can see it.
 *
 * The Swift bridge knows things the page cannot: whether a camera was found,
 * what it says it can do, whether a session opened, whether a command went out
 * and whether anything came back. All of that used to go to stderr, which is a
 * terminal window behind the app — so a stall looked identical whatever caused
 * it, and three diagnoses in a row were guesses.
 *
 * The buffer starts filling at page load, before any transport exists, because
 * the interesting messages arrive before then.
 */

export const bridgeLog = { lines: [], onLine: null };

const KEEP = 80;

export function installBridgeLog() {
  if (typeof window === 'undefined' || !window.webkit?.messageHandlers?.ptp) return false;

  window.__ptpStatus = (text) => {
    bridgeLog.lines.push(`${stamp()} ${text}`);
    if (bridgeLog.lines.length > KEEP) bridgeLog.lines.shift();
    bridgeLog.onLine?.(text);
  };

  /* Announcing ourselves gets the app build stamped into the log. */
  window.webkit.messageHandlers.ptp.postMessage({ kind: 'hello', id: 0 });
  return true;
}

function stamp() {
  const now = new Date();
  return `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}
