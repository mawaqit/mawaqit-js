import {
  APIConnectionError,
  APITimeoutError,
  InternalServerError,
  type Logger,
  type Mawaqit,
  NotFoundError,
  RateLimitError,
} from '@mawaqit/sdk';
import { describe, expect, test, vi } from 'vitest';
import { json, mockAPI, type SentRequest, TOKEN, withFakeTimers } from './helpers.ts';

function search(client: Mawaqit, signal?: AbortSignal): Promise<unknown> {
  return withFakeTimers(() => client.mosques.search({ word: 'paris' }, { signal }));
}

/** The waits between the requests, in milliseconds. */
function delays(requests: SentRequest[]): number[] {
  return requests.slice(1).map((request, i) => request.time - (requests[i]?.time ?? 0));
}

describe('temporary errors', () => {
  test.each([408, 429, 500, 502, 503, 504])('HTTP %i is retried', async (status) => {
    const { client, requests } = mockAPI([
      new Response(null, { status }),
      new Response(null, { status }),
      json([]),
    ]);

    expect(await search(client)).toEqual([]);

    expect(requests).toHaveLength(3);
    // Exponential backoff with up to 25 % of jitter.
    const [first, second] = delays(requests);
    expect(first).toBeGreaterThanOrEqual(375);
    expect(first).toBeLessThanOrEqual(500);
    expect(second).toBeGreaterThanOrEqual(750);
    expect(second).toBeLessThanOrEqual(1000);
  });

  test('jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const replies = Array.from({ length: 6 }, () => new Response(null, { status: 503 }));
    const { client, requests } = mockAPI([...replies, json([])], { maxRetries: 6 });

    await search(client);

    // Up to 8 seconds.
    expect(delays(requests)).toEqual([375, 750, 1500, 3000, 6000, 6000]);
  });

  test('gives up after maxRetries', async () => {
    const { client, requests } = mockAPI([
      new Response(null, { status: 503 }),
      new Response(null, { status: 503 }),
      new Response(null, { status: 503 }),
    ]);

    await expect(search(client)).rejects.toThrow(InternalServerError);
    expect(requests).toHaveLength(3);
  });

  test('other errors are not retried', async () => {
    const { client, requests } = mockAPI([new Response(null, { status: 404 })]);

    await expect(search(client)).rejects.toThrow(NotFoundError);
    expect(requests).toHaveLength(1);
  });

  test('without retries', async () => {
    const { client, requests } = mockAPI([new Response(null, { status: 503 })], {
      maxRetries: 0,
    });

    await expect(search(client)).rejects.toThrow(InternalServerError);
    expect(requests).toHaveLength(1);
  });

  test('maxRetries of a request', async () => {
    const { client, requests } = mockAPI([new Response(null, { status: 503 })]);

    await expect(
      withFakeTimers(() => client.mosques.search({ word: 'paris' }, { maxRetries: 0 })),
    ).rejects.toThrow(InternalServerError);
    expect(requests).toHaveLength(1);
  });
});

describe('Retry-After', () => {
  test.each([
    ['2', 2000],
    ['0.5', 500],
    [' 3 ', 3000],
    ['Sat, 03 Oct 2026 12:00:30 GMT', 30_000],
  ])('%j', async (retryAfter, delay) => {
    vi.setSystemTime('2026-10-03T12:00:00Z');
    const { client, requests } = mockAPI([
      new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }),
      json([]),
    ]);

    await search(client);

    expect(delays(requests)).toEqual([delay]);
  });

  test.each(['', 'soon', '-1', 'Mon, 01 Jan 2001 00:00:00 GMT'])(
    'unusable %j is ignored',
    async (retryAfter) => {
      const { client, requests } = mockAPI([
        new Response(null, { status: 503, headers: { 'Retry-After': retryAfter } }),
        json([]),
      ]);

      await search(client);

      const [delay] = delays(requests);
      expect(delay).toBeGreaterThanOrEqual(375);
      expect(delay).toBeLessThanOrEqual(500);
    },
  );

  test.each(['61', '3600'])('gives up when asked to wait %s seconds', async (retryAfter) => {
    const { client, requests } = mockAPI([
      new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }),
    ]);

    await expect(search(client)).rejects.toThrow(RateLimitError);
    expect(requests).toHaveLength(1);
  });
});

