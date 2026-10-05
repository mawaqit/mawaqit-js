/**
 * The Hijri date of a mosque, computed like the MAWAQIT apps and mosque screens.
 *
 * MAWAQIT computes the Hijri date on the device: the Kuwaiti algorithm, an arithmetic Islamic
 * calendar, on today's date shifted by the `hijriAdjustment` of the mosque, with the day replaced
 * by 30 when `hijriDateForceTo30` is set. The API only returns these two settings, with
 * `client.mosques.hijriSettings()`.
 *
 * ```ts
 * import { HijriMonth, today } from '@mawaqit/sdk/hijri';
 *
 * const settings = await client.mosques.hijriSettings(uuid);
 * const date = today(settings, 'Europe/Paris');
 * if (date.month === HijriMonth.RAMADAN) {
 *   // ...
 * }
 * ```
 *
 * Only today's date is reliable: mosques change their settings day by day, after the moon
 * sighting, so a date computed in advance can change.
 *
 * @module
 */

import { dayIn, type GregorianDay, unixDay } from './dates.ts';
import type { HijriSettings } from './types.ts';

export type { GregorianDay } from './dates.ts';

/** A month of the Hijri calendar, named like in the MAWAQIT apps. */
export const HijriMonth = {
  MUHARRAM: 1,
  SAFAR: 2,
  RABI_AL_AWWAL: 3,
  RABI_AL_THANI: 4,
  JUMADA_AL_ULA: 5,
  JUMADA_AL_AKHIRAH: 6,
  RAJAB: 7,
  SHABAN: 8,
  RAMADAN: 9,
  SHAWWAL: 10,
  DHU_AL_QIDAH: 11,
  DHU_AL_HIJJAH: 12,
} as const;

/** A month of the Hijri calendar, from 1 for Muharram to 12 for Dhu al-Hijjah. */
export type HijriMonth = (typeof HijriMonth)[keyof typeof HijriMonth];

const MONTH_NAMES = [
  'Muharram',
  'Safar',
  "Rabi' al-Awwal",
  "Rabi' al-Thani",
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qi'dah",
  'Dhu al-Hijjah',
] as const;

/** Return the English name of a Hijri month, like `Rabi' al-Awwal`. */
export function monthName(month: HijriMonth): string {
  return MONTH_NAMES[month - 1] as string;
}

/** A date of the Hijri calendar. */
export class HijriDate {
  /** The year, like 1448. */
  readonly year: number;
  /** The month, from 1 to 12: compare it with {@link HijriMonth}. */
  readonly month: HijriMonth;
  /** The day of the month, from 1 to 30. */
  readonly day: number;

  /** @throws {RangeError} The month or the day is out of range. */
  constructor(year: number, month: HijriMonth, day: number) {
    if (!Number.isInteger(year) || !isInRange(month, 12) || !isInRange(day, 30)) {
      throw new RangeError(`Invalid Hijri date: ${year}-${month}-${day}.`);
    }
    this.year = year;
    this.month = month;
    this.day = day;
  }

  /** The English name of the month, like `Rabi' al-Awwal`. */
  get monthName(): string {
    return monthName(this.month);
  }

  /** Return the date like `9 Ramadan 1448`. */
  toString(): string {
    return `${this.day} ${this.monthName} ${this.year}`;
  }

  /** Whether both dates are the same day. */
  equals(other: HijriDate): boolean {
    return HijriDate.compare(this, other) === 0;
  }

  /** Compare two dates, to sort them: negative when `a` comes first. */
  static compare(a: HijriDate, b: HijriDate): number {
    return a.year - b.year || a.month - b.month || a.day - b.day;
  }
}

/** The Hijri settings of a mosque, from `client.mosques.hijriSettings()`. */
export type HijriSettingsLike = Pick<HijriSettings, 'hijriAdjustment' | 'hijriDateForceTo30'>;

