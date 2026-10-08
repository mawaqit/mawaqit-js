import type { PrayerTimes } from '@mawaqit/sdk';
import {
  nextPrayer,
  night,
  type Prayer,
  type PrayerTimesLike,
  prayerDay,
} from '@mawaqit/sdk/prayer-times';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { example } from './helpers.ts';

// Real times, of the Grande Mosquée de Paris.
const PARIS = example('mosquesPrayerTimes', 'grande-mosquee-de-paris') as PrayerTimes;

/** Prayer times with these rows, by `MM-DD`, and the same row every other day. */
function prayerTimes(
  rows: Record<string, string[]> = {},
  options: Partial<PrayerTimesLike> & { iqama?: Record<string, string[]> } = {},
): PrayerTimesLike {
  const { iqama = {}, ...fields } = options;
  const months = (fill: string[], byDay: Record<string, string[]>): Record<string, string[]>[] =>
    Array.from({ length: 12 }, (_, month) =>
      Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => {
          const key = `${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
          return [String(i + 1), byDay[key] ?? fill];
        }),
      ),
    );
  return {
    timezone: 'Europe/Paris',
    calendar: months(['06:00', '07:30', '13:00', '16:00', '19:00', '20:30'], rows),
    iqamaCalendar: months(['+10', '+5', '+5', '+5', '+5'], iqama),
    iqamaEnabled: true,
    jumua: '13:30',
    jumua2: null,
    jumua3: null,
    jumuaAsDuhr: false,
    imsakNbMinBeforeFajr: 0,
    ...fields,
  };
}

/** The time and instant of a prayer, to compare in one assertion. */
function times(prayer: Prayer | null | undefined): unknown {
  return (
    prayer && {
      name: prayer.name,
      time: prayer.time,
      at: prayer.at.toISOString(),
      iqama: prayer.iqama && { time: prayer.iqama.time, at: prayer.iqama.at.toISOString() },
    }
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('prayerDay', () => {
  test('a day of a real calendar', () => {
    const day = prayerDay(PARIS, '2026-01-01');

    expect(day?.date).toBe('2026-01-01');
    expect(times(day?.fajr)).toEqual({
      name: 'fajr',
      time: '07:05',
      at: '2026-01-01T06:05:00.000Z',
      iqama: { time: '07:13', at: '2026-01-01T06:13:00.000Z' },
    });
    expect(times(day?.shuruq)).toEqual({
      name: 'shuruq',
      time: '08:44',
      at: '2026-01-01T07:44:00.000Z',
      iqama: null,
    });
    expect(day?.asr?.iqama?.time).toBe('14:56');
    expect(day?.maghrib?.iqama?.time).toBe('17:08');
    expect(day?.isha?.iqama?.time).toBe('18:43');
    expect(day?.imsak).toBeNull();
    // A Thursday.
    expect(day?.jumua).toEqual([]);
  });

  test('today by default, in the time zone of the mosque', () => {
    // Already 2 January in Paris.
    vi.setSystemTime('2026-01-01T23:30:00Z');

    expect(prayerDay(PARIS)?.date).toBe('2026-01-02');
  });

  test.each([[{ year: 2026, month: 3, day: 29 }], ['2026-03-29']])('day %j', (day) => {
    expect(prayerDay(PARIS, day)?.date).toBe('2026-03-29');
  });

  test('summer time', () => {
    // 28 March is in winter time, 29 March in summer time.
    expect(prayerDay(PARIS, '2026-03-28')?.fajr?.at.toISOString()).toBe('2026-03-28T04:03:00.000Z');
    expect(prayerDay(PARIS, '2026-03-29')?.fajr?.at.toISOString()).toBe('2026-03-29T04:01:00.000Z');
  });

  test('times of the change of daylight saving time, like in Python', () => {
    const day = (date: string): ReturnType<typeof prayerDay> =>
      prayerDay(
        prayerTimes({ [date.slice(5)]: ['02:30', '07:30', '13:00', '16:00', '19:00', '20:30'] }),
        date,
      );

    // Skipped: 02:30 does not exist, so it is 03:30 of summer time.
    expect(times(day('2026-03-29')?.fajr)).toMatchObject({
      time: '03:30',
      at: '2026-03-29T01:30:00.000Z',
    });
    // Repeated: the first 02:30, in summer time.
    expect(times(day('2026-10-25')?.fajr)).toMatchObject({
      time: '02:30',
      at: '2026-10-25T00:30:00.000Z',
    });
  });

  describe('Jumua', () => {
    test('on Fridays', () => {
      const day = prayerDay({ ...PARIS, jumua3: '15:30' }, '2026-01-02');

      expect(day?.jumua.map(times)).toEqual([
        { name: 'jumua', time: '13:50', at: '2026-01-02T12:50:00.000Z', iqama: null },
        { name: 'jumua', time: '14:30', at: '2026-01-02T13:30:00.000Z', iqama: null },
        { name: 'jumua', time: '15:30', at: '2026-01-02T14:30:00.000Z', iqama: null },
      ]);
      expect(day?.dhuhr?.time).toBe('13:00');
    });

    test('at the time of Dhuhr', () => {
      const day = prayerDay({ ...PARIS, jumuaAsDuhr: true, jumua: '12:00' }, '2026-01-02');

      expect(day?.jumua.map((p) => p.time)).toEqual(['13:00', '14:30']);
    });

    test('without Jumua', () => {
      const day = prayerDay({ ...PARIS, jumua: null, jumua2: 'nonsense' }, '2026-01-02');

      expect(day?.jumua).toEqual([]);
    });
  });

  describe('Imsak', () => {
    test('from the calendar, with Sabah as Fajr', () => {
      const day = prayerDay(
        prayerTimes({ '03-01': ['05:20', '05:30', '07:30', '13:00', '16:00', '19:00', '20:30'] }),
        '2026-03-01',
      );

      expect(day?.imsak).toMatchObject({ name: 'imsak', time: '05:20', iqama: null });
      expect(times(day?.fajr)).toMatchObject({ time: '05:30', iqama: { time: '05:40' } });
      expect(day?.shuruq?.time).toBe('07:30');
      expect(day?.isha?.time).toBe('20:30');
    });

    test('minutes before Fajr', () => {
      const day = prayerDay(prayerTimes({}, { imsakNbMinBeforeFajr: 10 }), '2026-03-01');

      expect(times(day?.imsak)).toEqual({
        name: 'imsak',
        time: '05:50',
        at: '2026-03-01T04:50:00.000Z',
        iqama: null,
      });
    });

    test.each([0, null])('none with %j minutes before Fajr', (imsakNbMinBeforeFajr) => {
      const day = prayerDay(prayerTimes({}, { imsakNbMinBeforeFajr }), '2026-03-01');

      expect(day?.imsak).toBeNull();
    });
  });

  describe('iqama', () => {
    const isha = (time: string, iqama: string): Prayer | null | undefined =>
      prayerDay(
        prayerTimes(
          { '06-20': ['03:50', '05:45', '13:55', '18:00', '21:55', time] },
          { iqama: { '06-20': ['+10', '+5', '+5', '+5', iqama] } },
        ),
        '2026-06-20',
      )?.isha;

    test.each([
      ['+15', '23:45', '2026-06-20T21:45:00.000Z'],
      ['15', '23:45', '2026-06-20T21:45:00.000Z'],
      ['23:40', '23:40', '2026-06-20T21:40:00.000Z'],
      // After midnight, the next day.
      ['+45', '00:15', '2026-06-20T22:15:00.000Z'],
      ['00:10', '00:10', '2026-06-20T22:10:00.000Z'],
      [' +0 ', '23:30', '2026-06-20T21:30:00.000Z'],
    ])('%j after an Isha at 23:30', (iqama, time, at) => {
      expect(times(isha('23:30', iqama))).toMatchObject({ iqama: { time, at } });
    });

    test.each([
      'abc',
      '',
      '25:00',
      '-5',
      '\u0660\u0665:\u0660\u0660',
      // 23 hours after the adhan: a mistake of the mosque.
      '23:00',
      '+720',
    ])('invalid %j', (iqama) => {
      expect(isha('23:30', iqama)?.iqama).toBeNull();
    });

    test('when the mosque publishes no iqama', () => {
      const day = prayerDay({ ...PARIS, iqamaEnabled: false }, '2026-01-01');

      expect(day?.fajr?.iqama).toBeNull();
    });

    test('without a valid iqama row', () => {
      const day = prayerDay(prayerTimes({}, { iqama: { '01-01': ['+5'] } }), '2026-01-01');

      expect(day?.fajr).not.toBeNull();
      expect(day?.fajr?.iqama).toBeNull();
    });
  });

  test('an Isha after midnight is the next day', () => {
    const day = prayerDay(
      prayerTimes(
        { '06-20': ['03:00', '05:00', '13:55', '18:00', '22:30', '00:30'] },
        { iqama: { '06-20': ['+10', '+5', '+5', '+5', '00:40'] } },
      ),
      '2026-06-20',
    );

    expect(times(day?.isha)).toEqual({
      name: 'isha',
      time: '00:30',
      at: '2026-06-20T22:30:00.000Z',
      iqama: { time: '00:40', at: '2026-06-20T22:40:00.000Z' },
    });
  });

  test('a mistake of the mosque does not move the next prayers to the next day', () => {
    // 16:30 for Fajr, rather than 06:30.
    const day = prayerDay(
      prayerTimes({ '01-01': ['16:30', '07:30', '13:00', '16:00', '19:00', '20:30'] }),
      '2026-01-01',
    );

    expect([day?.fajr, day?.shuruq, day?.dhuhr, day?.isha].map((p) => p?.at.toISOString())).toEqual(
      [
        '2026-01-01T15:30:00.000Z',
        '2026-01-01T06:30:00.000Z',
        '2026-01-01T12:00:00.000Z',
        '2026-01-01T19:30:00.000Z',
      ],
    );
  });

  test('an Isha before Maghrib by mistake stays the same day', () => {
    // The next day would be 23:30 after Maghrib.
    const day = prayerDay(
      prayerTimes({ '01-01': ['06:00', '07:30', '13:00', '16:00', '21:00', '20:30'] }),
      '2026-01-01',
    );

    expect(day?.isha?.at.toISOString()).toBe('2026-01-01T19:30:00.000Z');
  });

  test.each([
    ['--', 'empty'],
    ['', 'empty'],
    ['24:00', 'out of range'],
    ['7h05', 'not HH:MM'],
    ['\u0667:\u0660\u0665', 'in Arabic-Indic digits'],
  ])('a time %j entered by hand, %s, is null', (time) => {
    const day = prayerDay(
      prayerTimes({ '01-01': ['06:00', '07:30', '13:00', time, '19:00', '20:30'] }),
      '2026-01-01',
    );

    expect(day?.asr).toBeNull();
    expect(day?.maghrib?.time).toBe('19:00');
  });

  test('times without a leading zero', () => {
    const day = prayerDay(
      prayerTimes({ '01-01': ['6:00', '7:30', '13:00', '16:00', '19:00', '20:30'] }),
      '2026-01-01',
    );

    expect(day?.fajr?.time).toBe('06:00');
  });

  test('a day without a valid row', () => {
    const calendar = PARIS.calendar.slice(0, 1);

    expect(prayerDay({ ...PARIS, calendar }, '2026-03-01')).toBeNull();
    expect(prayerDay(prayerTimes({ '01-01': ['06:00'] }), '2026-01-01')).toBeNull();
  });

  test('29 February, which the calendar always has', () => {
    expect(prayerDay(PARIS, '2028-02-29')?.fajr?.time).toBe(PARIS.calendar[1]?.['29']?.[0]);
  });

  test.each(['2026-02-30', 'tomorrow'])('invalid day %j', (day) => {
    expect(() => prayerDay(PARIS, day)).toThrow(RangeError);
  });

  test('unknown time zone', () => {
    expect(() => prayerDay({ ...PARIS, timezone: 'Europe/Atlantis' }, '2026-01-01')).toThrow(
      RangeError,
    );
  });
});

describe('nextPrayer', () => {
  const next = (now: string, options = {}, data: PrayerTimesLike = PARIS): unknown =>
    times(nextPrayer(data, { now: new Date(now), ...options }));

  test('the next adhan', () => {
    expect(next('2026-01-01T10:00:00Z')).toMatchObject({ name: 'dhuhr', time: '12:59' });
  });

  test('at the time of the adhan, the following prayer', () => {
    expect(next('2026-01-01T11:59:00Z')).toMatchObject({ name: 'asr' });
    expect(next('2026-01-01T11:58:59Z')).toMatchObject({ name: 'dhuhr' });
  });

  test('after Isha, the Fajr of the next day', () => {
    expect(next('2026-01-01T20:00:00Z')).toMatchObject({
      name: 'fajr',
      at: '2026-01-02T06:05:00.000Z',
    });
  });

  test('after the last Isha of the year, the first Fajr of the calendar', () => {
    expect(next('2026-12-31T22:00:00Z')).toMatchObject({
      name: 'fajr',
      at: '2027-01-01T06:05:00.000Z',
    });
  });

  test('now by default', () => {
    vi.setSystemTime('2026-01-01T10:00:00Z');

    expect(times(nextPrayer(PARIS))).toMatchObject({ name: 'dhuhr' });
  });

  test('Jumua on Fridays', () => {
    expect(next('2026-01-02T10:00:00Z')).toMatchObject({ name: 'jumua', time: '13:50' });
    expect(next('2026-01-02T13:00:00Z')).toMatchObject({ name: 'jumua', time: '14:30' });
    expect(next('2026-01-02T13:30:00Z')).toMatchObject({ name: 'asr' });
    expect(next('2026-01-02T10:00:00Z', { jumua: false })).toMatchObject({ name: 'dhuhr' });
  });

  test('Dhuhr on Fridays without Jumua', () => {
    expect(next('2026-01-02T10:00:00Z', {}, { ...PARIS, jumua: null, jumua2: null })).toMatchObject(
      {
        name: 'dhuhr',
      },
    );
  });

  test('with Shuruq', () => {
    expect(next('2026-01-01T07:00:00Z')).toMatchObject({ name: 'dhuhr' });
    expect(next('2026-01-01T07:00:00Z', { shuruq: true })).toMatchObject({ name: 'shuruq' });
  });

  test('the next iqama', () => {
    // Between the adhan of Dhuhr, 12:59, and its iqama, 13:07.
    expect(next('2026-01-01T12:02:00Z')).toMatchObject({ name: 'asr' });
    expect(next('2026-01-01T12:02:00Z', { iqama: true })).toMatchObject({ name: 'dhuhr' });
    // Without an iqama, the adhan.
    expect(
      next('2026-01-01T12:02:00Z', { iqama: true }, { ...PARIS, iqamaEnabled: false }),
    ).toMatchObject({
      name: 'asr',
    });
  });

  test('an Isha after midnight is still next after midnight', () => {
    const data = prayerTimes({ '06-20': ['03:00', '05:00', '13:55', '18:00', '22:30', '00:30'] });

    // 00:15 in Paris on 21 June: the Isha of 20 June, at 00:30.
    expect(next('2026-06-20T22:15:00Z', {}, data)).toMatchObject({
      name: 'isha',
      at: '2026-06-20T22:30:00.000Z',
    });
  });

  test('one prayer: the next Maghrib, today or tomorrow', () => {
    // Maghrib at 17:08 in Paris on 1 January.
    expect(next('2026-01-01T10:00:00Z', { prayer: 'maghrib' })).toMatchObject({
      name: 'maghrib',
      at: '2026-01-01T16:08:00.000Z',
    });
    expect(next('2026-01-01T17:00:00Z', { prayer: 'maghrib' })).toMatchObject({
      name: 'maghrib',
      at: '2026-01-02T16:09:00.000Z',
    });
  });

  test('one prayer: Dhuhr on Fridays, and the next Jumua a week later', () => {
    // Friday 2 January, then Saturday 3 January.
    expect(next('2026-01-02T10:00:00Z', { prayer: 'dhuhr' })).toMatchObject({ name: 'dhuhr' });
    expect(next('2026-01-03T10:00:00Z', { prayer: 'jumua' })).toMatchObject({
      name: 'jumua',
      at: '2026-01-09T12:50:00.000Z',
    });
    // On a Friday after the last Jumu'a, the one of the next Friday.
    expect(next('2026-01-02T14:00:00Z', { prayer: 'jumua' })).toMatchObject({
      at: '2026-01-09T12:50:00.000Z',
    });
  });

  test('one prayer: its iqama, and an Isha after midnight', () => {
    expect(next('2026-01-01T12:02:00Z', { prayer: 'dhuhr', iqama: true })).toMatchObject({
      name: 'dhuhr',
      at: '2026-01-01T11:59:00.000Z',
    });
    const data = prayerTimes({ '06-20': ['03:00', '05:00', '13:55', '18:00', '22:30', '00:30'] });
    expect(next('2026-06-20T22:15:00Z', { prayer: 'isha' }, data)).toMatchObject({
      at: '2026-06-20T22:30:00.000Z',
    });
  });

  test('one prayer the mosque never has', () => {
    expect(next('2026-01-01T10:00:00Z', { prayer: 'imsak' })).toBeNull();
  });

  test('skips invalid times and missing days', () => {
    const data = prayerTimes({ '01-01': ['06:00', '07:30', '13:00', '--', '19:00', '20:30'] });

    expect(next('2026-01-01T13:00:00Z', {}, data)).toMatchObject({ name: 'maghrib' });
    expect(next('2026-01-01T10:00:00Z', {}, { ...PARIS, calendar: [] })).toBeNull();
  });
});

describe('night', () => {
  test('its thirds', () => {
    // Maghrib at 17:08, then Fajr at 07:05 the next day: 13 hours and 57 minutes.
    expect(night(PARIS, '2026-01-01')).toEqual({
      start: new Date('2026-01-01T16:08:00Z'),
      firstThirdEnd: new Date('2026-01-01T20:47:00Z'),
      middle: new Date('2026-01-01T23:06:30Z'),
      lastThirdStart: new Date('2026-01-02T01:26:00Z'),
      end: new Date('2026-01-02T06:05:00Z'),
    });
  });

  test('when the clocks go forward', () => {
    // Maghrib at 19:18 in winter time, then Fajr at 06:01 in summer time: 9 hours and 43 minutes.
    const result = night(PARIS, '2026-03-28');

    expect(result?.middle).toEqual(new Date('2026-03-28T23:09:30Z'));
  });

  test('tonight by default', () => {
    vi.setSystemTime('2026-01-01T12:00:00Z');

    expect(night(PARIS)?.start).toEqual(new Date('2026-01-01T16:08:00Z'));
  });

  test('without Maghrib or the next Fajr', () => {
    const data = prayerTimes({ '01-02': ['--', '07:30', '13:00', '16:00', '19:00', '20:30'] });

    expect(night(data, '2026-01-01')).toBeNull();
    expect(night({ ...PARIS, calendar: PARIS.calendar.slice(0, 1) }, '2026-01-31')).toBeNull();
  });
});
