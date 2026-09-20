/*
 * A camera, as a file.
 *
 * The probe writes a description of a body's whole surface. Captured in three
 * minutes by someone who owns the camera, it then runs in CI forever on
 * machines that have never seen one. This is the format that description takes,
 * and the translation from what gphoto2 reports into the axes the planner
 * reasons about.
 *
 * The paths and value strings below are gphoto2's. When the app speaks raw PTP
 * it will map property codes instead, and this stays the same shape — the point
 * of a fixture is that it outlives the tool that produced it.
 */

export const FIXTURE_VERSION = 1;

/** gphoto2 writes shutter times three different ways, sometimes in one list. */
export function parseShutter(text) {
  if (/bulb|time|^x /i.test(text)) return null;          /* not a duration */
  const fraction = text.match(/^1\/([\d.]+)$/);
  if (fraction) return 1 / Number(fraction[1]);
  const seconds = text.match(/^([\d.]+)s?$/);
  return seconds ? Number(seconds[1]) : null;
}

export function parseAperture(text) {
  const m = text.match(/^f\/([\d.]+)$/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseIso(text) {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/*
 * Where each axis lives, and how to read its values. More than one path can
 * carry the same axis — this body reports shutter speed twice, as decimals and
 * as fractions — so the first one that parses wins.
 */
export const AXES = {
  shutter: { paths: ['/main/capturesettings/shutterspeed', '/main/capturesettings/shutterspeed2'], parse: parseShutter },
  aperture: { paths: ['/main/capturesettings/f-number'], parse: parseAperture },
  iso: { paths: ['/main/imgsettings/iso'], parse: parseIso },
};

const MODE_PATH = '/main/capturesettings/expprogram';

const has = (configs, pattern) => Object.keys(configs).some((path) => pattern.test(path));

function axisEntry(configs, axis) {
  for (const path of AXES[axis].paths) {
    const config = configs[path];
    if (!config) continue;
    const legal = config.choices.map(AXES[axis].parse).filter((v) => v != null).sort((a, b) => a - b);
    if (legal.length) return { path, legal, readonly: config.readonly === true, value: AXES[axis].parse(config.value) };
  }
  return null;
}

/**
 * Turn a probe run into a fixture.
 *
 * @param report     the probe's report.json
 * @param modeDumps  { M: parsedConfigs, A: ..., ... } from the mode sweep files
 */
export function fromProbe({ report, modeDumps = {}, liveViewFrame = null }) {
  const configs = report.phases.config.configs;
  const axes = {};
  for (const axis of Object.keys(AXES)) {
    const entry = axisEntry(configs, axis);
    if (entry) axes[axis] = entry;
  }

  /*
   * The map the whole mirroring design turns on, read off the camera in each
   * dial position rather than assumed. An axis counts as writable in a mode
   * when the body reported it so while the dial was there.
   */
  const writableByMode = {};
  for (const [mode, dump] of Object.entries(modeDumps)) {
    writableByMode[mode] = Object.keys(AXES).filter((axis) => {
      const entry = axisEntry(dump, axis);
      return entry && !entry.readonly;
    });
  }

  /*
   * A frame on disk outranks the report's own verdict. An early probe wrote
   * "no live view" because it looked for the wrong filename while a perfectly
   * good 640x424 frame sat beside it, and a fixture built from that would have
   * taught the test suite something false about this camera.
   */
  const liveView = liveViewFrame
    ? { widthPx: liveViewFrame.width, heightPx: liveViewFrame.height, bytesPerFrame: liveViewFrame.bytes }
    : report.phases.liveview?.ok
      ? { widthPx: report.phases.liveview.width, heightPx: report.phases.liveview.height, bytesPerFrame: report.phases.liveview.bytes }
      : null;

  return {
    fixtureVersion: FIXTURE_VERSION,
    camera: {
      model: (report.phases.detect.cameras[0] ?? '').split(/\s{2,}/)[0].trim(),
      modeIsReadOnly: configs[MODE_PATH]?.readonly === true,
    },
    capturedAt: report.probedAt,
    capturedWith: `${report.gphoto2} via tools/probe.mjs`,
    capabilities: {
      liveView,
      /* Read off the settings themselves rather than the run's summary: the
       * surface is the evidence, and it is in the same file. */
      manualFocusDrive: has(configs, /manualfocusdrive/i) || (report.phases.focus?.manualFocusDrive ?? false),
      liveViewZoom: has(configs, /zoomratio/i) || (report.phases.focus?.liveViewZoom ?? false),
      starlightView: has(configs, /starlight/i) || (report.phases.focus?.starlightView ?? false),
    },
    counts: { settings: report.phases.config.count, writable: report.phases.config.writable },
    axes,
    writableByMode,
    eventsObserved: report.phases.events?.matched?.length ?? 0,
  };
}

/** Enough of a check that a bad fixture fails loudly rather than skewing a test. */
export function validate(fixture) {
  const problems = [];
  if (fixture.fixtureVersion !== FIXTURE_VERSION) problems.push(`version ${fixture.fixtureVersion}, expected ${FIXTURE_VERSION}`);
  if (!fixture.camera?.model) problems.push('no camera model');
  for (const axis of ['shutter', 'aperture', 'iso']) {
    const entry = fixture.axes?.[axis];
    if (!entry) { problems.push(`no ${axis} axis`); continue; }
    if (!entry.legal?.length) problems.push(`${axis} has no legal values`);
    if (entry.legal?.some((v) => !Number.isFinite(v) || v <= 0)) problems.push(`${axis} has a value that is not a positive number`);
    const sorted = [...entry.legal].sort((a, b) => a - b);
    if (String(sorted) !== String(entry.legal)) problems.push(`${axis} legal values are not sorted`);
  }
  if (!Object.keys(fixture.writableByMode ?? {}).length) problems.push('no writability map — the mode sweep did not run');
  return problems;
}

/** The shape the planner wants, from the shape the probe produced. */
export function toCameraContext(fixture, { pixelPitchUm, widthPx, mode, ...rest } = {}) {
  return {
    model: fixture.camera.model,
    pixelPitchUm, widthPx,
    mode: mode ?? Object.keys(fixture.writableByMode)[0],
    writableByMode: fixture.writableByMode,
    legal: Object.fromEntries(Object.entries(fixture.axes).map(([axis, e]) => [axis, e.legal])),
    isoBounds: fixture.axes.iso ? [fixture.axes.iso.legal[0], fixture.axes.iso.legal.at(-1)] : undefined,
    baseIso: fixture.axes.iso?.legal.find((v) => v >= 100) ?? 100,
    liveView: fixture.capabilities.liveView,
    manualFocusDrive: fixture.capabilities.manualFocusDrive,
    ...rest,
  };
}
