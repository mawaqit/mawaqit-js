/*
 * The position of the sun and the times of a day, ported from adhan-js 4.4.6
 * (https://github.com/batoulapps/adhan-js), after Jean Meeus' Astronomical Algorithms. Internal to
 * the package. The equations keep the order of operations of adhan-js, so the times are the same to
 * the second.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 Batoul Apps
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { dateOf } from '../dates.ts';

/** What sets the times of a day, besides the position. */
export interface DayParameters {
  /** The angle of the sun below the horizon at Fajr, in degrees. */
  readonly fajrAngle: number;
  /** The angle at Isha, in degrees, when `ishaInterval` is 0. */
  readonly ishaAngle: number;
  /** The minutes from sunset to Isha, or 0 for an angle. */
  readonly ishaInterval: number;
  /** The shadow of an object at Asr, in lengths of the object: 1 or 2. */
  readonly shadowLength: number;
  /** The parts of the night that bound Fajr before sunrise and Isha after sunset. */
  readonly nightPortions: { readonly fajr: number; readonly isha: number };
}

/** The instants of a day, in milliseconds, before the adjustments and the rounding. */
export interface DayTimes {
  readonly fajr: number;
  readonly sunrise: number;
  /** The solar transit, Dhuhr before its minute. */
  readonly transit: number;
  readonly asr: number;
  readonly sunset: number;
  readonly isha: number;
}

// Where the sun rises and sets every day of the year.
const POLAR_LATITUDE = 65;

/**
 * Return the instants of a day, like `new PrayerTimes()` of adhan-js without its method
 * adjustments, rounding and method-specific rules.
 *
 * When the sun does not rise or set, the day is the one of the latitude clamped to ±65°.
 */
export function dayTimes(
  unixDay: number,
  latitude: number,
  longitude: number,
  parameters: DayParameters,
): DayTimes {
  const today = dateOf(unixDay);
  const tomorrow = dateOf(unixDay + 1);
  let solarTime = new SolarTime(today, latitude, longitude);
  let tomorrowSolarTime = new SolarTime(tomorrow, latitude, longitude);
  if (
    Number.isNaN(solarTime.sunrise) ||
    Number.isNaN(solarTime.sunset) ||
    Number.isNaN(tomorrowSolarTime.sunrise)
  ) {
    const clamped = Math.max(-POLAR_LATITUDE, Math.min(POLAR_LATITUDE, latitude));
    solarTime = new SolarTime(today, clamped, longitude);
    tomorrowSolarTime = new SolarTime(tomorrow, clamped, longitude);
  }

  const transit = utcInstant(solarTime.transit, today);
  const sunrise = utcInstant(solarTime.sunrise, today);
  const sunset = utcInstant(solarTime.sunset, today);
  const asr = utcInstant(solarTime.afternoon(parameters.shadowLength), today);
  const tomorrowSunrise = utcInstant(tomorrowSolarTime.sunrise, tomorrow);
  const night = (tomorrowSunrise - sunset) / 1000;

  let fajr = utcInstant(solarTime.hourAngle(-1 * parameters.fajrAngle, false), today);
  const safeFajr = addSeconds(sunrise, -(parameters.nightPortions.fajr * night));
  if (Number.isNaN(fajr) || safeFajr > fajr) {
    fajr = safeFajr;
  }

  let isha: number;
  if (parameters.ishaInterval > 0) {
    isha = addSeconds(sunset, parameters.ishaInterval * 60);
  } else {
    isha = utcInstant(solarTime.hourAngle(-1 * parameters.ishaAngle, true), today);
    const safeIsha = addSeconds(sunset, parameters.nightPortions.isha * night);
    if (Number.isNaN(isha) || safeIsha < isha) {
      isha = safeIsha;
    }
  }
  return { fajr, sunrise, transit, asr, sunset, isha };
}

/** Round an instant to the nearest minute, from 30 seconds up, like adhan-js. */
export function roundedMinute(instant: number): number {
  const date = new Date(instant);
  const seconds = date.getUTCSeconds();
  const offset = seconds >= 30 ? 60 - seconds : -1 * seconds;
  return addSeconds(date.getTime(), offset);
}

// Like a JavaScript `Date`: whole milliseconds.
function addSeconds(instant: number, seconds: number): number {
  return new Date(instant + seconds * 1000).getTime();
}

interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The instant of a time in hours of a day, in UTC, truncated to the second. */
function utcInstant(num: number, { year, month, day }: CalendarDay): number {
  const hours = Math.floor(num);
  const minutes = Math.floor((num - hours) * 60);
  const seconds = Math.floor((num - (hours + minutes / 60)) * 60 * 60);
  return Date.UTC(year, month - 1, day, hours, minutes, seconds);
}

/** The transit, sunrise and sunset of a day, in hours of the day in UTC. */
class SolarTime {
  readonly transit: number;
  readonly sunrise: number;
  readonly sunset: number;
  private readonly latitude: number;
  private readonly longitude: number;
  private readonly solar: SolarCoordinates;
  private readonly prevSolar: SolarCoordinates;
  private readonly nextSolar: SolarCoordinates;
  private readonly approxTransit: number;

  constructor({ year, month, day }: CalendarDay, latitude: number, longitude: number) {
    const jd = julianDay(year, month, day);
    this.latitude = latitude;
    this.longitude = longitude;
    this.solar = solarCoordinates(jd);
    this.prevSolar = solarCoordinates(jd - 1);
    this.nextSolar = solarCoordinates(jd + 1);
    const m0 = approximateTransit(
      longitude,
      this.solar.apparentSiderealTime,
      this.solar.rightAscension,
    );
    const solarAltitude = -50.0 / 60.0;
    this.approxTransit = m0;
    this.transit = correctedTransit(
      m0,
      longitude,
      this.solar.apparentSiderealTime,
      this.solar.rightAscension,
      this.prevSolar.rightAscension,
      this.nextSolar.rightAscension,
    );
    this.sunrise = this.hourAngle(solarAltitude, false);
    this.sunset = this.hourAngle(solarAltitude, true);
  }

  hourAngle(angle: number, afterTransit: boolean): number {
    return correctedHourAngle(
      this.approxTransit,
      angle,
      this.latitude,
      this.longitude,
      afterTransit,
      this.solar,
      this.prevSolar,
      this.nextSolar,
    );
  }

  afternoon(shadowLength: number): number {
    const tangent = Math.abs(this.latitude - this.solar.declination);
    const inverse = shadowLength + Math.tan(degreesToRadians(tangent));
    const angle = radiansToDegrees(Math.atan(1.0 / inverse));
    return this.hourAngle(angle, true);
  }
}

interface SolarCoordinates {
  /** The angle between the rays of the sun and the plane of the equator, in degrees. */
  readonly declination: number;
  /** In degrees. */
  readonly rightAscension: number;
  /** The hour angle of the vernal equinox, in degrees. */
  readonly apparentSiderealTime: number;
}

function solarCoordinates(julianDay: number): SolarCoordinates {
  const T = julianCentury(julianDay);
  const L0 = meanSolarLongitude(T);
  const Lp = meanLunarLongitude(T);
  const Omega = ascendingLunarNodeLongitude(T);
  const Lambda = degreesToRadians(apparentSolarLongitude(T, L0));
  const Theta0 = meanSiderealTime(T);
  const dPsi = nutationInLongitude(L0, Lp, Omega);
  const dEpsilon = nutationInObliquity(L0, Lp, Omega);
  const Epsilon0 = meanObliquityOfTheEcliptic(T);
  const EpsilonApparent = degreesToRadians(apparentObliquityOfTheEcliptic(T, Epsilon0));
  return {
    // Astronomical Algorithms, pages 165 and 88.
    declination: radiansToDegrees(Math.asin(Math.sin(EpsilonApparent) * Math.sin(Lambda))),
    rightAscension: unwindAngle(
      radiansToDegrees(Math.atan2(Math.cos(EpsilonApparent) * Math.sin(Lambda), Math.cos(Lambda))),
    ),
    apparentSiderealTime:
      Theta0 + (dPsi * 3600 * Math.cos(degreesToRadians(Epsilon0 + dEpsilon))) / 3600,
  };
}

// The page numbers are those of Astronomical Algorithms.

function meanSolarLongitude(T: number): number {
  // Page 163.
  const term1 = 280.4664567;
  const term2 = 36000.76983 * T;
  const term3 = 0.0003032 * T ** 2;
  return unwindAngle(term1 + term2 + term3);
}

