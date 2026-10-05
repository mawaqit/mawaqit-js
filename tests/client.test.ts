import { inspect } from 'node:util';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  type Logger,
  Mawaqit,
  MawaqitError,
  VERSION,
} from '@mawaqit/sdk';
import { describe, expect, test, vi } from 'vitest';
import { json, mockAPI, TOKEN, UUID } from './helpers.ts';

const HIJRI_SETTINGS = { hijriAdjustment: 0, hijriDateForceTo30: false };
const ACCOUNT = { id: 1, apiAccessToken: TOKEN, apiQuota: 300, apiCallNumber: 12 };

describe('options', () => {
  test('defaults', () => {
    const client = new Mawaqit();

    expect(client.token).toBeUndefined();
    expect(client.baseURL).toBe(DEFAULT_BASE_URL);
    expect(client.timeout).toBe(DEFAULT_TIMEOUT);
    expect(client.maxRetries).toBe(DEFAULT_MAX_RETRIES);
  });

  test('environment', () => {
    vi.stubEnv('MAWAQIT_TOKEN', TOKEN);
    vi.stubEnv('MAWAQIT_BASE_URL', 'https://staging.example/api/');

    const client = new Mawaqit();

    expect(client.token).toBe(TOKEN);
    expect(client.baseURL).toBe('https://staging.example/api');
  });

  test('options override the environment', () => {
    vi.stubEnv('MAWAQIT_TOKEN', 'from-environment');
    vi.stubEnv('MAWAQIT_BASE_URL', 'https://staging.example/api');

    const client = new Mawaqit({ token: TOKEN, baseURL: 'https://local.test/api' });

    expect(client.token).toBe(TOKEN);
    expect(client.baseURL).toBe('https://local.test/api');
  });

  test('without process, like in browsers', () => {
    vi.stubGlobal('process', undefined);

    expect(new Mawaqit().token).toBeUndefined();
  });

  test('when the environment cannot be read, like in Deno without permission', () => {
    vi.stubGlobal('process', {
      get env(): never {
        throw new Error('Requires env access');
      },
    });

    expect(new Mawaqit().token).toBeUndefined();
  });

  test.each([-1, 1.5, Number.NaN])('invalid maxRetries %s', (maxRetries) => {
    expect(() => new Mawaqit({ maxRetries })).toThrow(RangeError);
  });

  test.each([0, -1, Number.NaN])('invalid timeout %s', (timeout) => {
    expect(() => new Mawaqit({ timeout })).toThrow(RangeError);
  });

  test('inspecting the client hides the token', () => {
    const client = new Mawaqit({ token: TOKEN });

    expect(inspect(client, { depth: 5 })).not.toContain(TOKEN);
    expect(JSON.stringify(client)).not.toContain(TOKEN);
  });

  test('withOptions', async () => {
    const { client, requests } = mockAPI([json([])]);

    const copy = client.withOptions({ token: 'other', timeout: 5_000, maxRetries: 0 });
    await copy.mosques.search({ word: 'paris' });

    expect(copy).toBeInstanceOf(Mawaqit);
    expect([copy.token, copy.timeout, copy.maxRetries]).toEqual(['other', 5_000, 0]);
    expect(copy.baseURL).toBe(client.baseURL);
    // The copy shares the fetch function of the client.
    expect(requests).toHaveLength(1);
    expect(client.withOptions({ token: undefined }).token).toBe(TOKEN);
  });
});

