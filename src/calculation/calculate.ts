/**
 * Prayer times calculated from a position, in the shape of `client.mosques.prayerTimes()`.
 *
 * @module
 */

import {
  dateOf,
  dayIn,
  formatTime,
  formatTimeWithOffset,
  MINUTE,
  offsetAt,
  unixDay,
  weekday,
} from '../dates.ts';
import { fromGregorian, HijriMonth } from '../hijri.ts';
import { type DayParameters, dayTimes, roundedMinute } from './astronomy.ts';
import { CALCULATION_METHODS, type CalculationMethod } from './methods.ts';

/** A position on Earth, and its time zone. */
export interface CalculationPosition {
  /** The latitude, in degrees from -90 to 90. */
  latitude: number;
  /** The longitude, in degrees from -180 to 180. */
  longitude: number;
  /** The IANA time zone, like `Europe/Paris`. Every time of the result is in it. */
  timeZone: string;
}

/** The settings of a calculation. `defaultCalculationSettings()` gives those of a country. */
export interface CalculationSettings {
  /** The method: the angles of the sun at Fajr and Isha. */
  method: CalculationMethod;
  /**
   * The angle of the sun below the horizon at Fajr, in degrees, above 0 and up to 30. Required by
   * the `custom` method, and ignored by the others.
   */
  fajrAngle?: number | undefined;
  /** The angle at Isha, like `fajrAngle`. */
  ishaAngle?: number | undefined;
  /**
   * The school of Asr: Asr is when the shadow of an object is its shadow at noon plus once its
   * length for `shafi`, or twice for `hanafi`.
   */
  madhab: 'shafi' | 'hanafi';
  /**
   * The rule that bounds Fajr and Isha, every day, for the high latitudes where the sun does not
   * go as far below the horizon as the angles. Fajr is never earlier than sunrise minus a part of
   * the night, from sunset to sunrise, and Isha never later than sunset plus that part: half the
   * night for `middle_of_the_night`, a seventh for `seventh_of_the_night`, and the angle / 60 for
   * `twilight_angle`, like 18 / 60 for 18°.
   */
  highLatitudeRule: 'middle_of_the_night' | 'seventh_of_the_night' | 'twilight_angle';
  /** The minutes added to each time, as whole minutes from -720 to 720. None by default. */
  adjustments?:
    | Partial<Record<'fajr' | 'shuruq' | 'dhuhr' | 'asr' | 'maghrib' | 'isha', number | undefined>>
    | undefined;
}

/** The options of `calculatePrayerTimes()`. */
export interface CalculationOptions {
  /** The year, from 1000 to 9999. The current year in the time zone by default. */
  year?: number | undefined;
  /**
   * The days added to the date before computing the Hijri date, from -2 to 2, like in
   * `client.mosques.hijriSettings()`. It also says when Ramadan is, for the Isha of Umm al-Qura.
   * 0 by default.
   */
  hijriAdjustment?: number | undefined;
  /** Whether Jumu'a is prayed at the time of Dhuhr on Fridays. `false` by default: no Jumu'a. */
  jumuaAtDhuhr?: boolean | undefined;
  /**
   * The minutes between Imsak and Fajr, from 0 to 720, or `null` without Imsak, the default.
   */
  imsakMinutesBeforeFajr?: number | null | undefined;
}

/**
 * A year of calculated prayer times, in the shape of `client.mosques.prayerTimes()`:
 * `prayerDay()`, `nextPrayer()`, `night()`, and `today()` of `@mawaqit/sdk/hijri` read it like
 * the times of a mosque. It holds no position and no name.
 */
export interface CalculatedPrayerTimes {
  /** The IANA time zone of the position. Every time is in it. */
  readonly timezone: string;
  /**
   * The times of the year, one item per month from January to December. Each month maps its days,
   * from `"1"`, to the Fajr, Shuruq, Dhuhr, Asr, Maghrib and Isha times, as `HH:MM`.
   */
  readonly calendar: Record<string, string[]>[];
  /** Empty: a calculation has no iqama. */
  readonly iqamaCalendar: Record<string, string[]>[];
  readonly iqamaEnabled: false;
  /**
   * With `jumuaAtDhuhr`, the Dhuhr time of the next Friday, or of the first Friday of another year,
   * as `HH:MM`. `null` otherwise.
   */
  readonly jumua: string | null;
  readonly jumua2: null;
  readonly jumua3: null;
  /** `jumuaAtDhuhr`: whether Jumu'a is prayed at the time of Dhuhr on Fridays. */
  readonly jumuaAsDuhr: boolean;
  /** `imsakMinutesBeforeFajr`. */
  readonly imsakNbMinBeforeFajr: number | null;
  /** `hijriAdjustment`. */
  readonly hijriAdjustment: number;
  readonly hijriDateForceTo30: false;
}