function meanLunarLongitude(T: number): number {
  // Page 144.
  const term1 = 218.3165;
  const term2 = 481267.8813 * T;
  return unwindAngle(term1 + term2);
}

function ascendingLunarNodeLongitude(T: number): number {
  // Page 144.
  const term1 = 125.04452;
  const term2 = 1934.136261 * T;
  const term3 = 0.0020708 * T ** 2;
  const term4 = T ** 3 / 450000;
  return unwindAngle(term1 - term2 + term3 + term4);
}

function meanSolarAnomaly(T: number): number {
  // Page 163.
  const term1 = 357.52911;
  const term2 = 35999.05029 * T;
  const term3 = 0.0001537 * T ** 2;
  return unwindAngle(term1 + term2 - term3);
}

function solarEquationOfTheCenter(T: number, meanAnomaly: number): number {
  // Page 164.
  const Mrad = degreesToRadians(meanAnomaly);
  const term1 = (1.914602 - 0.004817 * T - 0.000014 * T ** 2) * Math.sin(Mrad);
  const term2 = (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad);
  const term3 = 0.000289 * Math.sin(3 * Mrad);
  return term1 + term2 + term3;
}

function apparentSolarLongitude(T: number, meanLongitude: number): number {
  // Page 164.
  const longitude = meanLongitude + solarEquationOfTheCenter(T, meanSolarAnomaly(T));
  const Omega = 125.04 - 1934.136 * T;
  const Lambda = longitude - 0.00569 - 0.00478 * Math.sin(degreesToRadians(Omega));
  return unwindAngle(Lambda);
}

function meanObliquityOfTheEcliptic(T: number): number {
  // Page 147.
  const term1 = 23.439291;
  const term2 = 0.013004167 * T;
  const term3 = 0.0000001639 * T ** 2;
  const term4 = 0.0000005036 * T ** 3;
  return term1 - term2 - term3 + term4;
}

function apparentObliquityOfTheEcliptic(T: number, meanObliquity: number): number {
  // Page 165.
  const O = 125.04 - 1934.136 * T;
  return meanObliquity + 0.00256 * Math.cos(degreesToRadians(O));
}

function meanSiderealTime(T: number): number {
  // Page 165.
  const JD = T * 36525 + 2451545.0;
  const term1 = 280.46061837;
  const term2 = 360.98564736629 * (JD - 2451545);
  const term3 = 0.000387933 * T ** 2;
  const term4 = T ** 3 / 38710000;
  return unwindAngle(term1 + term2 + term3 - term4);
}

function nutationInLongitude(L0: number, Lp: number, Omega: number): number {
  // Page 144.
  const term1 = (-17.2 / 3600) * Math.sin(degreesToRadians(Omega));
  const term2 = (1.32 / 3600) * Math.sin(2 * degreesToRadians(L0));
  const term3 = (0.23 / 3600) * Math.sin(2 * degreesToRadians(Lp));
  const term4 = (0.21 / 3600) * Math.sin(2 * degreesToRadians(Omega));
  return term1 - term2 - term3 + term4;
}

function nutationInObliquity(L0: number, Lp: number, Omega: number): number {
  // Page 144.
  const term1 = (9.2 / 3600) * Math.cos(degreesToRadians(Omega));
  const term2 = (0.57 / 3600) * Math.cos(2 * degreesToRadians(L0));
  const term3 = (0.1 / 3600) * Math.cos(2 * degreesToRadians(Lp));
  const term4 = (0.09 / 3600) * Math.cos(2 * degreesToRadians(Omega));
  return term1 + term2 + term3 - term4;
}

function altitudeOfCelestialBody(
  observerLatitude: number,
  declination: number,
  localHourAngle: number,
): number {
  // Page 93.
  const term1 =
    Math.sin(degreesToRadians(observerLatitude)) * Math.sin(degreesToRadians(declination));
  const term2 =
    Math.cos(degreesToRadians(observerLatitude)) *
    Math.cos(degreesToRadians(declination)) *
    Math.cos(degreesToRadians(localHourAngle));
  return radiansToDegrees(Math.asin(term1 + term2));
}

