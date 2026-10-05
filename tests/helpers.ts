import { readFileSync } from 'node:fs';
import { type ClientOptions, type Fetch, Mawaqit } from '@mawaqit/sdk';
import { vi } from 'vitest';

export const TOKEN = '00000000-0000-4000-8000-000000000000';
export const UUID = '05b4d393-fb76-4d9b-b2a4-f98ab4c4b64f';

/** Return a real API response, copied from the spec by the generator. */
export function example(operation: string, name: string): unknown {
  const url = new URL(`examples/${operation}/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

/** A request sent to the mocked API. */
export interface SentRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly init: RequestInit;
  /** When it was sent, by the clock of the tests. */
  readonly time: number;
}

/** What the mocked API does: answer, fail like a network error, or run a function. */
export type Reply = Response | Error | ((init: RequestInit) => Promise<Response>);

/**
 * Mock the API with one reply per request, in order. A request without a reply fails the test.
 */
export function mockAPI(
  replies: Reply[],
  options: ClientOptions = {},
): { client: Mawaqit; requests: SentRequest[] } {
  const requests: SentRequest[] = [];
  const fetch: Fetch = async (url, init) => {
    requests.push({
      method: init.method ?? 'GET',
      url: new URL(url),
      headers: new Headers(init.headers),
      init,
      time: Date.now(),
    });
    const reply = replies.shift();
    if (!reply) {
      throw new UnexpectedRequestError(`${init.method} ${url}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return reply instanceof Response ? reply : reply(init);
  };
  const client = new Mawaqit({ token: TOKEN, fetch, logLevel: 'off', ...options });
  return { client, requests };
}

export class UnexpectedRequestError extends Error {}

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

/** Run a call to the end with fake timers, which skip the waits between retries. */
export async function withFakeTimers<T>(call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const result = call();
    // Catch it now: the fake timers could run before the test handles it.
    result.catch(() => undefined);
    await vi.runAllTimersAsync();
    return await result;
  } finally {
    vi.useRealTimers();
  }
}
