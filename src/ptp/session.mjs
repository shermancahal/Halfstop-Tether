/*
 * A conversation with a camera, above the wire and below everything else.
 *
 * This is the portability boundary from docs/transport.md: a transaction in,
 * a response out. Android hands us bytes and we frame them ourselves; iOS hands
 * ImageCaptureCore a command and Apple frames it; WebUSB is like Android. All
 * three satisfy the same small interface, and everything above this file is
 * shared.
 *
 *   transport.send(bytes)      write one container
 *   transport.receive()        read one container
 */

import {
  encodeCommand, encodeData, decodeContainer, parseDeviceInfo, parseDevicePropDesc,
  CONTAINER, RESPONSE_OK, OC, describeResponse,
} from './codec.mjs';

export class PtpError extends Error {
  constructor(code, context) {
    super(`${describeResponse(code)}${context ? ` (${context})` : ''}`);
    this.code = code;
  }
}

export class PtpSession {
  constructor(transport) {
    this.transport = transport;
    this.transactionId = 0;
    this.sessionOpen = false;
    this.deviceInfo = null;
  }

  #nextId() {
    /* Zero is reserved, and the counter wraps rather than overflowing. */
    this.transactionId = (this.transactionId % 0xfffffffe) + 1;
    return this.transactionId;
  }

  /**
   * One transaction: command out, optional data either way, response back.
   * Everything the app does to a camera goes through here.
   */
  async transaction({ opcode, params = [], dataOut = null, expectData = false }) {
    const transactionId = this.#nextId();
    await this.transport.send(encodeCommand({ opcode, transactionId, params }));
    if (dataOut) await this.transport.send(encodeData({ opcode, transactionId, data: dataOut }));

    let data = null;
    let container = decodeContainer(await this.transport.receive());
    if (container.type === CONTAINER.DATA) {
      data = container.payload;
      /* A payload larger than one transfer arrives in pieces. */
      while (data.byteLength < container.length - 12) {
        const more = await this.transport.receive();
        const joined = new Uint8Array(data.byteLength + more.byteLength);
        joined.set(data); joined.set(more, data.byteLength);
        data = joined;
      }
      container = decodeContainer(await this.transport.receive());
    }
    if (container.type !== CONTAINER.RESPONSE) {
      throw new Error(`Expected a response, got container type ${container.type}`);
    }
    if (container.code !== RESPONSE_OK) {
      throw new PtpError(container.code, `opcode 0x${opcode.toString(16)}`);
    }
    if (expectData && !data) throw new Error(`No data came back from 0x${opcode.toString(16)}`);
    return { data, params: container.params };
  }

  async open() {
    /* Device info is readable before a session exists, and says what to expect. */
    const { data } = await this.transaction({ opcode: OC.GetDeviceInfo, expectData: true });
    this.deviceInfo = parseDeviceInfo(data);
    await this.transaction({ opcode: OC.OpenSession, params: [1] });
    this.sessionOpen = true;
    return this.deviceInfo;
  }

  async close() {
    if (!this.sessionOpen) return;
    try { await this.transaction({ opcode: OC.CloseSession }); } finally { this.sessionOpen = false; }
  }

  /** The descriptor: current value, legal values, and whether we may write it. */
  async getPropDesc(code) {
    const { data } = await this.transaction({ opcode: OC.GetDevicePropDesc, params: [code], expectData: true });
    return parseDevicePropDesc(data);
  }

  supports(opcode) {
    return this.deviceInfo?.operations.includes(opcode) ?? false;
  }

  /**
   * Read every property the camera admits to, descriptor and all.
   *
   * Reported one at a time because that is all PTP offers, and timed because
   * the result is the budget the tiered poll has to live inside — a number the
   * gphoto2 probe could not measure, since it reopened the camera every call.
   */
  async readAllProps({ onProgress } = {}) {
    const codes = this.deviceInfo?.deviceProperties ?? [];
    const props = {};
    const started = Date.now();
    for (const [i, code] of codes.entries()) {
      try {
        props[code] = await this.getPropDesc(code);
      } catch (error) {
        /* A property the camera lists and then refuses is worth recording as
         * such: it is exactly the class of lie libgphoto2 is full of. */
        props[code] = { code, error: error.message, claimed: true };
      }
      onProgress?.(i + 1, codes.length);
    }
    return { props, elapsedMs: Date.now() - started };
  }
}
