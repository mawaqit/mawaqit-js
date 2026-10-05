/**
 * The prayer times of a day, the next prayer and the night, from `client.mosques.prayerTimes()`.
 *
 * The API returns the times of the whole year as `HH:MM` strings in the time zone of the mosque,
 * with iqama times either as `HH:MM` or as minutes after the adhan, like `+10`. These functions
 * read them for a given day, with the instant of each prayer, the iqama resolved, Imsak, and Jumu'a
 * on Fridays.
 *
 * ```ts
 * import { nextPrayer, prayerDay } from '@mawaqit/sdk/prayer-times';
 *
 * const prayerTimes = await client.mosques.prayerTimes(uuid);
 * const today = prayerDay(prayerTimes);
 * console.log(today?.fajr?.time, today?.fajr?.iqama?.time); // 06:12 06:30
 *
 * const next = nextPrayer(prayerTimes);
 * console.log(next?.name, next?.at); // asr 2026-10-05T14:46:00.000Z
 * ```
 *
 * Times entered by hand by the mosque can be invalid: such a prayer is `null`, rather than wrong.
 *
 * @module
 */

import {
  dateOf,
  dayIn,
  formatTime,
  type GregorianDay,
  isoDate,
  MINUTE,
  parseTime,
  unixDay,
  weekday,
  zonedInstant,
} from './dates.ts';
import type { PrayerTimes } from './types.ts';

export type { GregorianDay } from './dates.ts';

/** The name of a prayer, or of Shuruq and Imsak. */
export type PrayerName =
  | 'imsak'
  | 'fajr'
  | 'shuruq'
  | 'dhuhr'
  | 'asr'
  | 'maghrib'
  | 'isha'
  | 'jumua';

/** A time of a prayer: as shown by the mosque, and as an instant. */
export interface PrayerTime {
  /** The time, as `HH:MM` in the time zone of the mosque. */
  readonly time: string;
  /** The instant. */
  readonly at: Date;
}

/** A prayer of a day. */
export interface Prayer extends PrayerTime {
  readonly name: PrayerName;
  /**
   * The iqama, or `null` without one: for Imsak, Shuruq and Jumu'a, and when the mosque publishes
   * no iqama times or an invalid one.
   */
  readonly iqama: PrayerTime | null;
}

/** The prayers of a day. A prayer is `null` when the mosque has no valid time for it. */
export interface PrayerDay {
  /** The day, as an ISO date like `2026-10-05`. */
  readonly date: string;
  /**
   * Imsak: from the calendar of the mosques that display it, or `imsakNbMinBeforeFajr` minutes
   * before Fajr. `null` for the other mosques.
   */
  readonly imsak: Prayer | null;
  /** Fajr, or Sabah for the mosques that display Imsak. */
  readonly fajr: Prayer | null;
  readonly shuruq: Prayer | null;
  readonly dhuhr: Prayer | null;
  readonly asr: Prayer | null;
  readonly maghrib: Prayer | null;
  readonly isha: Prayer | null;
  /** On Fridays, the Jumu'a prayers in order. Empty the other days. */
  readonly jumua: readonly Prayer[];
}

/** The fields of `client.mosques.prayerTimes()` these functions read. */
export type PrayerTimesLike = Pick<
  PrayerTimes,
  | 'timezone'
  | 'calendar'
  | 'iqamaCalendar'
  | 'iqamaEnabled'
  | 'jumua'
  | 'jumua2'
  | 'jumua3'
  | 'jumuaAsDuhr'
  | 'imsakNbMinBeforeFajr'
>;

/** The options of {@link nextPrayer}. */
export interface NextPrayerOptions {
  /** The instant to search from. Now by default. */
  now?: Date | undefined;
  /** Whether Shuruq counts as a prayer. `false` by default. */
  shuruq?: boolean | undefined;
  /** Whether Jumu'a replaces Dhuhr on Fridays, when the mosque has one. `true` by default. */
  jumua?: boolean | undefined;
  /**
   * Whether to search the next iqama rather than the next adhan: between the adhan and the iqama,
   * the prayer is still the next one. `false` by default.
   */
  iqama?: boolean | undefined;
}