const ADJUSTED = ['fajr', 'shuruq', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
// Dhuhr is a minute after the transit, once the whole disc of the sun has passed the meridian.
const DHUHR_MINUTES = 1;
const UMM_AL_QURA_RAMADAN_ISHA_MINUTES = 120;
const MAX_ANGLE = 30;
const MAX_MINUTES = 720;
const FRIDAY = 5;

/**
 * Calculate the prayer times of a year at a position. This calls no API: it works offline.
 *
 * The astronomy is the one of [adhan-js](https://github.com/batoulapps/adhan-js), after Jean
 * Meeus' *Astronomical Algorithms*:
 *
 * - Fajr and Isha are when the sun is at the angles of the method below the horizon, bounded by
 *   the high-latitude rule. Isha is 90 minutes after Maghrib for Umm al-Qura and Qatar, and 120
 *   minutes during Ramadan for Umm al-Qura, counted from Maghrib before its adjustment. Ramadan
 *   is the one of the Hijri dates of `hijri.fromGregorian()`, with `hijriAdjustment`.
 * - Dhuhr is one minute after the solar transit, for every method.
 * - Asr is when the shadow of an object reaches the length of the madhab.
 * - Shuruq and Maghrib are sunrise and sunset.
 * - The adjustments are added, then every time is rounded to the nearest minute, from 30 seconds
 *   up.
 * - When the sun does not rise or set, near the poles, the day is the one of the latitude clamped
 *   to ±65°, where it does.
 *
 * The times of a day are those of its solar noon in the time zone, through daylight saving time
 * changes. An Isha after midnight stays in the row of its day, like in the calendar of a mosque.
 *
 * ```ts
 * const times = calculatePrayerTimes(
 *   { latitude: 48.85, longitude: 2.35, timeZone: 'Europe/Paris' },
 *   defaultCalculationSettings('FR'),
 * );
 * prayerDay(times)?.fajr?.time; // '06:42' on 26 November
 * ```
 *
 * @param position - The position, and its time zone.
 * @param settings - The settings, like `defaultCalculationSettings('FR')`.
 * @param options - The year, and the fields of the result that the calculation does not set.
 * @returns The times of the year, in the shape of `client.mosques.prayerTimes()`.
 * @throws {RangeError} A field is invalid, like a latitude out of range, an unknown time zone or
 *   method, the custom method without its angles, or an adjustment that is not a whole number of
 *   minutes. The message names the field.
 */
export function calculatePrayerTimes(
  position: CalculationPosition,
  settings: CalculationSettings,
  options: CalculationOptions = {},
): CalculatedPrayerTimes {
  const { latitude, longitude, timeZone } = checkPosition(position);
  const { parameters, adjustments } = checkSettings(settings);
  const { hijriAdjustment = 0, jumuaAtDhuhr = false, imsakMinutesBeforeFajr = null } = options;
  checkInteger('options.hijriAdjustment', hijriAdjustment, -2, 2);
  check('options.jumuaAtDhuhr', jumuaAtDhuhr, typeof jumuaAtDhuhr === 'boolean', 'Use a boolean.');
  if (imsakMinutesBeforeFajr !== null) {
    checkInteger('options.imsakMinutesBeforeFajr', imsakMinutesBeforeFajr, 0, MAX_MINUTES);
  }
  let { year } = options;
  if (year === undefined) {
    year = dateOf(dayIn(Date.now(), timeZone)).year;
  }
  checkInteger('options.year', year, 1000, 9999);

  const ramadanParameters: DayParameters = {
    ...parameters,
    ishaInterval: UMM_AL_QURA_RAMADAN_ISHA_MINUTES,
  };
  const hijriSettings = { hijriAdjustment, hijriDateForceTo30: false };
  const row = (date: number): string[] => {
    const ramadan =
      settings.method === 'umm_al_qura' &&
      fromGregorian(dateOf(date), hijriSettings).month === HijriMonth.RAMADAN;
    const dayParameters = ramadan ? ramadanParameters : parameters;
    let times = dayTimes(date, latitude, longitude, dayParameters);
    // Near the date line, the noon of a day in its time zone is the noon of another day in UTC,
    // like in Kiribati.
    const shift = date - dayIn(times.transit, timeZone);
    if (shift !== 0) {
      times = dayTimes(date + shift, latitude, longitude, dayParameters);
    }
    const at = (instant: number, minutes: number): number =>
      roundedMinute(instant + minutes * MINUTE);
    const instants = [
      at(times.fajr, adjustments.fajr),
      at(times.sunrise, adjustments.shuruq),
      at(times.transit, DHUHR_MINUTES + adjustments.dhuhr),
      at(times.asr, adjustments.asr),
      at(times.sunset, adjustments.maghrib),
      at(times.isha, adjustments.isha),
    ];
    // Intl is most of the time of a calculation: one offset for the day, unless it changes.
    const offset = offsetAt(Math.min(...instants), timeZone);
    if (offset !== offsetAt(Math.max(...instants), timeZone)) {
      return instants.map((instant) => formatTime(instant, timeZone));
    }
    return instants.map((instant) => formatTimeWithOffset(instant, offset));
  };

  const first = unixDay({ year, month: 1, day: 1 });
  const end = unixDay({ year: year + 1, month: 1, day: 1 });
  const calendar = Array.from({ length: 12 }, (): Record<string, string[]> => ({}));
  for (let date = first; date < end; date++) {
    const { month, day } = dateOf(date);
    (calendar[month - 1] as Record<string, string[]>)[String(day)] = row(date);
  }

  let jumua: string | null = null;
  if (jumuaAtDhuhr) {
    const today = dayIn(Date.now(), timeZone);
    let friday = today >= first && today < end ? today : first;
    while (weekday(friday) !== FRIDAY) {
      friday++;
    }
    jumua = row(friday)[2] as string;
  }

  return {
    timezone: timeZone,
    calendar,
    iqamaCalendar: [],
    iqamaEnabled: false,
    jumua,
    jumua2: null,
    jumua3: null,
    jumuaAsDuhr: jumuaAtDhuhr,
    imsakNbMinBeforeFajr: imsakMinutesBeforeFajr,
    hijriAdjustment,
    hijriDateForceTo30: false,
  };
}

function checkPosition(position: CalculationPosition): CalculationPosition {
  const { latitude, longitude, timeZone } = position;
  checkNumber('position.latitude', latitude, -90, 90);
  checkNumber('position.longitude', longitude, -180, 180);
  check(
    'position.timeZone',
    timeZone,
    isTimeZone(timeZone),
    'Use an IANA time zone, like "Europe/Paris".',
  );
  return position;
}

function checkSettings(settings: CalculationSettings): {
  parameters: DayParameters;
  adjustments: Record<(typeof ADJUSTED)[number], number>;
} {
  const { method, madhab, highLatitudeRule } = settings;
  check(
    'settings.method',
    method,
    method === 'custom' || Object.hasOwn(CALCULATION_METHODS, method),
    'Use "custom" or a method of CALCULATION_METHODS.',
  );
  let fajrAngle: number;
  let ishaAngle: number;
  let ishaInterval = 0;
  if (method === 'custom') {
    fajrAngle = checkAngle('settings.fajrAngle', settings.fajrAngle);
    ishaAngle = checkAngle('settings.ishaAngle', settings.ishaAngle);
  } else {
    const angles = CALCULATION_METHODS[method];
    fajrAngle = angles.fajrAngle;
    ishaAngle = angles.ishaAngle ?? 0;
    ishaInterval = angles.ishaMinutesAfterMaghrib ?? 0;
  }
  check(
    'settings.madhab',
    madhab,
    madhab === 'shafi' || madhab === 'hanafi',
    'Use "shafi" or "hanafi".',
  );
  const portions = {
    middle_of_the_night: { fajr: 1 / 2, isha: 1 / 2 },
    seventh_of_the_night: { fajr: 1 / 7, isha: 1 / 7 },
    twilight_angle: { fajr: fajrAngle / 60, isha: ishaAngle / 60 },
  };
  check(
    'settings.highLatitudeRule',
    highLatitudeRule,
    Object.hasOwn(portions, highLatitudeRule),
    'Use "middle_of_the_night", "seventh_of_the_night" or "twilight_angle".',
  );

  const adjustments = { fajr: 0, shuruq: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  for (const [name, minutes] of Object.entries(settings.adjustments ?? {})) {
    const field = `settings.adjustments.${name}`;
    check(field, minutes, Object.hasOwn(adjustments, name), `Adjust ${ADJUSTED.join(', ')}.`);
    if (minutes !== undefined) {
      checkInteger(field, minutes, -MAX_MINUTES, MAX_MINUTES);
      adjustments[name as (typeof ADJUSTED)[number]] = minutes;
    }
  }

  return {
    parameters: {
      fajrAngle,
      ishaAngle,
      ishaInterval,
      shadowLength: madhab === 'hanafi' ? 2 : 1,
      nightPortions: portions[highLatitudeRule],
    },
    adjustments,
  };
}

function checkAngle(field: string, angle: number | undefined): number {
  check(
    field,
    angle,
    typeof angle === 'number' && angle > 0 && angle <= MAX_ANGLE,
    `The custom method needs an angle above 0 and up to ${MAX_ANGLE} degrees.`,
  );
  return angle as number;
}

function checkNumber(field: string, value: number, min: number, max: number): void {
  const isValid = typeof value === 'number' && value >= min && value <= max;
  check(field, value, isValid, `Use a number from ${min} to ${max}.`);
}

function checkInteger(field: string, value: number, min: number, max: number): void {
  const isValid = Number.isInteger(value) && value >= min && value <= max;
  check(field, value, isValid, `Use a whole number from ${min} to ${max}.`);
}

function check(field: string, value: unknown, isValid: boolean, help: string): void {
  if (!isValid) {
    const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
    throw new RangeError(`Invalid ${field}: ${shown}. ${help}`);
  }
}

function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
