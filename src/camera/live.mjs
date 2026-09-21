/*
 * A connected camera, in the terms the planner uses.
 *
 * PTP reports exposure in integers with implied scales — f/2.8 arrives as 280,
 * 1/125 of a second as 80 — and identifies settings by number. This turns that
 * into the shutter seconds, f-numbers and ISOs everything above it works in.
 *
 * At runtime the question is not "which modes allow this" but "may I set it
 * right now, and if not, who is". That is one flag per descriptor, read from
 * the camera, and it is more honest than any stored map: the body is the one
 * saying so.
 */

import { OC } from '../ptp/codec.mjs';

/** The standard property codes. Vendors add their own; these are in the spec. */
export const DPC = {
  BatteryLevel: 0x5001,
  WhiteBalance: 0x5005,
  FNumber: 0x5007,
  FocalLength: 0x500a,
  FocusDistance: 0x500b,
  ExposureTime: 0x500d,
  ExposureProgramMode: 0x500e,
  ExposureIndex: 0x500f,
  ExposureBiasCompensation: 0x5010,
  StillCaptureMode: 0x5013,
};

/** ExposureProgramMode, as the specification numbers them. */
export const MODES = { 1: 'M', 2: 'P', 3: 'A', 4: 'S' };

/* PTP's implied scales. Each is "the unit the camera counts in". */
export const toSeconds = (raw) => raw / 10000;        /* ExposureTime: 0.1 ms */
export const toFNumber = (raw) => raw / 100;          /* FNumber: hundredths */
export const toMillimetres = (raw) => raw / 100;      /* FocalLength: hundredths */
export const fromSeconds = (s) => Math.round(s * 10000);
export const fromFNumber = (f) => Math.round(f * 100);

/**
 * Read the handful of properties a plan depends on, and say for each whether
 * the app may write it — which is the reality check, straight from the body.
 */
export async function readCameraState(session) {
  const wanted = {
    shutter: { code: DPC.ExposureTime, decode: toSeconds },
    aperture: { code: DPC.FNumber, decode: toFNumber },
    iso: { code: DPC.ExposureIndex, decode: (v) => v },
    mode: { code: DPC.ExposureProgramMode, decode: (v) => MODES[v] ?? `unknown (${v})` },
    focalLength: { code: DPC.FocalLength, decode: toMillimetres },
    battery: { code: DPC.BatteryLevel, decode: (v) => v },
  };

  const axes = {};
  const missing = [];
  for (const [name, { code, decode }] of Object.entries(wanted)) {
    try {
      const desc = await session.getPropDesc(code);
      axes[name] = {
        code,
        value: decode(desc.current),
        writable: desc.writable,
        legal: desc.form === 'enum' ? desc.values.map(decode).sort((a, b) => a - b) : null,
        range: desc.form === 'range'
          ? { min: decode(desc.range.min), max: decode(desc.range.max) }
          : null,
      };
    } catch (error) {
      /* A body that does not offer a standard property is not broken; it is
       * a body that does something else. Record it and carry on. */
      missing.push({ name, code, why: error.message });
    }
  }
  return { axes, missing };
}

/**
 * The shape src/plan expects.
 *
 * `writableByMode` carries only the mode the camera is actually in, because
 * that is all a connected body can truthfully report — the rest of the map is
 * a fixture's job, measured by sweeping the dial.
 */
export function toPlannerContext({ axes, missing }, { model, pixelPitchUm, widthPx, ...rest } = {}) {
  const mode = axes.mode?.value ?? 'M';
  const writableNow = ['shutter', 'aperture', 'iso'].filter((a) => axes[a]?.writable);
  return {
    model, pixelPitchUm, widthPx, mode,
    writableByMode: { [mode]: writableNow },
    legal: Object.fromEntries(
      ['shutter', 'aperture', 'iso'].filter((a) => axes[a]?.legal).map((a) => [a, axes[a].legal]),
    ),
    isoBounds: axes.iso?.legal ? [axes.iso.legal[0], axes.iso.legal.at(-1)] : undefined,
    baseIso: axes.iso?.legal?.find((v) => v >= 100) ?? 100,
    batteryPercent: axes.battery?.value,
    current: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, v.value])),
    missing,
    ...rest,
  };
}

/** What the lens says about itself, when it says anything. */
export function lensFrom({ axes }, fallback = {}) {
  const focalLength = axes.focalLength?.value ?? fallback.focalLength ?? 50;
  /* The widest the aperture goes at this focal length is the lens's own limit. */
  const maxAperture = axes.aperture?.legal?.[0] ?? axes.aperture?.range?.min ?? fallback.maxAperture ?? 4;
  return { focalLength, maxAperture, reported: Boolean(axes.focalLength) };
}

/** Set a value, in the units a photographer uses rather than the camera's. */
export async function setAxis(session, axis, value) {
  const encode = { shutter: fromSeconds, aperture: fromFNumber, iso: (v) => Math.round(v) }[axis];
  const code = { shutter: DPC.ExposureTime, aperture: DPC.FNumber, iso: DPC.ExposureIndex }[axis];
  if (!encode) throw new Error(`No idea how to set ${axis}`);
  const desc = await session.getPropDesc(code);
  if (!desc.writable) throw new Error(`The camera is setting ${axis} itself in this mode`);
  const raw = encode(value);
  const bytes = new Uint8Array(desc.dataType === 0x0006 ? 4 : 2);
  new DataView(bytes.buffer)[desc.dataType === 0x0006 ? 'setUint32' : 'setUint16'](0, raw, true);
  await session.transaction({ opcode: OC.SetDevicePropValue, params: [code], dataOut: bytes });
  return value;
}
