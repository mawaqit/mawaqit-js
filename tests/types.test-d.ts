// What TypeScript accepts and rejects: checked by `vitest --typecheck`, never run.

import {
  type Account,
  type APIStatusError,
  type FlashMessage,
  type Hadith,
  type InternalServerError,
  Mawaqit,
  type Mosque,
  type MosqueConfig,
  type NotFoundError,
  type PrayerTimes,
  type RateLimitError,
} from '@mawaqit/sdk';
import {
  eventName,
  HijriMonth,
  type HijriSettingsLike,
  type IslamicEvent,
  today,
  type UpcomingEvent,
  upcomingEvents,
} from '@mawaqit/sdk/hijri';
import {
  CALCULATION_METHODS,
  type CalculatedPrayerTimes,
  type CalculationMethod,
  type CalculationSettings,
  calculatePrayerTimes,
  calculationMethodName,
  defaultCalculationMethod,
  defaultCalculationSettings,
  nextPrayer,
  type Prayer,
  type PrayerName,
  type PrayerTimesLike,
  prayerDay,
} from '@mawaqit/sdk/prayer-times';
import { describe, expectTypeOf, test } from 'vitest';

const client = new Mawaqit();

describe('search', () => {
  test('by words or around a position', () => {
    expectTypeOf(client.mosques.search({ word: 'paris' })).resolves.toEqualTypeOf<Mosque[]>();
    client.mosques.search({ lat: 48.8, lon: 2.3, radius: 10, page: 2, itemsPerPage: 50 });
  });

  test('not both, nor half a position', () => {
    // @ts-expect-error A position takes precedence over the words.
    client.mosques.search({ word: 'paris', lat: 48.8, lon: 2.3 });
    // @ts-expect-error A latitude needs a longitude.
    client.mosques.search({ lat: 48.8 });
    // @ts-expect-error The radius only applies around a position.
    client.mosques.search({ word: 'paris', radius: 10 });
    // @ts-expect-error Something to search.
    client.mosques.search({});
    // @ts-expect-error Something to search.
    client.mosques.search();
  });

  test('parameters have their names in the API', () => {
    // @ts-expect-error `itemsPerPage`.
    client.mosques.search({ word: 'paris', items_per_page: 5 });
  });
});

test('responses', () => {
  expectTypeOf(client.mosques.prayerTimes('uuid')).resolves.toEqualTypeOf<PrayerTimes>();
  expectTypeOf(client.mosques.flashMessage('uuid')).resolves.toEqualTypeOf<FlashMessage | null>();
  expectTypeOf(client.hadiths.random()).resolves.toEqualTypeOf<Hadith | null>();
  client.hadiths.random({ lang: 'fr-ar', maxLength: 300 });
  // @ts-expect-error maxLength is a number.
  client.hadiths.random({ maxLength: '300' });
  expectTypeOf(client.auth.login({ email: 'e', password: 'p' })).resolves.toEqualTypeOf<Account>();
  // @ts-expect-error IDs are numbers.
  client.mosques.get('256');
});

test('nullable and optional fields', () => {
  expectTypeOf<Mosque['phone']>().toEqualTypeOf<string | null>();
  expectTypeOf<Mosque>().toHaveProperty('proximity').toEqualTypeOf<number | undefined>();
  // Absent for a background color.
  expectTypeOf<MosqueConfig>()
    .toHaveProperty('backgroundUrl')
    .toEqualTypeOf<string | null | undefined>();
  const calendar = [] as PrayerTimes['calendar'];
  // Days and months may be missing.
  expectTypeOf(calendar[0]?.['1']).toEqualTypeOf<string[] | undefined>();
});

test('request options', () => {
  client.mosques.prayerTimes('uuid', {
    timeout: 5_000,
    maxRetries: 0,
    signal: AbortSignal.timeout(1),
  });
  // @ts-expect-error Unknown option.
  client.mosques.prayerTimes('uuid', { retries: 1 });
});

test('the status of the errors', () => {
  expectTypeOf<NotFoundError['status']>().toEqualTypeOf<404>();
  expectTypeOf<RateLimitError['status']>().toEqualTypeOf<429>();
  expectTypeOf<InternalServerError['status']>().toEqualTypeOf<number>();
  expectTypeOf<NotFoundError>().toExtend<APIStatusError>();
});

