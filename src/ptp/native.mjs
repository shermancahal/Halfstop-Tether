/*
 * PTP through a native host — ImageCaptureCore on macOS and iOS.
 *
 * This is the second kind of transport docs/transport.md described. Apple does
 * not hand over a byte stream; it takes a command and returns a response
 * already framed. So this offers `transact` rather than `send`/`receive`, and
 * PtpSession takes the other path through the same door.
 *
 * The native side knows no PTP at all. It passes bytes to
 * requestSendPTPCommand and hands back what it gets, which keeps one codec in
 * one language and keeps the Swift small enough to be obviously correct.
 */

import { encodeCommand, decodeContainer, describeOpcode, CONTAINER } from './codec.mjs';
import { subscribeBridgeLog } from './bridge-log.mjs';

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => {
  if (!text) return null;
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

/** Is there a native host listening on the other side of this page? */
export function hasNativeBridge() {
  return typeof window !== 'undefined' && Boolean(window.webkit?.messageHandlers?.ptp);
}

/*
 * How long to wait before deciding nothing is coming back.
 *
 * This measures silence, not elapsed time, and the difference is the whole
 * story. ImageCaptureCore holds every PTP command until it has finished
 * indexing the card, which took fifty seconds on a real one — so 30s, then 8s,
 * then 15s all expired on a connection that was working perfectly and about to
 * answer. A deadline on the clock cannot tell that apart from a camera that
 * has stopped listening.
 *
 * The bridge now narrates the wait, so the timer resets on every line it
 * sends. Progress keeps the request alive indefinitely; nothing at all for
 * fifteen seconds is a real stall, whatever the clock says.
 */
const OPEN_TIMEOUT_MS = 15000;
const DEFAULT_TIMEOUT_MS = 15000;

export class NativeTransport {
  /* ImageCaptureCore opens and closes the PTP session itself. */
  managesSession = true;

  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.transactionId = 0;
    this.events = [];
    /* Set once something stops answering; see #post. */
    this.stalled = null;

    /* Any word from the native side means the wait is still going somewhere. */
    this.unsubscribe = subscribeBridgeLog(() => this.#heard());

    /* The host calls these. One reply channel, one event channel. */
    window.__ptpReply = (id, result) => {
      const waiting = this.pending.get(id);
      if (!waiting) return;
      this.pending.delete(id);
      clearTimeout(waiting.timer);
      result?.error ? waiting.reject(new Error(result.error)) : waiting.resolve(result);
    };
    window.__ptpEvent = (base64) => {
      const bytes = fromBase64(base64);
      if (bytes) this.events.push(decodeContainer(bytes));
    };
  }

  #post(message, { describe = message.kind, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    /*
     * Once one command has gone unanswered the camera is not going to answer
     * the next one either, and waiting out the timeout again per call turns a
     * wedged session into minutes of spinner. Say it once, immediately, for as
     * long as the session lasts.
     */
    if (this.stalled) return Promise.reject(new Error(this.stalled));

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const waiting = { resolve, reject, timeoutMs, describe, timer: null };
      waiting.arm = () => {
        clearTimeout(waiting.timer);
        waiting.timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          this.stalled = `Nothing from the camera for ${Math.round(timeoutMs / 1000)}s — `
            + `${describe} went out and neither an answer nor a word about it came back.\n\n`
            + 'Wake the camera (half-press the shutter, or turn any dial) and connect again; '
            + 'if that does not do it, switch it off and on.';
          reject(new Error(this.stalled));
        }, waiting.timeoutMs);
      };
      this.pending.set(id, waiting);
      waiting.arm();
      window.webkit.messageHandlers.ptp.postMessage({ ...message, id });
    });
  }

  /* News from the native side. Not an answer, but not silence either. */
  #heard() {
    for (const waiting of this.pending.values()) waiting.arm?.();
  }

  async open() {
    await this.#post({ kind: 'open' }, { describe: 'the request to open a session', timeoutMs: OPEN_TIMEOUT_MS });
    return this;
  }

  async close() {
    this.unsubscribe?.();
    /* Closing is how a stall gets cleared, so it is the one thing a stall
     * must not block. */
    this.stalled = null;
    try { await this.#post({ kind: 'close' }); } catch { /* going away */ }
  }

  /** One transaction, framed here and passed across as bytes. */
  async transact({ opcode, params = [], dataOut = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.transactionId = (this.transactionId % 0xfffffffe) + 1;
    const command = encodeCommand({ opcode, transactionId: this.transactionId, params });
    const reply = await this.#post({
      kind: 'transact',
      command: toBase64(command),
      outData: dataOut ? toBase64(dataOut) : null,
    }, { describe: describeOpcode(opcode), timeoutMs });

    const responseBytes = fromBase64(reply.response);
    const container = responseBytes ? decodeContainer(responseBytes) : null;
    if (container && container.type !== CONTAINER.RESPONSE) {
      throw new Error(`Expected a response container, got type ${container.type}`);
    }
    return {
      responseCode: container?.code ?? 0x2001,
      params: container?.params ?? [],
      data: fromBase64(reply.payload),
    };
  }

  /** Events the camera volunteered since the last look. */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  get name() { return 'Camera (native)'; }
}
