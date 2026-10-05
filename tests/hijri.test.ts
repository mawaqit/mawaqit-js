import { readFileSync } from 'node:fs';
import {
  fromGregorian,
  HijriDate,
  HijriMonth,
  type HijriSettingsLike,
  kuwaiti,
  monthName,
  today,
} from '@mawaqit/sdk/hijri';
import { describe, expect, test, vi } from 'vitest';
import { example } from './helpers.ts';

const DAY = 86_400_000;

// First Gregorian day of each Hijri month from 1990 to 2060, computed by the mosque screens.
const MONTH_STARTS = (
  JSON.parse(readFileSync(new URL('data/kuwaiti_month_starts.json', import.meta.url), 'utf8')) as {
    month_starts: [string, number, HijriMonth][];
  }
).month_starts;

function settings(hijriAdjustment = 0, hijriDateForceTo30 = false): HijriSettingsLike {
  return { hijriAdjustment, hijriDateForceTo30 };
}

/** The ISO dates from `start` included to `end` excluded. */
function* days(start: string, end: string): Generator<string> {
  for (let time = Date.parse(start); time < Date.parse(end); time += DAY) {
    yield new Date(time).toISOString().slice(0, 10);
  }
}

test('kuwaiti matches MAWAQIT every day from 1990 to 2060', () => {
  for (const [i, [start, year, month]] of MONTH_STARTS.entries()) {
    const end = MONTH_STARTS[i + 1]?.[0];
    if (!end) {
      break;
    }
    let day = 1;
    for (const date of days(start, end)) {
      expect(kuwaiti(date)).toEqual(new HijriDate(year, month, day++));
    }
  }
});

test('kuwaiti invariants from 1900 to 2200', () => {
  let previous = kuwaiti('1900-01-01');
  for (const date of days('1900-01-02', '2200-01-01')) {
    const current = kuwaiti(date);
    if (current.day === 1) {
      expect([29, 30]).toContain(previous.day);
      expect(HijriDate.compare(previous, current)).toBeLessThan(0);
    } else {
      expect(current.day).toBe(previous.day + 1);
    }
    previous = current;
  }
});

// Computed by mawaqit-py, which uses the same algorithm.
test.each([
  ['0001-01-01', -640, 5, 19],
  ['0099-01-01', -539, 5, 22],
  ['0622-07-16', 0, 12, 28],
  ['0622-07-19', 1, 1, 2],
  ['9999-12-31', 9666, 4, 3],
])('same as the Python library on %s', (day, year, month, dayOfMonth) => {
  expect(kuwaiti(day)).toEqual(new HijriDate(year, month as HijriMonth, dayOfMonth));
});

describe('Gregorian days', () => {
  test.each([
    ['2026-10-03'],
    [{ year: 2026, month: 10, day: 3 }],
    [new Date(2026, 9, 3).toISOString().slice(0, 10)],
  ])('%j', (day) => {
    expect(kuwaiti(day)).toEqual(new HijriDate(1448, HijriMonth.RABI_AL_THANI, 21));
  });

  test.each(['2026-02-30', '2026-13-01', '2026-1-1', '03/10/2026', '2026-10-03T00:00'])(
    'invalid %j',
    (day) => {
      expect(() => kuwaiti(day)).toThrow(RangeError);
    },
  );

  test('invalid object', () => {
    expect(() => kuwaiti({ year: 2026, month: 2, day: 30 })).toThrow(RangeError);
    expect(() => kuwaiti({ year: Number.NaN, month: 1, day: 1 })).toThrow(RangeError);
  });

  test('years before 100', () => {
    expect(kuwaiti({ year: 99, month: 1, day: 1 })).toEqual(kuwaiti('0099-01-01'));
  });
});

test('without settings', () => {
  expect(fromGregorian('2026-10-03')).toEqual(new HijriDate(1448, HijriMonth.RABI_AL_THANI, 21));
});

test.each([
  [-2, new HijriDate(1447, HijriMonth.SHABAN, 28)],
  [-1, new HijriDate(1447, HijriMonth.SHABAN, 29)],
  [0, new HijriDate(1447, HijriMonth.RAMADAN, 1)],
  [1, new HijriDate(1447, HijriMonth.RAMADAN, 2)],
])('adjustment %i', (adjustment, expected) => {
  expect(fromGregorian('2026-02-17', settings(adjustment))).toEqual(expected);
});