describe('requests', () => {
  test('headers', async () => {
    const { client, requests } = mockAPI([json(HIJRI_SETTINGS)]);

    await client.mosques.hijriSettings(UUID);

    const [request] = requests;
    expect(request?.headers.get('Api-Access-Token')).toBe(TOKEN);
    expect(request?.headers.get('Accept')).toBe('application/json');
    expect(request?.headers.get('User-Agent')).toBe(`mawaqit-js/${VERSION}`);
    expect(request?.headers.has('Authorization')).toBe(false);
  });

  test('no User-Agent in browsers', async () => {
    vi.stubGlobal('document', {});
    const { client, requests } = mockAPI([json(HIJRI_SETTINGS)]);

    await client.mosques.hijriSettings(UUID);

    expect(requests[0]?.headers.has('User-Agent')).toBe(false);
  });

  test('redirects are not followed, to keep the token on MAWAQIT', async () => {
    const { client, requests } = mockAPI([json(HIJRI_SETTINGS)]);

    await client.mosques.hijriSettings(UUID);

    expect(requests[0]?.init.redirect).toBe('manual');
  });

  test('public operation without token', async () => {
    const { client, requests } = mockAPI([json([])], { token: undefined });

    expect(await client.mosques.search({ word: 'paris' })).toEqual([]);
    expect(requests[0]?.headers.has('Api-Access-Token')).toBe(false);
  });

  test('missing token', async () => {
    const { client, requests } = mockAPI([], { token: undefined });

    await expect(client.mosques.prayerTimes(UUID)).rejects.toThrow(
      new MawaqitError('No API token: pass `token` or set MAWAQIT_TOKEN.'),
    );
    expect(requests).toHaveLength(0);
  });

  test.each([
    ['imam@example.com', 's3cr:t', 'aW1hbUBleGFtcGxlLmNvbTpzM2NyOnQ='],
    ['imam@example.com', 'mosquée', 'aW1hbUBleGFtcGxlLmNvbTptb3NxdcOpZQ=='],
  ])('basic auth of %s:%s', async (email, password, credentials) => {
    const { client, requests } = mockAPI([json(ACCOUNT)], { token: undefined });

    const account = await client.auth.login({ email, password });

    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url.pathname).toBe('/api/2.0/me');
    expect(request?.headers.get('Authorization')).toBe(`Basic ${credentials}`);
    expect(request?.headers.has('Api-Access-Token')).toBe(false);
    expect(account.apiAccessToken).toBe(TOKEN);
  });

  test('path parameters are encoded', async () => {
    const { client, requests } = mockAPI([json(HIJRI_SETTINGS)]);

    await client.mosques.hijriSettings('../../2.0/me');

    expect(requests[0]?.url.pathname).toBe('/api/3.0/mosque/..%2F..%2F2.0%2Fme/hijri-date');
  });

  test.each(['', '.', '..'])('path parameter %j', async (uuid) => {
    const { client, requests } = mockAPI([]);

    await expect(client.mosques.prayerTimes(uuid)).rejects.toThrow(
      new TypeError(`uuid cannot be ${JSON.stringify(uuid)}.`),
    );
    expect(requests).toHaveLength(0);
  });

  test('number path parameters', async () => {
    const { client, requests } = mockAPI([json({})]);

    await client.mosques.get(256);

    expect(requests[0]?.url.pathname).toBe('/api/3.0/mosque/256');
  });

  test('query is encoded', async () => {
    const { client, requests } = mockAPI([json([])]);

    await client.mosques.search({ word: 'mosquée & école', page: 2 });

    // The "&" of the word must not split it into two parameters.
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      word: 'mosquée & école',
      page: '2',
    });
  });

  test('base URL of the requests', async () => {
    vi.stubEnv('MAWAQIT_BASE_URL', 'https://staging.example/api/');
    const { client, requests } = mockAPI([json([]), json([])], { baseURL: undefined });

    await client.mosques.search({ word: 'paris' });
    await client.withOptions({ baseURL: 'https://mawaqit.test/api' }).mosques.search({ word: 'x' });

    expect(requests.map((r) => r.url.origin + r.url.pathname)).toEqual([
      'https://staging.example/api/2.0/mosque/search',
      'https://mawaqit.test/api/2.0/mosque/search',
    ]);
  });

  test('the global fetch by default', async () => {
    const fetch = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetch);

    await new Mawaqit().mosques.search({ word: 'paris' });

    expect(fetch).toHaveBeenCalledOnce();
  });

  test('invalid request options', async () => {
    const { client } = mockAPI([]);

    await expect(client.mosques.search({ word: 'x' }, { maxRetries: -1 })).rejects.toThrow(
      RangeError,
    );
    await expect(client.mosques.search({ word: 'x' }, { timeout: 0 })).rejects.toThrow(RangeError);
  });
});

describe('logs', () => {
  function logger(): Logger & { lines: string[] } {
    const lines: string[] = [];
    const log = (level: string) => (message: string) => lines.push(`${level} ${message}`);
    return {
      lines,
      error: log('error'),
      warn: log('warn'),
      info: log('info'),
      debug: log('debug'),
    };
  }

  test('responses at debug level, without the query or the token', async () => {
    const output = logger();
    const { client } = mockAPI([json([])], { logger: output, logLevel: 'debug' });

    await client.mosques.search({ word: 'secret words' });

    expect(output.lines).toEqual(['debug [mawaqit] GET /api/2.0/mosque/search: HTTP 200']);
  });

  test('silent by default', async () => {
    const output = logger();
    const { client } = mockAPI([json([])], { logger: output, logLevel: undefined });

    await client.mosques.search({ word: 'paris' });

    expect(output.lines).toEqual([]);
  });

  test.each([
    ['debug', 1],
    ['info', 0],
    ['nonsense', 0],
  ])('MAWAQIT_LOG=%s', async (level, count) => {
    vi.stubEnv('MAWAQIT_LOG', level);
    const output = logger();
    const { client } = mockAPI([json([])], { logger: output, logLevel: undefined });

    await client.mosques.search({ word: 'paris' });

    expect(output.lines).toHaveLength(count);
  });

  test('console by default', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { client } = mockAPI([json([])], { logLevel: 'debug' });

    await client.mosques.search({ word: 'paris' });

    expect(debug).toHaveBeenCalledOnce();
  });
});