test('Hijri', () => {
  expectTypeOf(HijriMonth.RAMADAN).toEqualTypeOf<9>();
  expectTypeOf<HijriMonth>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12>();
  expectTypeOf<PrayerTimes>().toExtend<HijriSettingsLike>();
  expectTypeOf(today).parameter(1).toEqualTypeOf<string>();
  expectTypeOf(upcomingEvents).returns.toEqualTypeOf<UpcomingEvent[]>();
  expectTypeOf<UpcomingEvent['event']>().toEqualTypeOf<IslamicEvent>();
  expectTypeOf<'ramadan'>().toExtend<IslamicEvent>();
  expectTypeOf<'mawlid'>().not.toExtend<IslamicEvent>();
  expectTypeOf(eventName).parameter(0).toEqualTypeOf<IslamicEvent>();
});

test('prayer times', () => {
  const prayerTimes = {} as PrayerTimes;
  expectTypeOf<PrayerTimes>().toExtend<PrayerTimesLike>();
  const day = prayerDay(prayerTimes, '2026-10-05');
  // No valid row that day, or no valid time for a prayer.
  expectTypeOf(day?.fajr).toEqualTypeOf<Prayer | null | undefined>();
  expectTypeOf(day?.jumua).toEqualTypeOf<readonly Prayer[] | undefined>();
  expectTypeOf<Prayer['name']>().toEqualTypeOf<PrayerName>();
  expectTypeOf<Prayer['iqama']>().toEqualTypeOf<{
    readonly time: string;
    readonly at: Date;
  } | null>();
  expectTypeOf(
    nextPrayer(prayerTimes, { now: new Date(), iqama: true }),
  ).toEqualTypeOf<Prayer | null>();
  nextPrayer(prayerTimes, { prayer: 'maghrib' });
  // @ts-expect-error Prayers are named in English, in lowercase.
  nextPrayer(prayerTimes, { prayer: 'Maghreb' });
  prayerDay(prayerTimes, { year: 2026, month: 10, day: 5 });
  // @ts-expect-error A day, not an instant.
  prayerDay(prayerTimes, new Date());
});

test('calculated prayer times', () => {
  const position = { latitude: 48.85, longitude: 2.35, timeZone: 'Europe/Paris' };
  const times = calculatePrayerTimes(position, defaultCalculationSettings('FR'));
  expectTypeOf(times).toEqualTypeOf<CalculatedPrayerTimes>();
  // Read like the times of a mosque.
  expectTypeOf<CalculatedPrayerTimes>().toExtend<PrayerTimesLike>();
  expectTypeOf<CalculatedPrayerTimes>().toExtend<HijriSettingsLike>();
  expectTypeOf(prayerDay(times)?.fajr).toEqualTypeOf<Prayer | null | undefined>();
  today(times, times.timezone);

  calculatePrayerTimes(position, { ...defaultCalculationSettings('FR'), madhab: 'hanafi' });
  calculatePrayerTimes(
    position,
    {
      method: 'custom',
      fajrAngle: 15,
      ishaAngle: 14,
      madhab: 'shafi',
      highLatitudeRule: 'twilight_angle',
      adjustments: { shuruq: -2, isha: 3 },
    },
    { year: 2027, hijriAdjustment: 1, jumuaAtDhuhr: true, imsakMinutesBeforeFajr: null },
  );
  const settings = defaultCalculationSettings();
  // @ts-expect-error Methods have ids, like `muslim_world_league`.
  calculatePrayerTimes(position, { ...settings, method: 'MWL' });
  // @ts-expect-error Shuruq, not sunrise.
  calculatePrayerTimes(position, { ...settings, adjustments: { sunrise: 2 } });
  // @ts-expect-error The rule is required.
  calculatePrayerTimes(position, { method: 'angle_15', madhab: 'shafi' });
  // @ts-expect-error The time zone is required.
  calculatePrayerTimes({ latitude: 48.85, longitude: 2.35 }, settings);
});

test('calculation methods', () => {
  expectTypeOf(defaultCalculationMethod('FR')).toEqualTypeOf<
    Exclude<CalculationMethod, 'custom'>
  >();
  expectTypeOf(defaultCalculationSettings('FR')).toEqualTypeOf<CalculationSettings>();
  expectTypeOf(CALCULATION_METHODS[defaultCalculationMethod()].ishaAngle).toEqualTypeOf<
    number | null
  >();
  // @ts-expect-error Custom angles are in the settings.
  CALCULATION_METHODS.custom;
  expectTypeOf(calculationMethodName).parameter(0).toEqualTypeOf<CalculationMethod>();
  // @ts-expect-error An id, not a name.
  calculationMethodName('Muslim World League');
});
