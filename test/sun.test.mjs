/*
 * The sun, checked against times anyone can look up.
 *
 * This is the one calculation in the project with published right answers, so
 * it is checked against them rather than against itself. A solar calculation
 * that is subtly wrong still returns plausible times, which is exactly the
 * failure a test suite has to catch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  solarPosition, lightWindows, timesAtElevation, elevationAt, evAtElevation,
  windowMinutes, ELEVATIONS,
} from '../src/photo/sun.mjs';

const utc = (iso) => new Date(iso);
const hhmm = (date) => date.toISOString().slice(11, 16);

test('the solstices and the equinox land where they have to', () => {
  assert.ok(Math.abs(solarPosition(utc('2026-06-21T12:00:00Z')).declination - 23.44) < 0.1,
    'the sun is 23.44 degrees north at the June solstice, by definition of the tilt');
  assert.ok(Math.abs(solarPosition(utc('2026-12-21T12:00:00Z')).declination + 23.44) < 0.1);
  assert.ok(Math.abs(solarPosition(utc('2026-03-20T12:00:00Z')).declination) < 0.5,
    'and crosses the equator at the equinox');
});

test('the equation of time peaks where the analemma says', () => {
  /* Early November is the sun's biggest lead over the clock, about 16 minutes. */
  assert.ok(Math.abs(solarPosition(utc('2026-11-03T12:00:00Z')).equationOfTime - 16.4) < 0.6);
  /* Mid February is its biggest lag, about 14 minutes. */
  assert.ok(Math.abs(solarPosition(utc('2026-02-11T12:00:00Z')).equationOfTime + 14.2) < 0.8);
});

test('London on both solstices, against published times', () => {
  const london = { latitude: 51.5, longitude: -0.13 };
  const june = lightWindows({ date: utc('2026-06-21T12:00:00Z'), ...london });
  assert.equal(hhmm(june.sunrise), '03:43', 'sunrise 04:43 BST');
  assert.equal(hhmm(june.sunset), '20:21', 'sunset 21:21 BST');

  const december = lightWindows({ date: utc('2026-12-21T12:00:00Z'), ...london });
  assert.equal(hhmm(december.sunrise), '08:03');
  assert.equal(hhmm(december.sunset), '15:53');
});

test('golden hour lasts longer in winter, and barely happens at the equator', () => {
  /* The sun climbs more obliquely in winter, so it spends longer low down. */
  const london = { latitude: 51.5, longitude: -0.13 };
  const june = windowMinutes(lightWindows({ date: utc('2026-06-21T12:00:00Z'), ...london }).goldenEvening);
  const december = windowMinutes(lightWindows({ date: utc('2026-12-21T12:00:00Z'), ...london }).goldenEvening);
  assert.ok(december > june, `${Math.round(december)} min in December beats ${Math.round(june)} in June`);

  const quito = windowMinutes(lightWindows({
    date: utc('2026-03-20T12:00:00Z'), latitude: -0.18, longitude: -78.47,
  }).goldenEvening);
  assert.ok(quito < 30, `the sun drops straight down at the equator (${Math.round(quito)} min)`);
});

test('the midnight sun is reported as such, not as a time', () => {
  /*
   * Inventing a sunset for Tromso in June would be a lie in the one place a
   * photographer most needs the truth about it.
   */
  const tromso = lightWindows({ date: utc('2026-06-21T12:00:00Z'), latitude: 69.65, longitude: 18.96 });
  assert.equal(tromso.sunset, null);
  assert.match(tromso.why, /never drops this low/);

  const polarNight = timesAtElevation({
    date: utc('2026-12-21T12:00:00Z'), latitude: 78.2, longitude: 15.6, elevation: ELEVATIONS.sunrise,
  });
  assert.equal(polarNight.rising, null);
  assert.match(polarNight.why, /never rises this high/);
});

test('noon elevation is what the latitude and the season say it must be', () => {
  /* At the equinox the noon sun stands at 90 minus your latitude. */
  const elevation = elevationAt({ date: utc('2026-03-20T12:07:00Z'), latitude: 51.5, longitude: 0 });
  assert.ok(Math.abs(elevation - (90 - 51.5)) < 0.6, `got ${elevation.toFixed(1)}`);
});

test('light falls about a stop every ten minutes through sunset', () => {
  const place = { latitude: 43.9, longitude: -72.7 };
  const { sunset } = lightWindows({ date: utc('2026-09-27T12:00:00Z'), ...place });
  const evAt = (mins) => evAtElevation(elevationAt({
    date: new Date(sunset.getTime() + mins * 60000), ...place,
  }));
  const drop = evAt(0) - evAt(10);
  assert.ok(drop > 0.8 && drop < 2, `a stop and a bit in ten minutes, got ${drop.toFixed(2)}`);
  assert.ok(evAt(-60) > evAt(0), 'and it was brighter an hour before');
});