describe('network errors', () => {
  test('are retried', async () => {
    const { client, requests } = mockAPI([new TypeError('fetch failed'), json([])]);

    expect(await search(client)).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  test('throw APIConnectionError, caused by the error of fetch', async () => {
    const cause = new TypeError('fetch failed');
    const { client, requests } = mockAPI([cause, cause, cause]);

    const error = await search(client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APIConnectionError);
    expect(error).not.toBeInstanceOf(APITimeoutError);
    expect(error).toMatchObject({ message: 'Could not reach MAWAQIT.', body: undefined, cause });
    expect(requests).toHaveLength(3);
  });
});

describe('timeouts', () => {
  /** A reply that never comes, until the request is aborted. */
  const never = (init: RequestInit): Promise<Response> =>
    new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });

  test('throw APITimeoutError after each attempt times out', async () => {
    const { client, requests } = mockAPI([never, never, never], { timeout: 1_000 });

    const error = await search(client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APITimeoutError);
    expect(error).toMatchObject({ message: 'MAWAQIT did not answer in time.' });
    expect(requests).toHaveLength(3);
  });

  test('a timeout is retried', async () => {
    const { client, requests } = mockAPI([never, json([])]);

    expect(await search(client)).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  test('cover the body of the response', async () => {
    const slowBody = (init: RequestInit): Promise<Response> => {
      const body = new ReadableStream({
        start(controller): void {
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
        },
      });
      return Promise.resolve(new Response(body));
    };
    const { client } = mockAPI([slowBody], { timeout: 1_000, maxRetries: 0 });

    await expect(search(client)).rejects.toThrow(APITimeoutError);
  });

  test('timeout of a request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { client, requests } = mockAPI([never, json([])]);

    await withFakeTimers(() => client.mosques.search({ word: 'paris' }, { timeout: 2_000 }));

    // The timeout, then the wait before the retry.
    expect(delays(requests)).toEqual([2_500]);
  });
});

describe('abort', () => {
  test('before the request', async () => {
    const { client, requests } = mockAPI([]);
    const reason = new Error('cancelled');

    await expect(search(client, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(requests).toHaveLength(0);
  });

  test('during the request, which is not retried', async () => {
    const controller = new AbortController();
    const { client, requests } = mockAPI([
      (init) => {
        controller.abort();
        return Promise.reject(init.signal?.reason);
      },
    ]);

    const error = await search(client, controller.signal).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);
  });

  test('during the wait before a retry', async () => {
    const controller = new AbortController();
    const { client, requests } = mockAPI([
      () => {
        setTimeout(() => controller.abort(), 100);
        return Promise.resolve(new Response(null, { status: 503 }));
      },
    ]);

    await expect(search(client, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);
  });

  test('listeners are removed', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const { client } = mockAPI([new Response(null, { status: 503 }), json([])]);

    await search(client, controller.signal);

    expect(add).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
  });
});

test('logs', async () => {
  const lines: string[] = [];
  const log = (message: string): number => lines.push(message);
  const logger: Logger = { error: log, warn: log, info: log, debug: log };
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const { client } = mockAPI(
    [new TypeError('fetch failed'), new Response(null, { status: 503 }), json([])],
    { logger, logLevel: 'debug' },
  );

  await search(client);

  expect(lines).toEqual([
    '[mawaqit] Retrying GET /api/2.0/mosque/search in 0.5 s after a network error',
    '[mawaqit] GET /api/2.0/mosque/search: HTTP 503',
    '[mawaqit] Retrying GET /api/2.0/mosque/search in 1.0 s after HTTP 503',
    '[mawaqit] GET /api/2.0/mosque/search: HTTP 200',
  ]);
  expect(lines.join()).not.toContain(TOKEN);
});
