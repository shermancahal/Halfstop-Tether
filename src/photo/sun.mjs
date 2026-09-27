/*
 * Where the sun is, and when it will be there.
 *
 * Golden hour is the only intent whose answer depends on something no camera
 * can report and no rule of thumb covers: a date, and a place on the Earth.
 * The light at 6pm in June in Vermont is not the light at 6pm in December, and
 * the difference is an hour and a half of usable time.
 *
 * This is the standard low-precision solar position calculation — good to
 * about a minute for sunrise and sunset, which is far better than the weather
 * forecast it will be used alongside. Every step is named so a wrong answer
 * can be traced to a line rather than to "the sun maths".
 *
 * Angles are degrees unless a name says otherwise. North and east are positive.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const sin = (deg) => Math.sin(deg * RAD);
const cos = (deg) => Math.cos(deg * RAD);

/** Days since J2000.0, the epoch every term below is measured from. */
export function julianDays(date) {
  return date.getTime() / 86400000 - 10957.5;
}

/**
 * The sun's declination and the equation of time, from the date alone.
 *
 * Declination is how far north or south of the equator the sun is standing —
 * it decides how long the day is and how obliquely the light arrives. The
 * equation of time is the gap between clock noon and the sun actually being
 * due south, which reaches a quarter of an hour in November.
 */
export function solarPosition(date) {
  const d = julianDays(date);

  const meanLongitude = (280.459 + 0.98564736 * d) % 360;
  const meanAnomaly = (357.529 + 0.98560028 * d) % 360;

  /* The orbit is an ellipse, so the sun runs ahead of and behind its mean. */
  const eclipticLongitude = meanLongitude
    + 1.915 * sin(meanAnomaly)
    + 0.020 * sin(2 * meanAnomaly);

  /* The axis is tilted, and the tilt is very slowly shrinking. */
  const obliquity = 23.439 - 0.00000036 * d;

  const declination = Math.asin(sin(obliquity) * sin(eclipticLongitude)) * DEG;
  const rightAscension = Math.atan2(cos(obliquity) * sin(eclipticLongitude), cos(eclipticLongitude)) * DEG;

  /* Minutes the sun is ahead of the clock. */
  let equationOfTime = (meanLongitude - rightAscension) * 4;
  if (equationOfTime > 20) equationOfTime -= 1440;
  if (equationOfTime < -20) equationOfTime += 1440;

  return { declination, equationOfTime, eclipticLongitude };
}

/*
 * The elevations that name the light.
 *
 * Sunrise is below zero because the sun is a disc, not a point, and the
 * atmosphere bends its image up over the horizon before it is really there.
 */
export const ELEVATIONS = {
  sunrise: -0.833,
  goldenHour: 6,      /* above this the light hardens */
  blueHourEnd: -4,    /* below this the colour has gone */
  civilTwilight: -6,
  astronomicalDark: -18,
};

/**
 * The two times of day the sun passes a given elevation.
 *
 * Returns null when it never does — above the Arctic circle in June the sun
 * does not set, and a number invented for that case would be a lie in the one
 * place a photographer most needs the truth.
 */
export function timesAtElevation({ date, latitude, longitude, elevation }) {
  const { declination, equationOfTime } = solarPosition(date);

  const cosHourAngle = (sin(elevation) - sin(latitude) * sin(declination))
    / (cos(latitude) * cos(declination));
  if (cosHourAngle > 1) return { rising: null, setting: null, why: 'the sun never rises this high today' };
  if (cosHourAngle < -1) return { rising: null, setting: null, why: 'the sun never drops this low today' };

  const hourAngle = Math.acos(cosHourAngle) * DEG;
  /* Solar noon in UTC hours, then the hour angle either side of it. */
  const noonUtc = 12 - longitude / 15 - equationOfTime / 60;
  const at = (hours) => {
    const t = new Date(date);
    t.setUTCHours(0, 0, 0, 0);
    return new Date(t.getTime() + hours * 3600000);
  };
  return {
    rising: at(noonUtc - hourAngle / 15),
    setting: at(noonUtc + hourAngle / 15),
    noon: at(noonUtc),
  };
}

/** The windows a photographer plans around, for one day in one place. */
export function lightWindows({ date, latitude, longitude }) {
  const at = (elevation) => timesAtElevation({ date, latitude, longitude, elevation });
  const horizon = at(ELEVATIONS.sunrise);
  const golden = at(ELEVATIONS.goldenHour);
  const blue = at(ELEVATIONS.blueHourEnd);

  return {
    sunrise: horizon.rising,
    sunset: horizon.setting,
    solarNoon: horizon.noon ?? null,
    /* Morning golden hour runs from the sun clearing the horizon until it is
     * six degrees up; the evening one runs the same span in reverse. */
    goldenMorning: horizon.rising && golden.rising ? { from: horizon.rising, to: golden.rising } : null,
    goldenEvening: golden.setting && horizon.setting ? { from: golden.setting, to: horizon.setting } : null,
    blueMorning: blue.rising && horizon.rising ? { from: blue.rising, to: horizon.rising } : null,
    blueEvening: horizon.setting && blue.setting ? { from: horizon.setting, to: blue.setting } : null,
    why: horizon.why ?? null,
  };
}

/** How long a window lasts, in minutes. */
export const windowMinutes = (window) =>
  (window ? (window.to.getTime() - window.from.getTime()) / 60000 : null);

/*
 * How bright it is, by how high the sun is.
 *
 * Empirical, like the blur windows in motion.mjs, and flagged the same way:
 * these are the readings photographers get, not a result derived from
 * atmospheric physics. The shape is what matters — light falls slowly while
 * the sun is up and then about a stop per degree once it touches the horizon,
 * which is why the twenty minutes after sunset need a different plan every
 * five minutes.
 */
const EV_BY_ELEVATION = [
  [60, 15.5], [40, 15], [20, 14], [10, 13], [6, 12.3], [3, 11.3], [0, 10],
  [-2, 8.5], [-4, 7], [-6, 5.5], [-10, 3], [-18, -2],
];

export function evAtElevation(elevationDeg) {
  const table = EV_BY_ELEVATION;
  if (elevationDeg >= table[0][0]) return table[0][1];
  if (elevationDeg <= table.at(-1)[0]) return table.at(-1)[1];
  for (let i = 1; i < table.length; i++) {
    const [highDeg, highEv] = table[i - 1];
    const [lowDeg, lowEv] = table[i];
    if (elevationDeg >= lowDeg) {
      const t = (elevationDeg - lowDeg) / (highDeg - lowDeg);
      return lowEv + t * (highEv - lowEv);
    }
  }
  return table.at(-1)[1];
}

/** Where the sun is right now, as an elevation above the horizon. */
export function elevationAt({ date, latitude, longitude }) {
  const { declination, equationOfTime } = solarPosition(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  /* Hour angle: how far past due south the sun is, fifteen degrees an hour. */
  const hourAngle = 15 * (utcHours + longitude / 15 + equationOfTime / 60 - 12);
  return Math.asin(
    sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hourAngle),
  ) * DEG;
}
