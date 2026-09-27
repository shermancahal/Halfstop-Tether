/*
 * A camera made of a file, standing in for one made of metal.
 *
 * fixtures/nikon-z5.json is a real body's whole surface, captured by the probe
 * in three minutes: every legal shutter speed, aperture and ISO it offers, and
 * which of them are writable in each position of the mode dial. That is enough
 * to answer every question the app asks a camera.
 *
 * So this is not a mock of the app's logic — it is a mock of the *camera*, one
 * layer below anything interesting. readCameraState, applyPlan and runSequence
 * all run exactly as they do over USB, which means the demo exercises the real
 * code and a bug found here is a real bug.
 *
 * The one thing it cannot do is surprise us, and surprising us is most of what
 * a real camera does. It is a way to work on the app without one, not a
 * substitute for testing against one.
 */

import { DPC, MODES, fromSeconds, fromFNumber } from './live.mjs';
import { OC, RESPONSE_OK } from '../ptp/codec.mjs';

const UINT16 = 0x0004;
const UINT32 = 0x0006;

/** Each axis: where its value lives, and how to get between raw and real. */
const WIRE = {
  shutter: { code: DPC.ExposureTime, dataType: UINT32, encode: fromSeconds, decode: (raw) => raw / 10000 },
  aperture: { code: DPC.FNumber, dataType: UINT16, encode: fromFNumber, decode: (raw) => raw / 100 },
  iso: { code: DPC.ExposureIndex, dataType: UINT16, encode: Math.round, decode: (raw) => raw },
};

const MODE_CODES = Object.fromEntries(Object.entries(MODES).map(([code, name]) => [name, Number(code)]));

/**
 * @param fixture  a probe capture, as fixtures/*.json
 * @param start    which dial position and where each axis sits
 */
export function fixtureSession(fixture, { mode = 'M', focalLengthMm = 35, batteryPercent = 87 } = {}) {
  const nearest = (axis, value) => {
    const legal = fixture.axes[axis].legal;
    return legal.reduce((best, v) => (Math.abs(Math.log2(v / value)) < Math.abs(Math.log2(best / value)) ? v : best), legal[0]);
  };

  /* Where the dial and the rings actually are, which the app may change. */
  const at = {
    mode,
    shutter: nearest('shutter', 1 / 60),
    aperture: nearest('aperture', 8),
    iso: nearest('iso', 100),
  };

  const writableNow = (axis) => (fixture.writableByMode[at.mode] ?? []).includes(axis);

  const session = {
    /* What the app reads off a real one. */
    deviceInfo: {
      manufacturer: 'Nikon Corporation',
      /* The manufacturer field already says Nikon; saying it twice reads badly. */
      model: fixture.camera.model.replace(/^nikon\s*/i, ''),
      deviceVersion: 'fixture',
      serialNumber: '',
      operations: [OC.GetDeviceInfo, OC.GetDevicePropDesc, OC.SetDevicePropValue, OC.InitiateCapture, OC.NikonDeviceReady],
      deviceProperties: [DPC.ExposureTime, DPC.FNumber, DPC.ExposureIndex, DPC.ExposureProgramMode, DPC.FocalLength, DPC.BatteryLevel],
      events: [],
    },
    /* The demo's own dial, which a real session does not have. */
    fixture: true,
    get mode() { return at.mode; },
    setMode(next) {
      if (!fixture.writableByMode[next]) throw new Error(`This body has no ${next} on its dial.`);
      at.mode = next;
    },
    modes: Object.keys(fixture.writableByMode),

    supports(opcode) { return this.deviceInfo.operations.includes(opcode); },

    async getPropDesc(code) {
      for (const [axis, wire] of Object.entries(WIRE)) {
        if (wire.code !== code) continue;
        return {
          code, dataType: wire.dataType, writable: writableNow(axis),
          factoryDefault: wire.encode(fixture.axes[axis].legal[0]),
          current: wire.encode(at[axis]),
          form: 'enum', range: null,
          values: fixture.axes[axis].legal.map(wire.encode),
        };
      }
      if (code === DPC.ExposureProgramMode) {
        return {
          code, dataType: UINT16,
          /* The probe found the dial read-only on this body, which is the
           * finding the whole mode check rests on. */
          writable: !fixture.camera.modeIsReadOnly,
          factoryDefault: MODE_CODES.M, current: MODE_CODES[at.mode] ?? MODE_CODES.M,
          form: 'enum', range: null,
          values: session.modes.map((m) => MODE_CODES[m]).filter(Boolean),
        };
      }
      if (code === DPC.FocalLength) {
        return {
          code, dataType: UINT32, writable: false,
          factoryDefault: focalLengthMm * 100, current: focalLengthMm * 100,
          form: 'range', values: null,
          range: { min: 2400, max: 7000, step: 100 },
        };
      }
      if (code === DPC.BatteryLevel) {
        return {
          code, dataType: 0x0002, writable: false,
          factoryDefault: 100, current: batteryPercent,
          form: 'range', values: null, range: { min: 0, max: 100, step: 1 },
        };
      }
      throw new Error(`Operation not supported (property 0x${code.toString(16)})`);
    },

    async transaction({ opcode, params = [], dataOut = null }) {
      if (opcode === OC.SetDevicePropValue) {
        const code = params[0];
        const entry = Object.entries(WIRE).find(([, w]) => w.code === code);
        if (!entry) throw new Error(`Nothing here writes property 0x${code.toString(16)}`);
        const [axis, wire] = entry;
        if (!writableNow(axis)) throw new Error(`The camera is setting ${axis} itself in this mode`);

        const view = new DataView(dataOut.buffer, dataOut.byteOffset, dataOut.byteLength);
        const raw = wire.dataType === UINT32 ? view.getUint32(0, true) : view.getUint16(0, true);
        /* A real body lands on its nearest legal value, not on what it was
         * handed — which is the behaviour applyPlan's confirmation exists for. */
        at[axis] = nearest(axis, wire.decode(raw));
        return { data: null, params: [] };
      }
      if (opcode === OC.InitiateCapture || opcode === OC.NikonDeviceReady) return { data: null, params: [] };
      if (opcode === OC.GetDeviceInfo) return { data: null, params: [] };
      throw new Error(`The fixture does not answer 0x${opcode.toString(16)}`);
    },

    async open() { return session.deviceInfo; },
    async close() {},
  };

  return session;
}

export const RESPONSE_OK_CODE = RESPONSE_OK;
