// Against the real API: `pnpm test:live`, with MAWAQIT_TOKEN for most tests.

import { Mawaqit } from '@mawaqit/sdk';
import { HijriDate, today } from '@mawaqit/sdk/hijri';
import { describe, expect, test } from 'vitest';

const client = new Mawaqit();

test('random hadith', async () => {
  const hadith = await client.hadiths.random({ lang: 'fr' });

  expect(hadith?.lang).toBe('fr');
  expect(await client.hadiths.random({ lang: 'fr', maxLength: 1 })).toBeNull();
});

describe.skipIf(!client.token)('with a token', () => {
  test('search', async () => {
    const mosques = await client.mosques.search({ lat: 48.8414, lon: 2.3557 });

    expect(mosques.length).toBeGreaterThan(0);
    expect(mosques[0]?.proximity).toBeTypeOf('number');
  });

  test('a mosque', async () => {
    const [mosque] = await client.mosques.search({ word: 'grande mosquee de paris' });
    const uuid = mosque?.uuid ?? '';

    const [prayerTimes, settings, config] = await Promise.all([
      client.mosques.prayerTimes(uuid),
      client.mosques.hijriSettings(uuid),
      client.mosques.config(uuid),
      client.mosques.flashMessage(uuid),
    ]);

    expect(prayerTimes.calendar).toHaveLength(12);
    expect(today(settings, prayerTimes.timezone)).toBeInstanceOf(HijriDate);
    expect(config.adhanEnabledByPrayer).toHaveLength(5);
    expect((await client.mosques.get(prayerTimes.id)).uuid).toBe(uuid);
  });
});
