/*
 * The app, as far as it goes: connect, say what you are shooting, get a plan
 * whose every number carries the line that produced it.
 *
 * Everything on screen comes from the camera or the solvers. Nothing is
 * hardcoded, which is why a plan can say "the mode dial is on A" without
 * anyone having told it what mode the camera is in.
 *
 * And it keeps saying it. The camera is re-read on a timer, so a hand on the
 * dial changes the screen — that was the whole premise, and a state read once
 * at connect quietly abandoned it.
 */

import { connectTransport, transportKind } from '../ptp/connect.mjs';
import { PtpSession } from '../ptp/session.mjs';
import { readCameraState, toPlannerContext, lensFrom, describeLens } from '../camera/live.mjs';
import { profile, NIKON_Z5 } from '../photo/bodies.mjs';
import { formatShutter } from '../photo/units.mjs';
import { planFor } from '../plan/index.mjs';

/** The catalogue, in the order the design settled on: overlapping pairs adjacent. */
export const CHOICES = [
  { id: 'waterfall', title: 'Waterfalls', says: 'Moving water, and the filter it needs', built: true },
  { id: 'long-exposure', title: 'Long exposure', says: 'Anything else that wants a slow shutter' },
  { id: 'milky-way', title: 'Milky Way', says: 'The core, and whether tonight is the night', built: true },
  { id: 'astro', title: 'Astro', says: 'Star trails, aurora, anything else up there' },
  { id: 'golden-hour', title: 'Sunrise & sunset', says: 'Golden hour, and where the light will fall' },
  { id: 'timelapse', title: 'Timelapse', says: 'Many frames, assembled into a clip', built: true },
  { id: 'intervalometer', title: 'Intervalometer', says: 'Frames on a timer, kept as frames' },
];

/** How often to ask the camera what it is set to now. */
const WATCH_MS = 1200;

const el = (id) => document.getElementById(id);
const show = (id, on = true) => { el(id).hidden = !on; };

/* ---------- the three axes, as a person writes them ---------- */

const AXES = [
  { id: 'shutter', label: 'Shutter' },
  { id: 'aperture', label: 'Aperture' },
  { id: 'iso', label: 'ISO' },
];

const SPECIAL_NAMES = { bulb: 'Bulb', time: 'Time', none: '—' };

/**
 * One axis as text. `special` wins over any number, because when the camera
 * answers with a placeholder there is no number — that is the whole point of
 * a placeholder, and converting it is how 0xffffffff became "429497s".
 */
export function formatAxis(axis, value, special = null) {
  if (special) return SPECIAL_NAMES[special] ?? special;
  if (value == null || !Number.isFinite(value)) return '—';
  if (axis === 'shutter') return formatShutter(value);
  if (axis === 'aperture') return `f/${Number(value.toFixed(1))}`;
  return String(Math.round(value));
}

export class App {
  constructor() {
    this.transport = null;
    this.session = null;
    this.state = null;
    this.camera = null;
    this.lens = null;
    this.info = null;
    this.watchTimer = null;
  }

  status(text, bad = false) {
    el('status').textContent = text;
    el('status').classList.toggle('bad', bad);
  }

  async connect() {
    /*
     * Anything left over from a failed attempt still holds the device, so the
     * second try fails for a reason the first one created — and it looks
     * exactly like the system daemon holding it.
     */
    await this.disconnect();

    this.status(transportKind() === 'WebUSB'
      ? 'Waiting for you to pick a camera…'
      : 'Opening a session…');
    this.transport = await connectTransport();
    this.session = new PtpSession(this.transport);

    try {
      this.info = await this.session.open();
    } catch (error) {
      /*
       * Silence on the very first command is usually a session the last run
       * left open. Closing it and opening a fresh one is exactly what a person
       * does by hand before it works, so do it here once instead of making
       * them. A second silence is a real one and gets reported.
       */
      if (!this.transport?.stalled) throw error;
      this.status('No answer. Handing the session back and trying once more…');
      await this.disconnect();
      this.transport = await connectTransport();
      this.session = new PtpSession(this.transport);
      this.info = await this.session.open();
    }

    this.status('Reading what it will let me set…');
    await this.refresh();
    return this.info;
  }

