/*
 * Picture Transfer Protocol, on the wire.
 *
 * A transaction is a command container out, an optional data container in
 * either direction, and a response container back. Everything is little-endian.
 * This file knows how to write and read those containers and the typed values
 * inside them, and nothing about cameras.
 */

export const CONTAINER = { COMMAND: 1, DATA: 2, RESPONSE: 3, EVENT: 4 };
export const RESPONSE_OK = 0x2001;

export const OC = {
  GetDeviceInfo: 0x1001, OpenSession: 0x1002, CloseSession: 0x1003,
  GetStorageIDs: 0x1004, GetObjectHandles: 0x1007, GetObjectInfo: 0x1008,
  GetObject: 0x1009, GetThumb: 0x100a, InitiateCapture: 0x100e,
  GetDevicePropDesc: 0x1014, GetDevicePropValue: 0x1015, SetDevicePropValue: 0x1016,
  /* Nikon's own, the ones the design leans on. */
  NikonGetEvent: 0x90c7, NikonDeviceReady: 0x90c8, NikonGetVendorPropCodes: 0x90ca,
  NikonStartLiveView: 0x9201, NikonEndLiveView: 0x9202, NikonGetLiveViewImg: 0x9203,
  NikonMfDrive: 0x9204, NikonChangeAfArea: 0x9205,
  NikonInitiateCaptureRecInMedia: 0x9207, NikonTerminateCapture: 0x920c,
};

export const TYPE = {
  INT8: 0x0001, UINT8: 0x0002, INT16: 0x0003, UINT16: 0x0004,
  INT32: 0x0005, UINT32: 0x0006, INT64: 0x0007, UINT64: 0x0008,
  AINT8: 0x4001, AUINT8: 0x4002, AINT16: 0x4003, AUINT16: 0x4004,
  AINT32: 0x4005, AUINT32: 0x4006, STR: 0xffff,
};