test.each([
  // 29 Ramadan 1447: the month lasts 30 days.
  ['2026-03-17', new HijriDate(1447, HijriMonth.RAMADAN, 30)],
  // 1 Shawwal 1447: the 30th of the previous month, unlike the apps.
  ['2026-03-19', new HijriDate(1447, HijriMonth.RAMADAN, 30)],
  // 1 Muharram 1448: the 30th of the last month of the previous year.
  ['2026-06-16', new HijriDate(1447, HijriMonth.DHU_AL_HIJJAH, 30)],
])('forced to 30 on %s', (day, expected) => {
  expect(fromGregorian(day, settings(0, true))).toEqual(expected);
});

test.each([
  // In Paris it is already 29 March, so the adjusted day is 30 March.
  ['2026-03-28T23:30Z', 'Europe/Paris', new HijriDate(1447, HijriMonth.SHAWWAL, 12)],
  ['2026-03-28T23:30Z', 'UTC', new HijriDate(1447, HijriMonth.SHAWWAL, 11)],
  // 24 hours after 00:30 on 25 October would still be 25 October in Paris.
  ['2026-10-24T22:30Z', 'Europe/Paris', new HijriDate(1448, HijriMonth.JUMADA_AL_ULA, 15)],
])('today at %s in %s', (now, timeZone, expected) => {
  vi.setSystemTime(now);
  try {
    expect(today(settings(1), timeZone)).toEqual(expected);
  } finally {
    vi.useRealTimers();
  }
});

test('today in an unknown time zone', () => {
  expect(() => today(settings(), 'Europe/Atlantis')).toThrow(RangeError);
});

test('settings of the API responses', () => {
  const prayerTimes = example('mosquesPrayerTimes', 'grande-mosquee-de-paris') as HijriSettingsLike;

  expect(fromGregorian('2026-02-18', prayerTimes)).toEqual(
    new HijriDate(1447, HijriMonth.RAMADAN, 1),
  );
});

describe('months', () => {
  test('numbers and names', () => {
    expect(HijriMonth.RAMADAN).toBe(9);
    expect(monthName(HijriMonth.RAMADAN)).toBe('Ramadan');
    expect(monthName(HijriMonth.DHU_AL_QIDAH)).toBe("Dhu al-Qi'dah");
  });

  test('keys are the names of the MAWAQIT apps, which integrations use as states', () => {
    expect(Object.keys(HijriMonth).map((key) => key.toLowerCase())).toEqual([
      'muharram',
      'safar',
      'rabi_al_awwal',
      'rabi_al_thani',
      'jumada_al_ula',
      'jumada_al_akhirah',
      'rajab',
      'shaban',
      'ramadan',
      'shawwal',
      'dhu_al_qidah',
      'dhu_al_hijjah',
    ]);
    expect(Object.values(HijriMonth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('dates', () => {
  const date = new HijriDate(1448, HijriMonth.RAMADAN, 9);

  test('toString', () => {
    expect(String(date)).toBe('9 Ramadan 1448');
    expect(`${date}`).toBe('9 Ramadan 1448');
    expect(date.monthName).toBe('Ramadan');
  });

  test('JSON', () => {
    expect(JSON.parse(JSON.stringify(date))).toEqual({ year: 1448, month: 9, day: 9 });
  });

  test('compare and equals', () => {
    const dates = [
      new HijriDate(1448, HijriMonth.MUHARRAM, 1),
      new HijriDate(1447, HijriMonth.DHU_AL_HIJJAH, 30),
      new HijriDate(1447, HijriMonth.DHU_AL_HIJJAH, 29),
    ];
    expect(dates.sort(HijriDate.compare).map(String)).toEqual([
      '29 Dhu al-Hijjah 1447',
      '30 Dhu al-Hijjah 1447',
      '1 Muharram 1448',
    ]);
    expect(date.equals(new HijriDate(1448, HijriMonth.RAMADAN, 9))).toBe(true);
    expect(date.equals(new HijriDate(1448, HijriMonth.RAMADAN, 10))).toBe(false);
  });

  test.each([
    [1448, 0, 1],
    [1448, 13, 1],
    [1448, 1, 0],
    [1448, 1, 31],
    [1448.5, 1, 1],
    [1448, 1, 1.5],
  ])('invalid %i-%i-%i', (year, month, day) => {
    expect(() => new HijriDate(year, month as HijriMonth, day)).toThrow(RangeError);
  });
});