  /** Read the camera and rebuild everything derived from it. */
  async refresh() {
    this.state = await readCameraState(this.session);
    /*
     * Sensor geometry is the one thing PTP will not tell us, and the NPF limit
     * needs it. Known bodies carry a profile; anything else is assumed and the
     * interface says so rather than quietly using the wrong number.
     */
    const known = /z ?5/i.test(this.info.model) ? profile(NIKON_Z5) : null;
    this.camera = toPlannerContext(this.state, {
      model: `${this.info.manufacturer} ${this.info.model}`.trim(),
      pixelPitchUm: known?.pixelPitchUm ?? profile(NIKON_Z5).pixelPitchUm,
      widthPx: known?.widthPx ?? profile(NIKON_Z5).widthPx,
    });
    this.camera.assumedSensor = !known;
    this.lens = lensFrom(this.state);
  }

  /**
   * What the screen is showing, boiled to a string. Re-rendering on every tick
   * would fight the person's scroll position and blink the numbers; this says
   * whether anything they can see actually moved.
   */
  fingerprint() {
    if (!this.camera) return '';
    return JSON.stringify([
      this.camera.mode, this.camera.current, this.camera.specials,
      this.camera.writableByMode, this.lens?.focalLength, this.lens?.maxAperture,
    ]);
  }

  /** Re-read on a timer, and call back only when something changed. */
  watch(onChange) {
    this.unwatch();
    const tick = async () => {
      if (!this.session) return;
      try {
        const before = this.fingerprint();
        await this.refresh();
        if (this.fingerprint() !== before) onChange(null);
      } catch (error) {
        /* A camera that has stopped answering will not start again on its own,
         * and a timer that keeps asking buries the reason under retries. */
        onChange(error);
        return;
      }
      this.watchTimer = setTimeout(tick, WATCH_MS);
    };
    this.watchTimer = setTimeout(tick, WATCH_MS);
  }

  unwatch() {
    clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }

  async disconnect() {
    this.unwatch();
    try { await this.session?.close(); } catch { /* going away anyway */ }
    try { await this.transport?.close(); } catch { /* going away anyway */ }
    this.session = this.transport = this.state = this.camera = this.info = null;
  }

  plan(intentId) {
    return planFor(intentId, { camera: this.camera, lens: this.lens, site: { bortle: 3 } });
  }
}

/* ---------- rendering ---------- */

