// What TypeScript accepts and rejects: checked by `vitest --typecheck`, never run.

import {
  type Account,
  type APIStatusError,
  type FlashMessage,
  type Hadith,
  type InternalServerError,
  Mawaqit,
  type Mosque,
  type NotFoundError,
  type PrayerTimes,
  type RateLimitError,
} from '@mawaqit/sdk';
import { HijriMonth, type HijriSettingsLike, today } from '@mawaqit/sdk/hijri';
import {
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
