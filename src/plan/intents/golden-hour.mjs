/*
 * Sunrise, sunset, and the hour either side.
 *
 * The only intent whose answer depends on something no camera can report: a
 * date and a place. Everywhere else the app reads the body and solves; here
 * half the question is "when", and being told f/8 at the wrong hour is worse
 * than being told nothing.
 *
 * The number worth having is not the exposure — it is how fast the exposure is
 * about to stop being right. Light falls roughly a stop every ten minutes
 * through sunset, so a setting metered at the start of a window is two stops
 * wrong by the end of it.
 */

import { lightWindows, elevationAt, evAtElevation, windowMinutes } from '../../photo/sun.mjs';
import { diffractionLimitedAperture } from '../../photo/depth.mjs';
import { solveExposure } from '../../photo/exposure.mjs';
import { stabilityAdvice } from '../../photo/stability.mjs';
import { makePlan, modeCheck, foldExposureNotes } from '../plan.mjs';

const MOMENTS = {
  'golden-evening': { label: 'Golden hour, evening', window: 'goldenEvening' },
  'golden-morning': { label: 'Golden hour, morning', window: 'goldenMorning' },
  'blue-evening': { label: 'Blue hour, after sunset', window: 'blueEvening' },
  'blue-morning': { label: 'Blue hour, before sunrise', window: 'blueMorning' },
};

const clock = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const goldenHour = {
  id: 'golden-hour',
  title: 'Sunrise & sunset',
  pins: ['aperture'],

  options: [
    {
      id: 'moment',
      label: 'Which light',
      choices: Object.entries(MOMENTS).map(([id, m]) => ({ id, label: m.label })),
    },
    {
      id: 'look',
      label: 'What you are after',
      choices: [
        { id: 'landscape', label: 'Landscape', says: 'Front to back sharp' },
        { id: 'subject', label: 'A subject', says: 'Wide open, background gone' },
      ],
    },
    {
      id: 'where',
      label: 'Where you are',
      says: 'Needed for the times, not the settings',
      choices: [
        { id: '', label: 'Not set' },
        { id: 'here', label: 'Use my location' },
      ],
    },
  ],

  plan({ camera, lens, want = {} }) {
    const p = makePlan({ intent: this.id, title: this.title });
    p.options = this.options;
    p.want = want;

    const moment = MOMENTS[want.moment] ? want.moment : 'golden-evening';
    const { latitude, longitude } = want;
    const date = want.date ? new Date(want.date) : new Date();

    /*
     * The schedule, when there is somewhere to compute it for. Without a
     * location this stays null and the plan says so rather than assuming a
     * place — an hour's error in when to be standing there costs more than any
     * exposure mistake below.
     */
    let evScene = moment.startsWith('blue') ? 7 : 11.5;
    let atElevation = null;

    if (latitude != null && longitude != null) {
      const windows = lightWindows({ date, latitude, longitude });
      const window = windows[MOMENTS[moment].window];

      if (!window) {
        p.warn(windows.why
          ? `No ${MOMENTS[moment].label.toLowerCase()} here today — ${windows.why}.`
          : `There is no ${MOMENTS[moment].label.toLowerCase()} at this latitude today.`);
      } else {
        const middle = new Date((window.from.getTime() + window.to.getTime()) / 2);
        atElevation = elevationAt({ date: middle, latitude, longitude });
        evScene = evAtElevation(atElevation);

        p.schedule = {
          from: window.from, to: window.to,
          minutes: Math.round(windowMinutes(window)),
          sunrise: windows.sunrise, sunset: windows.sunset,
        };
        p.warn(`${MOMENTS[moment].label}: ${clock(window.from)} to ${clock(window.to)}, `
          + `${Math.round(windowMinutes(window))} minutes. Be set up before it starts.`);

        /* How fast this is going to stop being right. */
        const tenLater = evAtElevation(elevationAt({
          date: new Date(middle.getTime() + 600000), latitude, longitude,
        }));
        const rate = Math.abs(evScene - tenLater);
        if (rate > 0.4) {
          p.warn(`The light is changing about ${rate.toFixed(1)} stops every ten minutes. `
            + 'Meter again each time you move, or the last frame is not the exposure you set.');
        }
      }
    } else {
      p.warn('No location set, so these are the settings without the schedule. '
        + 'Tap "Use my location" for the times — the hour matters more than the aperture here.');
    }

    const ceiling = Math.round(diffractionLimitedAperture({ pixelPitchUm: camera.pixelPitchUm }));
    const aperture = (want.look ?? 'landscape') === 'subject'
      ? lens.maxAperture
      : Math.min(8, ceiling);
    p.set('aperture', aperture, (want.look ?? 'landscape') === 'subject'
      ? 'Wide open, so the background falls away while the light is this soft'
      : `Deep enough for front to back, short of the f/${ceiling} where diffraction starts costing more than it buys`);

    const solved = solveExposure({
      evScene, want: { aperture, iso: camera.baseIso ?? 100 }, absorb: 'shutter',
      bounds: { shutter: [1 / 8000, 30] },
      legal: camera.legal ?? {},
    });
    p.set('iso', solved.iso, 'Base ISO — this light is worth keeping clean');
    p.set('shutter', solved.shutter, atElevation == null
      ? `For typical ${moment.startsWith('blue') ? 'blue' : 'golden'} hour light, since no location was given`
      : `For the sun ${atElevation >= 0 ? `${atElevation.toFixed(1)}° up` : `${Math.abs(atElevation).toFixed(1)}° below the horizon`}, in the middle of the window`);
    foldExposureNotes(p, solved);

    modeCheck({ plan: p, camera, pins: this.pins });
    for (const advice of stabilityAdvice({
      shutterS: p.settings.shutter, focalLength: lens.focalLength,
      support: want.support ?? 'hand', stabilisationOn: camera.stabilisationOn ?? true,
      stabilisationStops: camera.stabilisationStops ?? 3,
    })) p.check(advice);

    return p;
  },
};