/** A cursor over a DataView, because every PTP payload is read in order. */
export class Reader {
  constructor(buffer, offset = 0) {
    this.view = ArrayBuffer.isView(buffer) ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new DataView(buffer);
    this.offset = offset;
  }
  get remaining() { return this.view.byteLength - this.offset; }
  u8() { return this.view.getUint8(this.offset++); }
  i8() { return this.view.getInt8(this.offset++); }
  u16() { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u32() { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  i32() { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  u64() { const v = this.view.getBigUint64(this.offset, true); this.offset += 8; return v; }
  i64() { const v = this.view.getBigInt64(this.offset, true); this.offset += 8; return v; }

  /** PTP strings: a character count including the terminator, then UTF-16LE. */
  string() {
    const chars = this.u8();
    if (chars === 0) return '';
    let out = '';
    for (let i = 0; i < chars - 1; i++) out += String.fromCharCode(this.u16());
    this.offset += 2;  /* the null */
    return out;
  }

  /** An array: a 32-bit count, then that many of `read`. */
  array(read) {
    const count = this.u32();
    const out = [];
    for (let i = 0; i < count; i++) out.push(read.call(this));
    return out;
  }

  /** A value of whichever type a descriptor said it would be. */
  typed(type) {
    switch (type) {
      case TYPE.INT8: return this.i8();
      case TYPE.UINT8: return this.u8();
      case TYPE.INT16: return this.i16();
      case TYPE.UINT16: return this.u16();
      case TYPE.INT32: return this.i32();
      case TYPE.UINT32: return this.u32();
      case TYPE.INT64: return this.i64();
      case TYPE.UINT64: return this.u64();
      case TYPE.STR: return this.string();
      case TYPE.AINT8: return this.array(this.i8);
      case TYPE.AUINT8: return this.array(this.u8);
      case TYPE.AINT16: return this.array(this.i16);
      case TYPE.AUINT16: return this.array(this.u16);
      case TYPE.AINT32: return this.array(this.i32);
      case TYPE.AUINT32: return this.array(this.u32);
      default: throw new Error(`Unknown PTP data type 0x${type.toString(16)}`);
    }
  }
}

/** The 12-byte header every container starts with. */
export function decodeContainer(bytes) {
  const r = new Reader(bytes);
  const length = r.u32();
  const type = r.u16();
  const code = r.u16();
  const transactionId = r.u32();
  const payload = bytes.slice(12, Math.min(length, bytes.byteLength));
  const params = [];
  if (type === CONTAINER.COMMAND || type === CONTAINER.RESPONSE || type === CONTAINER.EVENT) {
    const pr = new Reader(payload);
    while (pr.remaining >= 4) params.push(pr.u32());
  }
  return { length, type, code, transactionId, params, payload };
}

/** A command container: header plus up to five 32-bit parameters. */
export function encodeCommand({ opcode, transactionId, params = [] }) {
  if (params.length > 5) throw new Error('PTP allows at most five parameters');
  const bytes = new Uint8Array(12 + params.length * 4);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, bytes.length, true);
  v.setUint16(4, CONTAINER.COMMAND, true);
  v.setUint16(6, opcode, true);
  v.setUint32(8, transactionId, true);
  params.forEach((p, i) => v.setUint32(12 + i * 4, p >>> 0, true));
  return bytes;
}

/** A data container: header plus the payload it carries. */
export function encodeData({ opcode, transactionId, data }) {
  const bytes = new Uint8Array(12 + data.byteLength);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, bytes.length, true);
  v.setUint16(4, CONTAINER.DATA, true);
  v.setUint16(6, opcode, true);
  v.setUint32(8, transactionId, true);
  bytes.set(data, 12);
  return bytes;
}

/**
 * The device property descriptor — the structure this whole app rests on.
 *
 * `getSet` is the writability flag the mirroring design needs, and the form
 * carries the legal values: a range with a step, or an enumeration. The probe
 * showed both move with the mode dial, which is why a descriptor is re-read
 * rather than cached across a change.
 */
export function parseDevicePropDesc(bytes) {
  const r = new Reader(bytes);
  const code = r.u16();
  const dataType = r.u16();
  const getSet = r.u8();
  const factoryDefault = r.typed(dataType);
  const current = r.typed(dataType);
  const formFlag = r.u8();

  const desc = {
    code, dataType, writable: getSet === 1,
    factoryDefault, current,
    form: 'none', range: null, values: null,
  };
  if (formFlag === 1) {
    desc.form = 'range';
    desc.range = { min: r.typed(dataType), max: r.typed(dataType), step: r.typed(dataType) };
  } else if (formFlag === 2) {
    desc.form = 'enum';
    const count = r.u16();
    desc.values = [];
    for (let i = 0; i < count; i++) desc.values.push(r.typed(dataType));
  }
  return desc;
}

/** What the camera says it is, and what it claims it can do. */
export function parseDeviceInfo(bytes) {
  const r = new Reader(bytes);
  return {
    standardVersion: r.u16(),
    vendorExtensionId: r.u32(),
    vendorExtensionVersion: r.u16(),
    vendorExtensionDesc: r.string(),
    functionalMode: r.u16(),
    operations: r.array(r.u16),
    events: r.array(r.u16),
    deviceProperties: r.array(r.u16),
    captureFormats: r.array(r.u16),
    imageFormats: r.array(r.u16),
    manufacturer: r.string(),
    model: r.string(),
    deviceVersion: r.string(),
    serialNumber: r.string(),
  };
}

/** Response codes worth naming, because "0x2019" helps nobody at 2am. */
export const RESPONSE_NAMES = {
  0x2001: 'OK', 0x2002: 'General error', 0x2003: 'Session not open',
  0x2005: 'Operation not supported', 0x2006: 'Parameter not supported',
  0x2007: 'Incomplete transfer', 0x200a: 'Store full', 0x200f: 'Store read only',
  0x2013: 'Device busy', 0x2019: 'Device busy', 0x201d: 'Invalid parameter',
  0x201e: 'Session already open', 0x201f: 'Transaction cancelled',
  0xa009: 'Nikon: not in live view',
};

export function describeResponse(code) {
  return RESPONSE_NAMES[code] ?? `Unknown response 0x${code.toString(16)}`;
}
