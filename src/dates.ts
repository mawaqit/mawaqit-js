/**
 * @internal Gregorian days and wall-clock times in any time zone, with `Intl` only.
 *
 * Days are counted from 1 January 1970, and instants are milliseconds since then.
 *
 * @module
 */

/**
 * A Gregorian day: an ISO date like `"2026-10-05"`, or an object with its `year`, `month` from 1 to
 * 12 and `day`, like a `Temporal.PlainDate`.
 */
export type GregorianDay =
  | string
  | { readonly year: number; readonly month: number; readonly day: number };

export const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Return the number of days between 1 January 1970 and a Gregorian day.
 *
 * @throws {RangeError} The day is not a valid date.
 */
export function unixDay(day: GregorianDay): number {
  const { year, month, day: dayOfMonth } = typeof day === 'string' ? parseISODate(day) : day;
  const date = utcDate(year, month, dayOfMonth);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== dayOfMonth
  ) {
    throw new RangeError(`Invalid date: ${year}-${month}-${dayOfMonth}.`);
  }
  return date.getTime() / DAY;
}

/** Return the year, month and day of a day. */
export function dateOf(unixDay: number): { year: number; month: number; day: number } {
  const date = new Date(unixDay * DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Return the ISO date of a day, like `2026-10-05`. */
export function isoDate(unixDay: number): string {
  const { year, month, day } = dateOf(unixDay);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Return the day of the week, from 0 for Sunday to 6 for Saturday. */
export function weekday(unixDay: number): number {
  // 1 January 1970 was a Thursday.
  return (((unixDay + 4) % 7) + 7) % 7;
}

/** Return the day it is at an instant in a time zone. */
export function dayIn(instant: number, timeZone: string): number {
  const { year, month, day } = wallClock(instant, timeZone);
  return unixDay({ year, month, day });
}

/** Return the minutes since midnight of an `HH:MM` time, or `null` when it is not one. */
export function parseTime(time: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time?.trim() ?? '');
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  return match && hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Return the `HH:MM` time of an instant in a time zone. */
export function formatTime(instant: number, timeZone: string): string {
  const { hour, minute } = wallClock(instant, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * Return the instant of a wall-clock time on a day in a time zone.
 *
 * Like Python's `zoneinfo` with `fold=0`: an ambiguous time, when the clocks go back, is the first
 * of the two, and a time skipped when the clocks go forward uses the offset before the change.
 *
 * @throws {RangeError} The time zone is unknown.
 */
export function zonedInstant(unixDay: number, minutes: number, timeZone: string): number {
  const local = unixDay * DAY + minutes * MINUTE;
  // Offsets change at most once in two days.
  const before = offsetAt(local - DAY, timeZone);
  const after = offsetAt(local + DAY, timeZone);
  if (before === after) {
    return local - before;
  }
  const isBefore = offsetAt(local - before, timeZone) === before;
  const isAfter = offsetAt(local - after, timeZone) === after;
  return isBefore || !isAfter ? local - before : local - after;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(
  instant: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** Return the offset of a time zone from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClock(instant, timeZone);
  const local = utcDate(year, month, day).getTime() + ((hour * 60 + minute) * 60 + second) * 1000;
  return local - Math.floor(instant / 1000) * 1000;
}

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  // Unlike `Date.UTC()`, keeps the years 0 to 99 as they are.
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseISODate(text: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new RangeError(`Invalid date: ${JSON.stringify(text)}. Use YYYY-MM-DD.`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
