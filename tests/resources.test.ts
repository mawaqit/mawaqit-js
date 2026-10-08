import { expect, test } from 'vitest';
import { example, json, mockAPI, UUID } from './helpers.ts';

test('search around a position', async () => {
  const { client, requests } = mockAPI([json(example('mosquesSearch', 'around-a-position'))]);

  const mosques = await client.mosques.search({ lat: 48.8414, lon: 2.3557, itemsPerPage: 2 });

  expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
    lat: '48.8414',
    lon: '2.3557',
    itemsPerPage: '2',
  });
  expect(mosques[0]).toMatchObject({
    uuid: UUID,
    proximity: 126,
    womenSpace: true,
    jumua2: '14:30',
    jumua3: null,
  });
});

test('search by words', async () => {
  const { client, requests } = mockAPI([json(example('mosquesSearch', 'by-words'))]);

  const mosques = await client.mosques.search({ word: 'grande mosquee de paris' });

  expect(requests[0]?.url.search).toBe('?word=grande+mosquee+de+paris');
  // The API has needed the token for searches since October 2026.
  expect(requests[0]?.headers.has('Api-Access-Token')).toBe(true);
  expect(mosques[0]?.label).toBe('GRANDE MOSQUÉE DE PARIS');
  expect(mosques[0]?.proximity).toBeUndefined();
});

test('search finding nothing', async () => {
  const { client } = mockAPI([json(example('mosquesSearch', 'nothing-found'))]);

  expect(await client.mosques.search({ word: 'x' })).toEqual([]);
});

test('get', async () => {
  const { client, requests } = mockAPI([json(example('mosquesGet', 'grande-mosquee-de-paris'))]);

  const mosque = await client.mosques.get(256);

  expect(requests[0]?.url.pathname).toBe('/api/3.0/mosque/256');
  expect(mosque).toMatchObject({ id: 256, uuid: UUID, type: 'MOSQUE' });
});

test('prayer times', async () => {
  const { client, requests } = mockAPI([
    json(example('mosquesPrayerTimes', 'grande-mosquee-de-paris')),
  ]);

  const prayerTimes = await client.mosques.prayerTimes(UUID);

  expect(requests[0]?.url.pathname).toBe(`/api/2.0/mosque/${UUID}/prayer-times`);
  expect(prayerTimes).toMatchObject({ uuid: UUID, timezone: 'Europe/Paris', jumua2: '14:30' });
  expect(prayerTimes.hijriAdjustment).toBe(-1);
  expect(prayerTimes.calendar).toHaveLength(12);
  expect(prayerTimes.calendar[0]?.['1']).toHaveLength(6);
  expect(prayerTimes.iqamaCalendar[11]?.['31']).toHaveLength(5);
});

test('Hijri settings', async () => {
  const { client, requests } = mockAPI([
    json(example('mosquesHijriSettings', 'grande-mosquee-de-paris')),
  ]);

  const settings = await client.mosques.hijriSettings(UUID);

  expect(requests[0]?.url.pathname).toBe(`/api/3.0/mosque/${UUID}/hijri-date`);
  expect(settings).toEqual({ hijriAdjustment: -1, hijriDateForceTo30: false });
});

test('config', async () => {
  const { client, requests } = mockAPI([json(example('mosquesConfig', 'grande-mosquee-de-paris'))]);

  const config = await client.mosques.config(UUID);

  expect(requests[0]?.url.pathname).toBe(`/api/3.0/mosque/${UUID}/config`);
  expect(config.displayingSabahImsak).toBe(false);
  expect(config.sabahImsakStartDate).toBeNull();
  expect(config.adhanEnabledByPrayer).toHaveLength(5);
});

test('flash message', async () => {
  const { client, requests } = mockAPI([json(example('mosquesFlashMessage', 'montreal'))]);

  const flash = await client.mosques.flashMessage(UUID);

  expect(requests[0]?.url.pathname).toBe(`/api/3.0/mosque/${UUID}/flash-message`);
  expect(flash).toMatchObject({
    content: 'Salât Al-Eid 7h00 Wednesday 27th of March',
    startDate: null,
    endDate: '2026-05-27',
    color: '#FFFFFF',
    orientation: 'ltr',
  });
});

test('no flash message', async () => {
  const { client } = mockAPI([json(example('mosquesFlashMessage', 'grande-mosquee-de-paris'))]);

  expect(await client.mosques.flashMessage(UUID)).toBeNull();
});

test('random hadith', async () => {
  const { client, requests } = mockAPI([json(example('hadithsRandom', 'french'))]);

  const hadith = await client.hadiths.random({ lang: 'fr-ar', maxLength: 300 });

  expect(requests[0]?.url.pathname).toBe('/api/2.0/hadith/random');
  expect(requests[0]?.url.search).toBe('?lang=fr-ar&maxLength=300');
  expect(requests[0]?.headers.has('Api-Access-Token')).toBe(false);
  expect(hadith?.lang).toBe('fr');
  expect(hadith?.text).toContain('Allah');
});

test('random hadith in Arabic by default', async () => {
  const { client, requests } = mockAPI([json(example('hadithsRandom', 'arabic'))]);

  expect((await client.hadiths.random())?.lang).toBe('ar');
  expect(requests[0]?.url.search).toBe('');
});

test('no hadith short enough', async () => {
  const { client } = mockAPI([json(example('hadithsRandom', 'none-short-enough'))]);

  // The API answers [], which would be truthy.
  expect(await client.hadiths.random({ maxLength: 1 })).toBeNull();
});

test('fields the API adds later are kept', async () => {
  const { client } = mockAPI([json({ hijriAdjustment: 0, hijriDateForceTo30: false, new: 1 })]);

  expect(await client.mosques.hijriSettings(UUID)).toHaveProperty('new', 1);
});
