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
 * A camera that is awake answers GetDeviceInfo in milliseconds. A camera that
 * has gone to sleep does not answer at all — no error, no refusal, silence —
 * so the only way to notice is to stop waiting. Thirty seconds of that, ending
 * in the word "opcode", is the worst possible way to be told the body needs a
 * nudge. Eight is long enough to be sure and short enough to act on.
 *
 * A capture is the exception: a thirty-second exposure legitimately takes
 * thirty seconds, so whoever asks for one says how long to allow.
 */
const OPEN_TIMEOUT_MS = 8000;
const DEFAULT_TIMEOUT_MS = 8000;

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

    /* The host calls these. One reply channel, one event channel. */
    window.__ptpReply = (id, result) => {
      const waiting = this.pending.get(id);
      if (!waiting) return;
      this.pending.delete(id);
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
      this.pending.set(id, { resolve, reject });
      window.webkit.messageHandlers.ptp.postMessage({ ...message, id });
      setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.stalled = `The camera stopped answering — ${describe} went out and nothing came back.\n\n`
          + 'A body that has gone to sleep does exactly this: no error, no refusal, silence. '
          + 'Wake it (half-press the shutter, or turn any dial), then connect again.';
        reject(new Error(this.stalled));
      }, timeoutMs);
    });
  }

  async open() {
    await this.#post({ kind: 'open' }, { describe: 'the request to open a session', timeoutMs: OPEN_TIMEOUT_MS });
    return this;
  }

  async close() {
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