// 1 January 1970 is the day 719163 of the proleptic Gregorian calendar.
const ORDINAL_OF_UNIX_EPOCH = 719_163;
// Julian Day Number of the day 0, and of 16 July 622, the first day of the calendar.
const JULIAN_DAY_OF_ORDINAL_0 = 1_721_425;
const EPOCH = 1_948_084;
// A 30-year cycle lasts 10631 days.
const CYCLE_DAYS = 10_631;
const YEAR_DAYS = CYCLE_DAYS / 30;
const SHIFT = 8.01 / 60;

/**
 * Return the Hijri date of a Gregorian day with the Kuwaiti algorithm.
 *
 * This is the plain algorithm, without the settings of a mosque: prefer {@link fromGregorian}.
 *
 * @throws {RangeError} The day is not a valid date.
 */
export function kuwaiti(day: GregorianDay): HijriDate {
  return kuwaitiOfUnixDay(unixDay(day));
}

/**
 * Return the Hijri date of a mosque on a Gregorian day.
 *
 * Two cases differ from the MAWAQIT apps, which have bugs there:
 *
 * - The adjustment is added in calendar days, where the apps add 24 hours and are a day off for
 *   an hour around daylight saving time changes.
 * - When the day is forced to 30 on the first day of a month, the date is the 30th of the
 *   previous month, where the apps show the 30th of the new one.
 *
 * @param day - The Gregorian day.
 * @param settings - The Hijri settings of the mosque, from `client.mosques.hijriSettings()`.
 *   Without them, the plain Kuwaiti algorithm is used.
 * @returns The Hijri date shown by the mosque that day.
 * @throws {RangeError} The day is not a valid date.
 */
export function fromGregorian(day: GregorianDay, settings?: HijriSettingsLike): HijriDate {
  return fromUnixDay(unixDay(day), settings);
}

/**
 * Return today's Hijri date of a mosque.
 *
 * The date changes at midnight in the time zone of the mosque, like on its screens, and not at
 * Maghrib.
 *
 * @param settings - The Hijri settings of the mosque, from `client.mosques.hijriSettings()`.
 * @param timeZone - The IANA time zone of the mosque, like `"Europe/Paris"`: the `timezone` of
 *   `client.mosques.prayerTimes()`.
 * @returns Today's Hijri date of the mosque.
 * @throws {RangeError} The time zone is unknown.
 */
export function today(settings: HijriSettingsLike, timeZone: string): HijriDate {
  return fromUnixDay(dayIn(Date.now(), timeZone), settings);
}

function fromUnixDay(day: number, settings: HijriSettingsLike | undefined): HijriDate {
  if (!settings) {
    return kuwaitiOfUnixDay(day);
  }
  const hijri = kuwaitiOfUnixDay(day + settings.hijriAdjustment);
  if (!settings.hijriDateForceTo30) {
    return hijri;
  }
  if (hijri.day !== 1) {
    return new HijriDate(hijri.year, hijri.month, 30);
  }
  if (hijri.month === HijriMonth.MUHARRAM) {
    return new HijriDate(hijri.year - 1, HijriMonth.DHU_AL_HIJJAH, 30);
  }
  return new HijriDate(hijri.year, (hijri.month - 1) as HijriMonth, 30);
}

function kuwaitiOfUnixDay(unixDay: number): HijriDate {
  let days = unixDay + ORDINAL_OF_UNIX_EPOCH + JULIAN_DAY_OF_ORDINAL_0 - EPOCH;
  const cycle = Math.floor(days / CYCLE_DAYS);
  days -= cycle * CYCLE_DAYS;
  const year = Math.floor((days - SHIFT) / YEAR_DAYS);
  days -= Math.floor(year * YEAR_DAYS + SHIFT);
  const month = Math.min(Math.floor((days + 28.5001) / 29.5), 12) as HijriMonth;
  return new HijriDate(30 * cycle + year, month, days - Math.floor(29.5001 * month - 29));
}

function isInRange(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}