export function renderCamera(app, info) {
  const { current, specials } = app.camera;
  const bits = [
    current.mode ? `Mode ${current.mode}` : null,
    formatAxis('shutter', current.shutter, specials.shutter),
    formatAxis('aperture', current.aperture, specials.aperture),
    current.iso != null ? `ISO ${formatAxis('iso', current.iso, specials.iso)}` : null,
    current.battery != null ? `${current.battery}%` : null,
  ].filter((bit) => bit && bit !== '—');

  el('cameraName').textContent = `${info.manufacturer} ${info.model}`.trim();
  el('cameraNow').textContent = bits.join(' · ');
  el('cameraLens').textContent = describeLens(app.lens);
  el('cameraLens').classList.toggle('assumed', !app.lens.reported);

  const notes = [];
  if (app.camera.assumedSensor) notes.push('Sensor size assumed from a Z5; the NPF limit will be approximate.');
  if (specials.shutter === 'bulb') {
    notes.push('The shutter is on bulb, so the camera has no exposure time to report until one is set.');
  }
  if (app.state.missing.length) {
    notes.push(`${app.state.missing.length} standard setting${app.state.missing.length > 1 ? 's' : ''} this body does not offer: ${app.state.missing.map((m) => m.name).join(', ')}.`);
  }
  el('cameraNotes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
  el('cameraNotes').hidden = !notes.length;
  renderRaw(app.state);
}

/*
 * What the camera actually said, before any of this interpreted it.
 *
 * This project is a long argument with a protocol that has no way to say "I do
 * not know", and every wrong number so far has been a correct reading of a
 * value that meant something else. One tap, one screenshot, and the raw is
 * there beside what we made of it — which beats another round of guessing at
 * what 32784 was supposed to be.
 */
function renderRaw(state) {
  const rows = Object.entries(state.axes).map(([name, a]) => {
    /* The three exposure axes have a written form; the rest are just numbers,
     * and rounding a focal length to an ISO would hide the very digits this
     * table exists to show. */
    const decoded = a.special ? `${a.special} (placeholder)`
      : AXES.some((x) => x.id === name) ? formatAxis(name, a.value)
      : name === 'focalLength' ? `${a.value}mm`
      : String(a.value);
    return `<tr>
      <td>${name}</td>
      <td class="num">${a.raw}</td>
      <td>${decoded}</td>
      <td>${a.form}${a.range ? ` ${a.range.min}–${a.range.max}` : ''}${a.legal ? ` ${a.legal.length} values` : ''}</td>
      <td>${a.writable ? 'mine' : 'read-only'}</td>
    </tr>`;
  }).join('');

  const missing = state.missing.map((m) => `<tr class="gone">
    <td>${m.name}</td><td class="num">0x${m.code.toString(16)}</td><td colspan="3">${m.why}</td></tr>`).join('');

  el('cameraRawBody').innerHTML = `<table>
    <tr><th>Axis</th><th>Raw</th><th>Read as</th><th>Form</th><th>Writable</th></tr>
    ${rows}${missing}</table>`;
}

export function renderChoices(onPick) {
  el('choices').innerHTML = CHOICES.map((c) => `
    <button class="choice" data-id="${c.id}" ${c.built ? '' : 'disabled'}>
      <span class="choice-title">${c.title}</span>
      <span class="choice-says">${c.built ? c.says : 'not built yet'}</span>
    </button>`).join('');
  for (const button of el('choices').querySelectorAll('.choice')) {
    button.onclick = () => onPick(button.dataset.id);
  }
}

/**
 * The two readouts, side by side.
 *
 * What the camera is set to now, and what it should be set to — the second is
 * only meaningful next to the first, and a column that has already arrived is
 * one less thing to touch in the dark.
 */
function renderGrid(plan, camera) {
  const cells = (kind) => AXES.map(({ id }) => {
    const ideal = plan.settings[id];
    const now = camera.current[id];
    const special = camera.specials[id];

    if (kind === 'current') {
      const matched = ideal != null && special == null && now != null
        && Math.abs(Math.log2(now / ideal)) < 0.17;   /* within a sixth of a stop */
      return `<div class="g-cell ${matched ? 'matched' : ''}">${formatAxis(id, now, special)}</div>`;
    }
    const mine = camera.writableByMode?.[camera.mode]?.includes(id);
    return `<div class="g-cell ideal ${ideal == null ? 'none' : ''}" title="${mine ? 'Mine to set' : 'Yours to set'}">
      ${formatAxis(id, ideal)}${ideal == null ? '' : `<span class="g-who">${mine ? 'mine' : 'yours'}</span>`}
    </div>`;
  }).join('');

  el('planGrid').innerHTML = `
    <div class="g-corner"></div>
    ${AXES.map((a) => `<div class="g-head">${a.label}</div>`).join('')}
    <div class="g-label">Current</div>${cells('current')}
    <div class="g-label">Ideal</div>${cells('ideal')}`;
}

export function renderPlan(plan, camera) {
  el('planTitle').textContent = plan.title;
  el('planWhere').textContent = camera.model ?? '';

  renderGrid(plan, camera);

  el('planRows').innerHTML = AXES.concat([{ id: 'frames', label: 'Frames' }])
    .filter(({ id }) => plan.settings[id] != null && plan.reasons[id])
    .map(({ id, label }) => `<div class="why">
        <span class="why-axis">${label}</span>
        <span class="why-text">${plan.reasons[id]}</span>
      </div>`).join('');

  /*
   * Three kinds of note, and the colour is the difference: green is mine to
   * do, clay is yours to do, yellow is nobody's to do but worth knowing.
   */
  const klass = (c) => (c.severity === 'warn' ? 'warn' : c.appCanFix ? 'mine' : 'yours');
  const checks = plan.checks.map((c) => `
    <div class="check ${klass(c)}">
      <div class="check-says">${c.says}</div>
      <div class="check-fix">${c.fix}</div>
    </div>`).join('');
  const warnings = plan.warnings.map((w) => `<div class="check warn"><div class="check-says">${w}</div></div>`).join('');
  el('planChecks').innerHTML = checks + warnings;
  el('planChecksHead').hidden = !(plan.checks.length || plan.warnings.length);

  if (plan.filters) {
    el('planFilters').innerHTML =
      `<div class="row-value">${plan.filters.names.join(' + ') || 'none'}</div>
       <div class="row-why">${plan.filters.says}</div>`;
  }
  el('planFiltersHead').hidden = !plan.filters;

  el('planReady').textContent = plan.ready
    ? 'Everything here is mine to set.'
    : `Waiting on you: ${plan.blockers.length} thing${plan.blockers.length > 1 ? 's' : ''} only a hand can change.`;
  el('planReady').classList.toggle('blocked', !plan.ready);
}

export { show, el };
