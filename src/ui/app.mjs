/*
 * The app, as far as it goes: connect, say what you are shooting, get a plan
 * whose every number carries the line that produced it.
 *
 * Everything on screen comes from the camera or the solvers. Nothing is
 * hardcoded, which is why a plan can say "the mode dial is on A" without
 * anyone having told it what mode the camera is in.
 */

import { WebUsbTransport, explainUsbError } from '../ptp/webusb.mjs';
import { PtpSession } from '../ptp/session.mjs';
import { readCameraState, toPlannerContext, lensFrom } from '../camera/live.mjs';
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

const el = (id) => document.getElementById(id);
const show = (id, on = true) => { el(id).hidden = !on; };

export class App {
  constructor() {
    this.transport = null;
    this.session = null;
    this.state = null;
    this.camera = null;
    this.lens = null;
  }

  status(text, bad = false) {
    el('status').textContent = text;
    el('status').classList.toggle('bad', bad);
  }

  async connect() {
    this.status('Waiting for you to pick a camera…');
    this.transport = await WebUsbTransport.request();
    await this.transport.open();
    this.session = new PtpSession(this.transport);
    const info = await this.session.open();

    this.status('Reading what it will let me set…');
    this.state = await readCameraState(this.session);
    /*
     * Sensor geometry is the one thing PTP will not tell us, and the NPF limit
     * needs it. Known bodies carry a profile; anything else is assumed and the
     * interface says so rather than quietly using the wrong number.
     */
    const known = /z ?5/i.test(info.model) ? profile(NIKON_Z5) : null;
    this.camera = toPlannerContext(this.state, {
      model: `${info.manufacturer} ${info.model}`.trim(),
      pixelPitchUm: known?.pixelPitchUm ?? profile(NIKON_Z5).pixelPitchUm,
      widthPx: known?.widthPx ?? profile(NIKON_Z5).widthPx,
    });
    this.camera.assumedSensor = !known;
    this.lens = lensFrom(this.state);
    return info;
  }

  async disconnect() {
    try { await this.session?.close(); await this.transport?.close(); } catch { /* going away anyway */ }
    this.session = this.transport = this.state = this.camera = null;
  }

  plan(intentId) {
    return planFor(intentId, { camera: this.camera, lens: this.lens, site: { bortle: 3 } });
  }
}

/* ---------- rendering ---------- */

export function renderCamera(app, info) {
  const { current } = app.camera;
  const bits = [
    current.mode ? `Mode ${current.mode}` : null,
    current.shutter ? formatShutter(current.shutter) : null,
    current.aperture ? `f/${current.aperture}` : null,
    current.iso ? `ISO ${current.iso}` : null,
    current.battery != null ? `${current.battery}%` : null,
  ].filter(Boolean);

  el('cameraName').textContent = `${info.manufacturer} ${info.model}`.trim();
  el('cameraNow').textContent = bits.join(' · ');
  el('cameraLens').textContent = app.lens.reported
    ? `${app.lens.focalLength}mm, opens to f/${app.lens.maxAperture}`
    : `Lens not reported — assuming ${app.lens.focalLength}mm f/${app.lens.maxAperture}`;
  el('cameraLens').classList.toggle('assumed', !app.lens.reported);

  const notes = [];
  if (app.camera.assumedSensor) notes.push('Sensor size assumed from a Z5; the NPF limit will be approximate.');
  if (app.state.missing.length) {
    notes.push(`${app.state.missing.length} standard setting${app.state.missing.length > 1 ? 's' : ''} this body does not offer: ${app.state.missing.map((m) => m.name).join(', ')}.`);
  }
  el('cameraNotes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
  el('cameraNotes').hidden = !notes.length;
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

export function renderPlan(plan, camera) {
  el('planTitle').textContent = plan.title;
  el('planWhere').textContent = camera.model ?? '';

  el('planRows').innerHTML = ['shutter', 'aperture', 'iso', 'frames']
    .filter((axis) => plan.settings[axis] != null)
    .map((axis) => {
      const raw = plan.settings[axis];
      const shown = axis === 'shutter' ? formatShutter(raw) : axis === 'aperture' ? `f/${raw}` : Math.round(raw);
      return `<div class="row">
        <div class="row-label">${axis === 'iso' ? 'ISO' : axis}</div>
        <div><div class="row-value">${shown}</div>
        <div class="row-why">${plan.reasons[axis] ?? ''}</div></div>
      </div>`;
    }).join('');

  const checks = plan.checks.map((c) => `
    <div class="check ${c.appCanFix ? 'mine' : 'yours'}">
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