/** The night between Maghrib and the next Fajr, as the Sunnah divides it. */
export interface Night {
  /** Maghrib. */
  readonly start: Date;
  readonly firstThirdEnd: Date;
  readonly middle: Date;
  readonly lastThirdStart: Date;
  /** Fajr of the next day. */
  readonly end: Date;
}

// The order of the prayers in the calendar, after Imsak for the mosques that display it.
const CALENDAR = ['fajr', 'shuruq', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
const IQAMA = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
const FRIDAY = 5;
// An iqama later than this after its adhan is an error of the mosque.
const MAX_IQAMA_DELAY = 12 * 60 * MINUTE;

/**
 * Return the prayers of a day.
 *
 * @param prayerTimes - The prayer times of the mosque, from `client.mosques.prayerTimes()`.
 * @param day - The day. Today in the time zone of the mosque by default.
 * @returns The prayers of the day, or `null` when the calendar of the mosque has no valid row for
 *   it.
 * @throws {RangeError} The day is not a valid date, or the time zone of the mosque is unknown.
 */
export function prayerDay(prayerTimes: PrayerTimesLike, day?: GregorianDay): PrayerDay | null {
  const date = day === undefined ? dayIn(Date.now(), prayerTimes.timezone) : unixDay(day);
  return dayOf(prayerTimes, date);
}

/**
 * Return the next prayer: Fajr, Dhuhr, Asr, Maghrib or Isha, or Jumu'a on Fridays.
 *
 * After Isha, this is the Fajr of the next day. An Isha after midnight, in summer far from the
 * equator, is still the next prayer until its time.
 *
 * @param prayerTimes - The prayer times of the mosque, from `client.mosques.prayerTimes()`.
 * @returns The next prayer, or `null` when the calendar of the mosque has no valid time around
 *   `now`.
 * @throws {RangeError} The time zone of the mosque is unknown.
 */
export function nextPrayer(
  prayerTimes: PrayerTimesLike,
  options: NextPrayerOptions = {},
): Prayer | null {
  const now = (options.now ?? new Date()).getTime();
  const today = dayIn(now, prayerTimes.timezone);
  let next: { prayer: Prayer; at: number } | null = null;
  // Yesterday for an Isha after midnight.
  for (const date of [today - 1, today, today + 1, today + 2]) {
    const day = dayOf(prayerTimes, date);
    if (!day) {
      continue;
    }
    const jumua = options.jumua !== false && day.jumua.length > 0;
    const prayers = [
      day.fajr,
      options.shuruq ? day.shuruq : null,
      jumua ? null : day.dhuhr,
      ...(jumua ? day.jumua : []),
      day.asr,
      day.maghrib,
      day.isha,
    ];
    for (const prayer of prayers) {
      if (!prayer) {
        continue;
      }
      const at = (options.iqama ? (prayer.iqama ?? prayer) : prayer).at.getTime();
      if (at > now && (!next || at < next.at)) {
        next = { prayer, at };
      }
    }
  }
  return next?.prayer ?? null;
}

/**
 * Return the night that starts at the Maghrib of a day, and its thirds.
 *
 * @param prayerTimes - The prayer times of the mosque, from `client.mosques.prayerTimes()`.
 * @param day - The day of the Maghrib. Today in the time zone of the mosque by default.
 * @returns The night, or `null` without a valid Maghrib that day and Fajr the next day.
 * @throws {RangeError} The day is not a valid date, or the time zone of the mosque is unknown.
 */
export function night(prayerTimes: PrayerTimesLike, day?: GregorianDay): Night | null {
  const date = day === undefined ? dayIn(Date.now(), prayerTimes.timezone) : unixDay(day);
  const start = dayOf(prayerTimes, date)?.maghrib?.at.getTime();
  const end = dayOf(prayerTimes, date + 1)?.fajr?.at.getTime();
  if (start === undefined || end === undefined || end <= start) {
    return null;
  }
  // In instants: in wall-clock times, a change of daylight saving time would shift them.
  const at = (fraction: number): Date => new Date(start + (end - start) * fraction);
  return {
    start: new Date(start),
    firstThirdEnd: at(1 / 3),
    middle: at(1 / 2),
    lastThirdStart: at(2 / 3),
    end: new Date(end),
  };
}

function dayOf(prayerTimes: PrayerTimesLike, date: number): PrayerDay | null {
  const { month, day } = dateOf(date);
  const row = prayerTimes.calendar[month - 1]?.[String(day)];
  if (row?.length !== 6 && row?.length !== 7) {
    return null;
  }
  const timeZone = prayerTimes.timezone;
  const prayer = (
    name: PrayerName,
    time: string | null | undefined,
    iqama?: string,
    after?: Prayer | null,
  ): Prayer | null => {
    const minutes = parseTime(time);
    if (minutes === null) {
      return null;
    }
    // A time earlier than the prayer before it is after midnight, like Isha far from the equator.
    let on = date;
    let at = zonedInstant(on, minutes, timeZone);
    if (after && at < after.at.getTime()) {
      on += 1;
      at = zonedInstant(on, minutes, timeZone);
    }
    const adhan = instant(at, timeZone);
    return { name, ...adhan, iqama: iqama ? resolveIqama(adhan, iqama, on, timeZone) : null };
  };

  // Mosques that display Imsak have it first, then Sabah as Fajr.
  const [imsakTime, ...times] = row.length === 7 ? row : [undefined, ...row];
  const iqamaRow = prayerTimes.iqamaEnabled
    ? prayerTimes.iqamaCalendar[month - 1]?.[String(day)]
    : undefined;
  const iqamas = iqamaRow?.length === IQAMA.length ? iqamaRow : [];
  const prayers = {} as Record<(typeof CALENDAR)[number], Prayer | null>;
  let last: Prayer | null = null;
  for (const [i, name] of CALENDAR.entries()) {
    const iqama = name === 'shuruq' ? undefined : iqamas[i === 0 ? 0 : i - 1];
    prayers[name] = prayer(name, times[i], iqama, last);
    last = prayers[name] ?? last;
  }
  const { fajr, dhuhr } = prayers;

  let imsak = prayer('imsak', imsakTime);
  const minutesBeforeFajr = prayerTimes.imsakNbMinBeforeFajr ?? 0;
  if (!imsak && fajr && row.length === 6 && minutesBeforeFajr > 0) {
    const at = fajr.at.getTime() - minutesBeforeFajr * MINUTE;
    imsak = { name: 'imsak', ...instant(at, timeZone), iqama: null };
  }

  let jumua: Prayer[] = [];
  if (weekday(date) === FRIDAY) {
    const first = prayerTimes.jumuaAsDuhr ? dhuhr?.time : prayerTimes.jumua;
    jumua = [first, prayerTimes.jumua2, prayerTimes.jumua3]
      .map((time) => prayer('jumua', time))
      .filter((p): p is Prayer => p !== null);
  }

  return { date: isoDate(date), imsak, ...prayers, jumua };
}

/** Return the iqama of an adhan: `+N` minutes after it, or an `HH:MM` time. */
function resolveIqama(
  adhan: PrayerTime,
  iqama: string,
  date: number,
  timeZone: string,
): PrayerTime | null {
  const value = iqama.trim();
  const adhanAt = adhan.at.getTime();
  let at: number;
  if (/^\+?\d+$/.test(value)) {
    at = adhanAt + Number(value) * MINUTE;
  } else {
    const minutes = parseTime(value);
    if (minutes === null) {
      return null;
    }
    at = zonedInstant(date, minutes, timeZone);
    // Like the iqama of an Isha just before midnight.
    if (at < adhanAt) {
      at = zonedInstant(date + 1, minutes, timeZone);
    }
  }
  return at - adhanAt < MAX_IQAMA_DELAY ? instant(at, timeZone) : null;
}

function instant(at: number, timeZone: string): PrayerTime {
  return { time: formatTime(at, timeZone), at: new Date(at) };
}
