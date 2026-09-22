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

import { encodeCommand, decodeContainer, CONTAINER } from './codec.mjs';

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

export class NativeTransport {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.transactionId = 0;
    this.events = [];

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

  #post(message) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.webkit.messageHandlers.ptp.postMessage({ ...message, id });
      /* A native side that never answers should not hang the interface. */
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`The camera did not answer ${message.kind}`));
      }, 30000);
    });
  }

  async open() { await this.#post({ kind: 'open' }); return this; }
  async close() { try { await this.#post({ kind: 'close' }); } catch { /* going away */ } }

  /** One transaction, framed here and passed across as bytes. */
  async transact({ opcode, params = [], dataOut = null }) {
    this.transactionId = (this.transactionId % 0xfffffffe) + 1;
    const command = encodeCommand({ opcode, transactionId: this.transactionId, params });
    const reply = await this.#post({
      kind: 'transact',
      command: toBase64(command),
      outData: dataOut ? toBase64(dataOut) : null,
    });

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
