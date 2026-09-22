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

/*
 * All-ones is not a number.
 *
 * PTP has no null, so a property with nothing meaningful to report returns the
 * largest value its type can hold. Divide that by the scale and you get a
 * plausible-looking lie: 0xffffffff through `toSeconds` is 429497s, which the
 * interface printed next to the shutter speed as though the camera had said
 * it. Nikon spends the top two values on real settings, and those have names.
 */
const ALL_ONES = { 0x0002: 0xff, 0x0004: 0xffff, 0x0006: 0xffffffff };

export const SPECIAL_SHUTTER = { 0xffffffff: 'bulb', 0xfffffffe: 'time' };

/*
 * What a real reading looks like.
 *
 * Matching the exact all-ones value is not enough. Vendors spend the top of
 * the range on bulb, on time, and on "ask me later", and they do not agree on
 * which value means which — so a placeholder one short of the maximum sails
 * through an equality check and comes out the far side as a 429497-second
 * exposure. Nothing outside these bounds is a setting any camera holds.
 */
const PLAUSIBLE = {
  shutter: [1 / 64000, 3600],
  aperture: [0.7, 100],
  iso: [6, 4000000],
  focalLength: [4, 2000],
};

function readSpecial(name, raw, dataType, decode) {
  if (name === 'shutter' && SPECIAL_SHUTTER[raw] != null) return SPECIAL_SHUTTER[raw];
  const top = ALL_ONES[dataType];
  /* Near the ceiling of its type, with no name we know for it. */
  if (top != null && raw >= top - 16) return 'none';

  const bounds = PLAUSIBLE[name];
  if (!bounds || typeof decode !== 'function') return null;
  const value = decode(raw);
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < bounds[0] || value > bounds[1] ? 'none' : null;
}

/*
 * Focal lengths a lens could actually have. Only a backstop for a body that
 * reports the property with no range of its own — where there is a range, the
 * lens is a better authority than any constant here.
 */
const FOCAL_MM_BOUNDS = [4, 2000];

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
      const special = readSpecial(name, desc.current, desc.dataType, decode);
      axes[name] = {
        code,
        raw: desc.current,
        dataType: desc.dataType,
        form: desc.form,
        /* `special` means the number is a placeholder; do not convert it. */
        value: special ? null : decode(desc.current),
        special,
        writable: desc.writable,
        legal: desc.form === 'enum'
          ? desc.values.filter((v) => !readSpecial(name, v, desc.dataType, decode)).map(decode).sort((a, b) => a - b)
          : null,
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
    /* Axes the camera answered with a placeholder rather than a number. */
    specials: Object.fromEntries(
      Object.entries(axes).filter(([, v]) => v.special).map(([k, v]) => [k, v.special]),
    ),
    missing,
    ...rest,
  };
}

/**
 * What the lens says about itself, when it says anything.
 *
 * The focal-length descriptor carries the lens's own zoom range in the same
 * units as its current value, which makes it the authority on whether that
 * value means anything: a 24-70 reporting 327.84mm is outside the range it
 * declared one field earlier, so whatever we decoded, it was not millimetres.
 * Rather than feed that into the NPF limit, fall back to the long end of the
 * declared range — the shortest exposure the lens could need, and so the one
 * that will not trail whatever it is really set to.
 */
export function lensFrom({ axes }, fallback = {}) {
  /* The widest the aperture goes at this focal length is the lens's own limit. */
  const maxAperture = axes.aperture?.legal?.[0] ?? axes.aperture?.range?.min ?? fallback.maxAperture ?? 4;
  const fl = axes.focalLength;
  const zoom = fl?.range && fl.range.min > 0 && fl.range.max >= fl.range.min ? fl.range : null;
  const base = { maxAperture, zoom, prime: Boolean(zoom) && zoom.min === zoom.max };

  if (!fl || fl.special || !Number.isFinite(fl.value)) {
    return { ...base, focalLength: fallback.focalLength ?? 50, reported: false, disagreed: null };
  }

  const [low, high] = zoom ? [zoom.min, zoom.max] : FOCAL_MM_BOUNDS;
  if (fl.value >= low - 0.5 && fl.value <= high + 0.5) {
    return { ...base, focalLength: fl.value, reported: true, disagreed: null };
  }
  return {
    ...base,
    focalLength: zoom ? zoom.max : (fallback.focalLength ?? 50),
    reported: false,
    disagreed: fl.value,
  };
}

/** The lens line, in one sentence, including when the sentence is bad news. */
export function describeLens(lens) {
  const opens = `opens to f/${lens.maxAperture}`;
  if (lens.reported) return `${round2(lens.focalLength)}mm, ${opens}`;
  if (lens.disagreed != null && lens.zoom) {
    return `The camera reports ${round2(lens.disagreed)}mm on a `
      + `${round2(lens.zoom.min)}\u2013${round2(lens.zoom.max)}mm lens, which cannot be right — `
      + `planning for ${round2(lens.zoom.max)}mm so nothing trails. ${opens[0].toUpperCase()}${opens.slice(1)}.`;
  }
  return `Lens not reported \u2014 assuming ${round2(lens.focalLength)}mm, ${opens}`;
}

const round2 = (n) => Number(n.toFixed(2));

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
