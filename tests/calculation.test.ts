import { readdirSync, readFileSync } from 'node:fs';
import { fromGregorian, HijriMonth, today } from '@mawaqit/sdk/hijri';
import {
  CALCULATION_METHODS,
  type CalculatedPrayerTimes,
  type CalculationMethod,
  type CalculationOptions,
  type CalculationPosition,
  type CalculationSettings,
  calculatePrayerTimes,
  calculationMethodName,
  defaultCalculationMethod,
  defaultCalculationSettings,
  nextPrayer,
  night,
  prayerDay,
} from '@mawaqit/sdk/prayer-times';
import { CalculationParameters, Coordinates, PrayerTimes } from 'adhan';
import { afterEach, describe, expect, test, vi } from 'vitest';

const PARIS = { latitude: 48.8566, longitude: 2.3522, timeZone: 'Europe/Paris' };
const LILLE = { latitude: 50.6292, longitude: 3.0573, timeZone: 'Europe/Paris' };
const OSLO = { latitude: 59.9139, longitude: 10.7522, timeZone: 'Europe/Oslo' };
const TROMSO = { latitude: 69.6496, longitude: 18.956, timeZone: 'Europe/Oslo' };
const MAKKAH = { latitude: 21.4225, longitude: 39.8262, timeZone: 'Asia/Riyadh' };
const MWL: CalculationSettings = {
  method: 'muslim_world_league',
  madhab: 'shafi',
  highLatitudeRule: 'twilight_angle',
};
const ADJUSTED = ['fajr', 'shuruq', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
const RULES = ['middle_of_the_night', 'seventh_of_the_night', 'twilight_angle'] as const;
const ADHAN_RULES = {
  middle_of_the_night: 'middleofthenight',
  seventh_of_the_night: 'seventhofthenight',
  twilight_angle: 'twilightangle',
} as const;

afterEach(() => {
  vi.useRealTimers();
});

/** The row of a day, from an ISO date. */
function row(times: CalculatedPrayerTimes, date: string): string[] | undefined {
  const [, month, day] = date.split('-').map(Number) as [number, number, number];
  return times.calendar[month - 1]?.[String(day)];
}

/** Every day of a calculated year, as an ISO date and its row. */
function days(times: CalculatedPrayerTimes, year: number): [string, string[]][] {
  return times.calendar.flatMap((month, i) =>
    Object.entries(month).map(([day, times]): [string, string[]] => [
      `${year}-${String(i + 1).padStart(2, '0')}-${day.padStart(2, '0')}`,
      times,
    ]),
  );
}

function isRamadan(date: string, hijriAdjustment = 0): boolean {
  const hijri = fromGregorian(date, { hijriAdjustment, hijriDateForceTo30: false });
  return hijri.month === HijriMonth.RAMADAN;
}

/**
 * The times of adhan-js on a day, with its parameters for the angles of a method, Dhuhr a minute
 * after the transit, and 30 more minutes for the Isha of Umm al-Qura in Ramadan.
 */
function adhan(
  position: Pick<CalculationPosition, 'latitude' | 'longitude'>,
  settings: CalculationSettings,
  date: string,
  hijriAdjustment = 0,
): Date[] {
  const { method } = settings;
  const angles =
    method === 'custom'
      ? { fajrAngle: settings.fajrAngle, ishaAngle: settings.ishaAngle, ishaMinutesAfterMaghrib: 0 }
      : CALCULATION_METHODS[method];
  const parameters = new CalculationParameters(
    'Other',
    angles.fajrAngle,
    angles.ishaAngle ?? 0,
    angles.ishaMinutesAfterMaghrib ?? 0,
  );
  parameters.madhab = settings.madhab;
  parameters.highLatitudeRule = ADHAN_RULES[settings.highLatitudeRule];
  parameters.methodAdjustments = { ...parameters.methodAdjustments, dhuhr: 1 };
  const adjustments = settings.adjustments ?? {};
  const ramadan = method === 'umm_al_qura' && isRamadan(date, hijriAdjustment);
  parameters.adjustments = {
    fajr: adjustments.fajr ?? 0,
    sunrise: adjustments.shuruq ?? 0,
    dhuhr: adjustments.dhuhr ?? 0,
    asr: adjustments.asr ?? 0,
    maghrib: adjustments.maghrib ?? 0,
    isha: (adjustments.isha ?? 0) + (ramadan ? 30 : 0),
  };
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const times = new PrayerTimes(
    new Coordinates(position.latitude, position.longitude),
    new Date(year, month - 1, day),
    parameters,
  );
  return [times.fajr, times.sunrise, times.dhuhr, times.asr, times.maghrib, times.isha];
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The `HH:MM` time of an instant in a time zone. */
function clock(date: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    const options = { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    formatter = new Intl.DateTimeFormat('en-GB', options);
    formatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

/** A pseudo-random number from 0 to 1, always the same from the same seed: Mulberry32. */
function randomNumbers(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('the same times as adhan-js, with Dhuhr a minute after the transit', () => {
  const random = randomNumbers(16);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const methods = [...Object.keys(CALCULATION_METHODS), 'custom'] as CalculationMethod[];

  // Thousands of positions within ±65°, in the time zone of their longitude, every method, madhab
  // and rule, with adjustments, over a century: a week of each year, from a random day.
  test.each(Array.from({ length: 10 }, (_, i) => i))('random positions and days, %i', () => {
    const mismatches: unknown[] = [];
    for (let i = 0; i < 100; i++) {
      const latitude = Math.round((random() * 130 - 65) * 1e4) / 1e4;
      const longitude = Math.round((random() * 360 - 180) * 1e4) / 1e4;
      const offset = Math.round(longitude / 15);
      const timeZone = `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
      const method = pick(methods);
      const settings: CalculationSettings = {
        method,
        madhab: pick(['shafi', 'hanafi'] as const),
        highLatitudeRule: pick(RULES),
        adjustments: Object.fromEntries(
          ADJUSTED.filter(() => random() < 0.3).map((name) => [
            name,
            Math.floor(random() * 21) - 10,
          ]),
        ),
      };
      if (method === 'custom') {
        settings.fajrAngle = Math.round(100 + random() * 100) / 10;
        settings.ishaAngle = Math.round(100 + random() * 100) / 10;
      }
      const options = {
        year: 1990 + Math.floor(random() * 111),
        hijriAdjustment: Math.floor(random() * 5) - 2,
      };
      const times = calculatePrayerTimes({ latitude, longitude, timeZone }, settings, options);
      const start = Math.floor(random() * 7);
      for (const [n, [date, actual]] of days(times, options.year).entries()) {
        if (n % 7 !== start) {
          continue;
        }
        const expected = adhan({ latitude, longitude }, settings, date, options.hijriAdjustment);
        // Etc/GMT+N is N hours behind UTC.
        const hhmm = expected.map((at) =>
          new Date(at.getTime() + offset * 3_600_000).toISOString().slice(11, 16),
        );
        if (actual.join() !== hhmm.join()) {
          mismatches.push({ latitude, longitude, settings, options, date, actual, hhmm });
        }
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  });

  test.each([
    ['Paris', PARIS, { ...MWL, method: 'angle_15' }],
    ['Lille', LILLE, { ...MWL, highLatitudeRule: 'middle_of_the_night' }],
    ['Oslo', OSLO, MWL],
    ['Montreal', { latitude: 45.5019, longitude: -73.5674, timeZone: 'America/Toronto' }, MWL],
    // The sun is two hours late on the clock: Asia/Shanghai is UTC+8 at 76° E.
    [
      'Kashgar',
      { latitude: 39.4704, longitude: 75.9898, timeZone: 'Asia/Shanghai' },
      { ...MWL, method: 'karachi', madhab: 'hanafi' },
    ],
    ['Makkah', MAKKAH, { ...MWL, method: 'umm_al_qura' }],
    [
      'Santiago',
      { latitude: -33.4489, longitude: -70.6693, timeZone: 'America/Santiago' },
      { ...MWL, adjustments: { fajr: -3, maghrib: 3 } },
    ],
  ] as const)(
    '%s, every day of the year, through daylight saving time',
    (_, position, settings) => {
      const times = calculatePrayerTimes(position, settings, { year: 2026 });
      for (const [date, actual] of days(times, 2026)) {
        const expected = adhan(position, settings, date).map((at) => clock(at, position.timeZone));
        expect(actual, date).toEqual(expected);
      }
    },
  );

  test('when daylight saving time starts between Fajr and Isha', () => {
    const times = calculatePrayerTimes(TROMSO, MWL, { year: 2026 });
    const expected = adhan(TROMSO, MWL, '2026-03-29').map((at) => clock(at, TROMSO.timeZone));

    // 01:57 in winter time, 22:33 in summer time.
    expect(row(times, '2026-03-29')).toEqual(expected);
    expect(expected).toEqual(['01:57', '06:03', '12:50', '16:00', '19:38', '22:33']);
  });
});

describe('calculatePrayerTimes', () => {
  test('Fajr and Isha in Paris on 21 December, by angle', () => {
    const times = (method: CalculationMethod): (string | undefined)[] => {
      const day = row(
        calculatePrayerTimes(PARIS, { ...MWL, method }, { year: 2026 }),
        '2026-12-21',
      );
      return [day?.[0], day?.[5]];
    };

    expect(times('muslims_of_france')).toEqual(['07:23', '18:14']);
    expect(times('angle_15')).toEqual(['07:04', '18:33']);
    expect(times('muslim_world_league')).toEqual(['06:45', '18:46']);
  });

  test('the high-latitude rules in Lille on 21 June, at 18° and 17°', () => {
    const times = (highLatitudeRule: CalculationSettings['highLatitudeRule']): string[] =>
      row(
        calculatePrayerTimes(LILLE, { ...MWL, highLatitudeRule }, { year: 2026 }),
        '2026-06-21',
      ) ?? [];

    expect(times('twilight_angle')).toEqual(['03:20', '05:35', '13:51', '18:11', '22:04', '00:12']);
    expect(times('middle_of_the_night')).toEqual([
      '01:49',
      ...times('twilight_angle').slice(1, 5),
      '01:50',
    ]);
    expect(times('seventh_of_the_night')[0]).toBe('04:31');
  });

  test('Dhuhr is the same minute for every method', () => {
    const dhuhrs = new Set(
      Object.keys(CALCULATION_METHODS).map(
        (method) =>
          row(
            calculatePrayerTimes(PARIS, { ...MWL, method } as CalculationSettings, { year: 2026 }),
            '2026-06-21',
          )?.[2],
      ),
    );

    expect([...dhuhrs]).toEqual(['13:53']);
  });

  test('the adjustments, in minutes, then the rounding', () => {
    const adjustments = { fajr: -5, shuruq: 2, dhuhr: 3, asr: 1, maghrib: 4, isha: -2 };
    const plain = row(calculatePrayerTimes(PARIS, MWL, { year: 2026 }), '2026-12-21') ?? [];
    const adjusted =
      row(calculatePrayerTimes(PARIS, { ...MWL, adjustments }, { year: 2026 }), '2026-12-21') ?? [];
    const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

    expect(adjusted.map((time, i) => minutes(time) - minutes(plain[i] as string))).toEqual(
      Object.values(adjustments),
    );
  });

  describe('Isha after Maghrib', () => {
    test('90 minutes for Umm al-Qura, and 120 during Ramadan', () => {
      const times = calculatePrayerTimes(MAKKAH, { ...MWL, method: 'umm_al_qura' }, { year: 2026 });
      const gaps = days(times, 2026).map(([date, [, , , , maghrib, isha]]) => [
        isRamadan(date),
        minutesBetween(maghrib, isha),
      ]);

      expect(new Set(gaps.map(([ramadan, gap]) => `${ramadan} ${gap}`))).toEqual(
        new Set(['false 90', 'true 120']),
      );
      // 1 Ramadan 1447 is 17 February 2026.
      expect(gaps.filter(([ramadan]) => ramadan)).toHaveLength(30);
      expect(minutesBetween(...isha(times, '2026-02-17'))).toBe(120);
      expect(minutesBetween(...isha(times, '2026-02-16'))).toBe(90);
    });

    test('Ramadan follows hijriAdjustment', () => {
      const settings: CalculationSettings = { ...MWL, method: 'umm_al_qura' };
      const times = calculatePrayerTimes(MAKKAH, settings, { year: 2026, hijriAdjustment: 1 });

      expect(minutesBetween(...isha(times, '2026-02-16'))).toBe(120);
    });

    test('from Maghrib before its adjustment', () => {
      const settings: CalculationSettings = {
        ...MWL,
        method: 'qatar',
        adjustments: { maghrib: 5 },
      };
      const times = calculatePrayerTimes(MAKKAH, settings, { year: 2026 });

      // 90 minutes after sunset, so 85 after the adjusted Maghrib, in Ramadan too for Qatar.
      expect(minutesBetween(...isha(times, '2026-01-10'))).toBe(85);
      expect(minutesBetween(...isha(times, '2026-02-20'))).toBe(85);
    });

    function isha(times: CalculatedPrayerTimes, date: string): [string, string] {
      const day = row(times, date) ?? [];
      return [day[4] as string, day[5] as string];
    }

    function minutesBetween(from: string | undefined, to: string | undefined): number {
      const minutes = (time = ''): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      return (minutes(to) - minutes(from) + 1440) % 1440;
    }
  });

  describe('polar regions', () => {
    test.each([
      ['the sun does not set', '2026-06-21'],
      ['the sun does not rise', '2026-12-21'],
    ])('when %s, the times of the same longitude at 65°', (_, date) => {
      const times = calculatePrayerTimes(TROMSO, MWL, { year: 2026 });
      const at65 = adhan({ ...TROMSO, latitude: 65 }, MWL, date);

      expect(row(times, date)).toEqual(at65.map((at) => clock(at, TROMSO.timeZone)));
    });

    test('in the south too', () => {
      const position = { latitude: -77.85, longitude: 166.67, timeZone: 'Antarctica/McMurdo' };
      const times = calculatePrayerTimes(position, MWL, { year: 2026 });
      const at65 = adhan({ ...position, latitude: -65 }, MWL, '2026-06-21');

      expect(row(times, '2026-06-21')).toEqual(at65.map((at) => clock(at, position.timeZone)));
    });

    test('at the poles', () => {
      const times = calculatePrayerTimes({ latitude: 90, longitude: 0, timeZone: 'UTC' }, MWL, {
        year: 2026,
      });

      expect(row(times, '2026-06-21')).toHaveLength(6);
    });
  });

  test('the day of the noon of the time zone, near the date line', () => {
    // UTC+14 at 157° W: the noon of 1 January in Kiritimati is the one of 31 December in UTC.
    const position = { latitude: 1.87, longitude: -157.4, timeZone: 'Pacific/Kiritimati' };
    const times = calculatePrayerTimes(position, MWL, { year: 2026 });
    const expected = adhan(position, MWL, '2025-12-31').map((at) => clock(at, position.timeZone));

    expect(row(times, '2026-01-01')).toEqual(expected);
    expect(prayerDay(times, '2026-01-01')?.dhuhr?.at.toISOString()).toBe(
      '2025-12-31T22:34:00.000Z',
    );
  });

  describe('the year', () => {
    test('the current year in the time zone by default', () => {
      // Already 2028 in Paris.
      vi.useFakeTimers({ now: new Date('2027-12-31T23:30:00Z') });

      const times = calculatePrayerTimes(PARIS, MWL);

      expect(times.calendar[1]?.['29']).toHaveLength(6);
    });

    test.each([
      [2026, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]],
      [2028, [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]],
    ])('every day of %i', (year, lengths) => {
      const times = calculatePrayerTimes(PARIS, MWL, { year });

      expect(times.calendar.map((month) => Object.keys(month).length)).toEqual(lengths);
      expect(Object.keys(times.calendar[0] ?? {}).slice(0, 3)).toEqual(['1', '2', '3']);
      for (const month of times.calendar) {
        for (const day of Object.values(month)) {
          expect(day.every((time) => /^\d\d:\d\d$/.test(time))).toBe(true);
        }
      }
    });

    test.each([
      ['1 January', '2026-01-01'],
      ['29 February', '2028-02-29'],
      ['31 December, with the sunrise of the next year', '2026-12-31'],
    ])('%s', (_, date) => {
      const year = Number(date.slice(0, 4));
      const times = calculatePrayerTimes(OSLO, MWL, { year });

      expect(row(times, date)).toEqual(
        adhan(OSLO, MWL, date).map((at) => clock(at, OSLO.timeZone)),
      );
    });
  });

  describe('the other fields', () => {
    test('by default', () => {
      const { calendar, ...fields } = calculatePrayerTimes(PARIS, MWL, { year: 2026 });

      expect(fields).toEqual({
        timezone: 'Europe/Paris',
        iqamaCalendar: [],
        iqamaEnabled: false,
        jumua: null,
        jumua2: null,
        jumua3: null,
        jumuaAsDuhr: false,
        imsakNbMinBeforeFajr: null,
        hijriAdjustment: 0,
        hijriDateForceTo30: false,
      });
    });

    test('Jumua at the time of Dhuhr: the next Friday', () => {
      // A Monday: the next Friday is 9 October.
      vi.useFakeTimers({ now: new Date('2026-10-05T10:00:00Z') });

      const times = calculatePrayerTimes(PARIS, MWL, { jumuaAtDhuhr: true });

      expect(times.jumuaAsDuhr).toBe(true);
      expect(times.jumua).toBe(row(times, '2026-10-09')?.[2]);
      expect(prayerDay(times, '2026-10-09')?.jumua.map((p) => p.time)).toEqual([times.jumua]);
      expect(prayerDay(times, '2026-10-16')?.jumua.map((p) => p.time)).toEqual([
        row(times, '2026-10-16')?.[2],
      ]);
    });

    test('Jumua of another year: its first Friday', () => {
      vi.useFakeTimers({ now: new Date('2026-10-05T10:00:00Z') });

      const times = calculatePrayerTimes(PARIS, MWL, { year: 2027, jumuaAtDhuhr: true });

      // 1 January 2027 is a Friday.
      expect(times.jumua).toBe(row(times, '2027-01-01')?.[2]);
    });

    test('Imsak', () => {
      const times = calculatePrayerTimes(PARIS, MWL, { year: 2026, imsakMinutesBeforeFajr: 10 });
      const day = prayerDay(times, '2026-12-21');

      expect(times.imsakNbMinBeforeFajr).toBe(10);
      expect([day?.imsak?.time, day?.fajr?.time]).toEqual(['06:35', '06:45']);
    });

    test('the Hijri date', () => {
      vi.useFakeTimers({ now: new Date('2026-02-16T12:00:00Z') });

      const times = calculatePrayerTimes(MAKKAH, MWL, { hijriAdjustment: 1 });

      expect(times.hijriAdjustment).toBe(1);
      expect(String(today(times, times.timezone))).toBe('1 Ramadan 1447');
    });
  });

  describe('read by the helpers of a mosque', () => {
    const times = calculatePrayerTimes(LILLE, MWL, { year: 2026 });

    test('an Isha after midnight', () => {
      const day = prayerDay(times, '2026-06-21');

      expect(day?.isha?.at.toISOString()).toBe('2026-06-21T22:12:00.000Z');
      expect(night(times, '2026-06-21')?.start.toISOString()).toBe('2026-06-21T20:04:00.000Z');
      // 23:30 in Lille.
      const now = new Date('2026-06-21T21:30:00Z');
      expect(nextPrayer(times, { now })?.name).toBe('isha');
      expect(nextPrayer(times, { now: new Date('2026-06-21T22:30:00Z') })?.name).toBe('fajr');
    });

    test.each([
      ['2026-03-28', '2026-03-28T05:33:00.000Z'],
      ['2026-03-29', '2026-03-29T05:31:00.000Z'],
      ['2026-10-25', '2026-10-25T06:27:00.000Z'],
    ])('daylight saving time, %s', (date, sunrise) => {
      const day = prayerDay(times, date);

      expect(day?.shuruq?.at.toISOString()).toBe(sunrise);
      expect(day?.shuruq?.at).toEqual(adhan(LILLE, MWL, date)[1]);
    });

    test('no iqama', () => {
      expect(prayerDay(times, '2026-06-21')?.fajr?.iqama).toBeNull();
      expect(nextPrayer(times, { now: new Date('2026-06-21T12:00:00Z'), iqama: true })?.name).toBe(
        'asr',
      );
    });
  });

  describe('invalid input', () => {
    const custom = { ...MWL, method: 'custom', fajrAngle: 15, ishaAngle: 15 } as const;

    test.each([
      ['position.latitude', { ...PARIS, latitude: 90.5 }, MWL, {}],
      ['position.latitude', { ...PARIS, latitude: Number.NaN }, MWL, {}],
      ['position.latitude', { ...PARIS, latitude: '48.8' }, MWL, {}],
      ['position.longitude', { ...PARIS, longitude: -181 }, MWL, {}],
      ['position.timeZone', { ...PARIS, timeZone: 'Paris' }, MWL, {}],
      ['position.timeZone', { ...PARIS, timeZone: undefined }, MWL, {}],
      ['settings.method', PARIS, { ...MWL, method: 'mwl' }, {}],
      ['settings.method', PARIS, { ...MWL, method: 'toString' }, {}],
      ['settings.fajrAngle', PARIS, { ...custom, fajrAngle: undefined }, {}],
      ['settings.ishaAngle', PARIS, { ...custom, ishaAngle: 0 }, {}],
      ['settings.ishaAngle', PARIS, { ...custom, ishaAngle: 31 }, {}],
      ['settings.madhab', PARIS, { ...MWL, madhab: 'maliki' }, {}],
      ['settings.highLatitudeRule', PARIS, { ...MWL, highLatitudeRule: 'none' }, {}],
      ['settings.adjustments.sunrise', PARIS, { ...MWL, adjustments: { sunrise: 1 } }, {}],
      ['settings.adjustments.isha', PARIS, { ...MWL, adjustments: { isha: 1.5 } }, {}],
      ['settings.adjustments.fajr', PARIS, { ...MWL, adjustments: { fajr: 721 } }, {}],
      ['options.year', PARIS, MWL, { year: 2026.5 }],
      ['options.year', PARIS, MWL, { year: 999 }],
      ['options.hijriAdjustment', PARIS, MWL, { hijriAdjustment: -3 }],
      ['options.jumuaAtDhuhr', PARIS, MWL, { jumuaAtDhuhr: 'yes' }],
      ['options.imsakMinutesBeforeFajr', PARIS, MWL, { imsakMinutesBeforeFajr: -10 }],
    ])('%s: %j %j %j', (field, position, settings, options) => {
      const calculate = (): unknown =>
        calculatePrayerTimes(
          position as CalculationPosition,
          settings as CalculationSettings,
          options as CalculationOptions,
        );

      expect(calculate).toThrow(RangeError);
      expect(calculate).toThrow(`Invalid ${field}: `);
    });

    test('the message', () => {
      expect(() => calculatePrayerTimes({ ...PARIS, latitude: 91 }, MWL)).toThrow(
        'Invalid position.latitude: 91. Use a number from -90 to 90.',
      );
      expect(() => calculatePrayerTimes(PARIS, { ...MWL, method: 'custom' })).toThrow(
        'Invalid settings.fajrAngle: undefined. The custom method needs an angle above 0 and up to 30 degrees.',
      );
      expect(() => calculatePrayerTimes({ ...PARIS, timeZone: 'Paris' }, MWL)).toThrow(
        'Invalid position.timeZone: "Paris". Use an IANA time zone, like "Europe/Paris".',
      );
    });

    test('the angles of another method than custom are ignored', () => {
      const settings = { ...MWL, fajrAngle: 99, adjustments: { asr: undefined } };

      expect(calculatePrayerTimes(PARIS, settings, { year: 2026 })).toEqual(
        calculatePrayerTimes(PARIS, MWL, { year: 2026 }),
      );
    });
  });
});

describe('methods', () => {
  test('their angles', () => {
    expect(Object.keys(CALCULATION_METHODS)).toHaveLength(17);
    expect(CALCULATION_METHODS.angle_15).toEqual({
      fajrAngle: 15,
      ishaAngle: 15,
      ishaMinutesAfterMaghrib: null,
    });
    expect(CALCULATION_METHODS.umm_al_qura).toEqual({
      fajrAngle: 18.5,
      ishaAngle: null,
      ishaMinutesAfterMaghrib: 90,
    });
  });

  test.each([
    ['FR', 'angle_15'],
    ['fr', 'angle_15'],
    ['DZ', 'algeria'],
    ['MA', 'morocco'],
    ['SA', 'umm_al_qura'],
    ['EG', 'egypt'],
    ['SN', 'egypt'],
    ['GB', 'north_america'],
    ['PK', 'karachi'],
    ['MY', 'karachi'],
    ['ID', 'singapore'],
    ['AE', 'gulf'],
    ['KW', 'kuwait'],
    ['QA', 'qatar'],
    ['TR', 'turkey'],
    ['IR', 'tehran'],
    ['RU', 'russia'],
    ['NO', 'muslim_world_league'],
    ['', 'muslim_world_league'],
    [null, 'muslim_world_league'],
    [undefined, 'muslim_world_league'],
  ])('the method of %j', (country, method) => {
    expect(defaultCalculationMethod(country)).toBe(method);
  });

  test.each([
    ['FR', { method: 'angle_15', madhab: 'shafi', highLatitudeRule: 'twilight_angle' }],
    ['pk', { method: 'karachi', madhab: 'hanafi', highLatitudeRule: 'twilight_angle' }],
    ['IN', { method: 'karachi', madhab: 'hanafi', highLatitudeRule: 'twilight_angle' }],
    ['BD', { method: 'karachi', madhab: 'hanafi', highLatitudeRule: 'twilight_angle' }],
    ['AF', { method: 'karachi', madhab: 'hanafi', highLatitudeRule: 'twilight_angle' }],
    ['MY', { method: 'karachi', madhab: 'shafi', highLatitudeRule: 'twilight_angle' }],
    [
      undefined,
      { method: 'muslim_world_league', madhab: 'shafi', highLatitudeRule: 'twilight_angle' },
    ],
  ])('the settings of %j', (country, settings) => {
    expect(defaultCalculationSettings(country)).toEqual(settings);
  });

  test.each([
    ['muslim_world_league', 'en', 'Muslim World League'],
    ['muslim_world_league', 'fr', 'Ligue du monde musulman'],
    ['angle_15', 'fr-FR', 'Fajr et Isha à 15°'],
    ['angle_15', 'en', 'Fajr and Isha at 15°'],
    ['custom', 'ar', 'زوايا مخصصة'],
    ['gulf', 'de', 'Golfregion'],
    ['moonsighting_committee', 'tr', 'Ay Gözlem Komitesi'],
    ['muslims_of_france', 'es', 'Muslim of France (ex UOIF)'],
  ] as const)('the name of %s in %s', (method, language, name) => {
    expect(calculationMethodName(method, language)).toBe(name);
  });

  test('every method has a name in every language', () => {
    for (const language of ['ar', 'de', 'en', 'fr', 'tr']) {
      for (const method of [...Object.keys(CALCULATION_METHODS), 'custom'] as CalculationMethod[]) {
        expect(calculationMethodName(method, language)).not.toBe('');
      }
    }
    expect(calculationMethodName('karachi')).toBe('University of Islamic Sciences, Karachi');
  });
});

// The times of the MAWAQIT mobile app, recorded with the same settings: see the README there.
describe('the times of the MAWAQIT app', () => {
  const directory = new URL('data/calculation/', import.meta.url);
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));

  if (files.length === 0) {
    test.todo('no reference times recorded yet');
  }

  test.each(files)('%s', (name) => {
    const reference = JSON.parse(readFileSync(new URL(name, directory), 'utf8')) as {
      position: CalculationPosition;
      settings: CalculationSettings;
      options?: CalculationOptions;
      days: Record<string, string[]>;
    };
    const years = new Map<number, CalculatedPrayerTimes>();
    for (const [date, recorded] of Object.entries(reference.days)) {
      const year = Number(date.slice(0, 4));
      let times = years.get(year);
      if (!times) {
        times = calculatePrayerTimes(reference.position, reference.settings, {
          ...reference.options,
          year,
        });
        years.set(year, times);
      }
      // Dhuhr one minute later than recorded, as mawaqit/mawaqit-js#16 decided.
      const [fajr, shuruq, dhuhr = '', ...rest] = recorded;
      const later = new Date(Date.parse(`1970-01-01T${dhuhr}:00Z`) + 60_000);
      const expected = [fajr, shuruq, later.toISOString().slice(11, 16), ...rest];
      expect(row(times, date), date).toEqual(expected);
    }
  });
});