function approximateTransit(
  longitude: number,
  siderealTime: number,
  rightAscension: number,
): number {
  // Page 102.
  const Lw = longitude * -1;
  const m0 = normalizeToScale((rightAscension + Lw - siderealTime) / 360, 1);
  // Near the date line, m0 can be a day off: half a day away from the transit expected at this
  // longitude.
  const expectedTransit = normalizeToScale((12.0 - longitude / 15.0) / 24.0, 1);
  if (m0 - expectedTransit > 0.5) {
    return m0 - 1.0;
  }
  if (expectedTransit - m0 > 0.5) {
    return m0 + 1.0;
  }
  return m0;
}

/** The time at which the sun is at its highest point in the sky, in hours in UTC. */
function correctedTransit(
  m0: number,
  longitude: number,
  siderealTime: number,
  rightAscension: number,
  previousRightAscension: number,
  nextRightAscension: number,
): number {
  // Page 102.
  const Lw = longitude * -1;
  const Theta = unwindAngle(siderealTime + 360.985647 * m0);
  const a = unwindAngle(
    interpolateAngles(rightAscension, previousRightAscension, nextRightAscension, m0),
  );
  const H = quadrantShiftAngle(Theta - Lw - a);
  const dm = H / -360;
  return (m0 + dm) * 24;
}

function correctedHourAngle(
  m0: number,
  h0: number,
  latitude: number,
  longitude: number,
  afterTransit: boolean,
  solar: SolarCoordinates,
  prevSolar: SolarCoordinates,
  nextSolar: SolarCoordinates,
): number {
  // Page 102.
  const Lw = longitude * -1;
  const term1 =
    Math.sin(degreesToRadians(h0)) -
    Math.sin(degreesToRadians(latitude)) * Math.sin(degreesToRadians(solar.declination));
  const term2 =
    Math.cos(degreesToRadians(latitude)) * Math.cos(degreesToRadians(solar.declination));
  const H0 = radiansToDegrees(Math.acos(term1 / term2));
  const m = afterTransit ? m0 + H0 / 360 : m0 - H0 / 360;
  const Theta = unwindAngle(solar.apparentSiderealTime + 360.985647 * m);
  const a = unwindAngle(
    interpolateAngles(solar.rightAscension, prevSolar.rightAscension, nextSolar.rightAscension, m),
  );
  const delta = interpolate(solar.declination, prevSolar.declination, nextSolar.declination, m);
  const H = Theta - Lw - a;
  const h = altitudeOfCelestialBody(latitude, delta, H);
  const term3 = h - h0;
  const term4 =
    360 *
    Math.cos(degreesToRadians(delta)) *
    Math.cos(degreesToRadians(latitude)) *
    Math.sin(degreesToRadians(H));
  const dm = term3 / term4;
  return (m + dm) * 24;
}

/** Interpolate a value from the ones of the days before and after, at `n` of a day. Page 24. */
function interpolate(y2: number, y1: number, y3: number, n: number): number {
  const a = y2 - y1;
  const b = y3 - y2;
  const c = b - a;
  return y2 + (n / 2) * (a + b + n * c);
}

/** Like {@link interpolate}, for angles. */
function interpolateAngles(y2: number, y1: number, y3: number, n: number): number {
  const a = unwindAngle(y2 - y1);
  const b = unwindAngle(y3 - y2);
  const c = b - a;
  return y2 + (n / 2) * (a + b + n * c);
}

function julianDay(year: number, month: number, day: number): number {
  // Page 60.
  const Y = Math.trunc(month > 2 ? year : year - 1);
  const M = Math.trunc(month > 2 ? month : month + 12);
  const A = Math.trunc(Y / 100);
  const B = Math.trunc(2 - A + Math.trunc(A / 4));
  const i0 = Math.trunc(365.25 * (Y + 4716));
  const i1 = Math.trunc(30.6001 * (M + 1));
  return i0 + i1 + day + B - 1524.5;
}

function julianCentury(julianDay: number): number {
  // Page 163.
  return (julianDay - 2451545.0) / 36525;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180.0;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180.0) / Math.PI;
}

function normalizeToScale(num: number, max: number): number {
  return num - max * Math.floor(num / max);
}

function unwindAngle(angle: number): number {
  return normalizeToScale(angle, 360.0);
}

function quadrantShiftAngle(angle: number): number {
  if (angle >= -180 && angle <= 180) {
    return angle;
  }
  return angle - 360 * Math.round(angle / 360);
}
