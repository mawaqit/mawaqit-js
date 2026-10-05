/**
 * The transport of the client: requests, authentication, retries and errors.
 *
 * @module
 */

import {
  APIConnectionError,
  APIResponseValidationError,
  APITimeoutError,
  type FailedRequest,
  MawaqitError,
  statusError,
} from './errors.ts';
import { VERSION } from './version.ts';

/** The URL of the API. */
export const DEFAULT_BASE_URL = 'https://mawaqit.net/api';
/** The timeout of each attempt of a request, in milliseconds. */
export const DEFAULT_TIMEOUT = 30_000;
/** How many times a failed request is retried. */
export const DEFAULT_MAX_RETRIES = 2;

const INITIAL_RETRY_DELAY = 500;
const MAX_RETRY_DELAY = 8_000;
const MAX_RETRY_AFTER = 60_000;
const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const TOKEN_HEADER = 'Api-Access-Token';
const LOG_LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;

/** A `fetch` function: the global one, or one of your own. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** How much the client logs. */
export type LogLevel = keyof typeof LOG_LEVELS;

/** Where the client logs: `console` by default, or a logger like pino or winston. */
export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

/** The options of a client. */
export interface ClientOptions {
  /**
   * API token of a MAWAQIT account. Defaults to the `MAWAQIT_TOKEN` environment variable. Only
   * `client.mosques.search()` works without it.
   */
  token?: string | undefined;
  /**
   * URL of the API. Defaults to the `MAWAQIT_BASE_URL` environment variable, then to
   * `https://mawaqit.net/api`.
   */
  baseURL?: string | undefined;
  /** Timeout of each attempt of a request, in milliseconds. 30 seconds by default. */
  timeout?: number | undefined;
  /**
   * How many times a request is retried after a network error, a timeout or a temporary error of
   * the API. 2 by default.
   */
  maxRetries?: number | undefined;
  /** The `fetch` function that sends the requests. The global `fetch` by default. */
  fetch?: Fetch | undefined;
  /** Where to log. `console` by default. */
  logger?: Logger | undefined;
  /**
   * How much to log: responses are logged at `debug`, retries at `info`. Defaults to the
   * `MAWAQIT_LOG` environment variable, then to `warn`. The token is never logged.
   */
  logLevel?: LogLevel | undefined;
}

/** The options of a single request, which override those of the client. */
export interface RequestOptions {
  /** Timeout of each attempt of the request, in milliseconds. */
  timeout?: number | undefined;
  /** How many times the request is retried. */
  maxRetries?: number | undefined;
  /** Cancels the request, and the waits between its attempts. */
  signal?: AbortSignal | undefined;
}

/** @internal An operation of the API, as the generated resources describe it. */
export interface Operation {
  readonly method: 'GET' | 'POST';
  /** The path, with `{name}` placeholders for the path parameters. */
  readonly path: string;
  readonly pathParams?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly basicAuth?: readonly [username: string, password: string];
  /** Whether the operation needs the API token. */
  readonly authenticated: boolean;
}

type Attempt = { response: Response; text: string } | { error: APIConnectionError };

// Rejects with a reason we can tell apart from an abort of the caller.
const TIMED_OUT: unique symbol = Symbol('timed out');

/** The client of the API, without its resources. */
export abstract class APIClient {
  /** The URL of the API. */
  readonly baseURL: string;
  /** The timeout of each attempt of a request, in milliseconds. */
  readonly timeout: number;
  /** How many times a failed request is retried. */
  readonly maxRetries: number;
  readonly #token: string | undefined;
  readonly #fetch: Fetch;
  readonly #logger: Logger;
  readonly #logLevel: LogLevel;

  /**
   * Create a client.
   *
   * @throws {RangeError} `timeout` or `maxRetries` is invalid.
   */
  constructor(options: ClientOptions = {}) {
    this.#token = options.token || readEnv('MAWAQIT_TOKEN');
    this.baseURL = (options.baseURL || readEnv('MAWAQIT_BASE_URL') || DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    );
    this.timeout = checkTimeout(options.timeout ?? DEFAULT_TIMEOUT);
    this.maxRetries = checkMaxRetries(options.maxRetries ?? DEFAULT_MAX_RETRIES);
    // Called through a function: browsers reject a `fetch` called as a method of another object.
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#logger = options.logger ?? console;
    this.#logLevel = options.logLevel ?? readLogLevel();
  }

  /** The API token sent with the requests. */
  get token(): string | undefined {
    return this.#token;
  }

  /**
   * Return a copy of this client with other options. Options left out keep their current value.
   *
   * ```ts
   * const fast = client.withOptions({ timeout: 5_000, maxRetries: 0 });
   * ```
   */
  withOptions(options: ClientOptions): this {
    const Client = this.constructor as new (options: ClientOptions) => this;
    return new Client({
      token: this.#token,
      baseURL: this.baseURL,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      fetch: this.#fetch,
      logger: this.#logger,
      logLevel: this.#logLevel,
      ...withoutUndefined(options),
    });
  }

  /** @internal Send a request, retrying temporary failures, and return its JSON response. */
  async request<T>(operation: Operation, options: RequestOptions = {}): Promise<T> {
    const request = { method: operation.method, url: this.#url(operation) };
    const headers = this.#headers(operation);
    const timeout = checkTimeout(options.timeout ?? this.timeout);
    const maxRetries = checkMaxRetries(options.maxRetries ?? this.maxRetries);
    const { signal } = options;
    for (let retriesTaken = 0; ; retriesTaken++) {
      signal?.throwIfAborted();
      const attempt = await this.#send(request, headers, timeout, signal);
      let delay: number;
      if ('error' in attempt) {
        if (retriesTaken >= maxRetries) {
          throw attempt.error;
        }
        delay = backoff(retriesTaken);
        this.#log(
          'info',
          `Retrying ${describe(request)} in ${seconds(delay)} after a network error`,
        );
      } else {
        const { response, text } = attempt;
        this.#log('debug', `${describe(request)}: HTTP ${response.status}`);
        const retryAfter = parseRetryAfter(response.headers);
        if (
          retriesTaken >= maxRetries ||
          !RETRY_STATUSES.has(response.status) ||
          // Retrying sooner than the API asks would only fail again.
          (retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER)
        ) {
          return parse<T>(request, response, text);
        }
        delay = retryAfter ?? backoff(retriesTaken);
        this.#log(
          'info',
          `Retrying ${describe(request)} in ${seconds(delay)} after HTTP ${response.status}`,
        );
      }
      await sleep(delay, signal);
    }
  }

  #url(operation: Operation): string {
    let path = operation.path;
    for (const [name, value] of Object.entries(operation.pathParams ?? {})) {
      const text = String(value);
      // URLs resolve `.` and `..` segments, even encoded: they would change the path.
      if (text === '' || text === '.' || text === '..') {
        throw new TypeError(`${name} cannot be ${JSON.stringify(text)}.`);
      }
      path = path.replace(`{${name}}`, encodeURIComponent(text));
    }
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(operation.query ?? {})) {
      if (value !== undefined) {
        query.set(name, String(value));
      }
    }
    const search = query.toString();
    return `${this.baseURL}${path}${search && `?${search}`}`;
  }

  #headers(operation: Operation): Headers {
    const headers = new Headers({ Accept: 'application/json' });
    // Browsers set their own User-Agent, and Firefox would preflight every request for it.
    if (!('document' in globalThis)) {
      headers.set('User-Agent', `mawaqit-js/${VERSION}`);
    }
    if (operation.authenticated) {
      if (!this.#token) {
        throw new MawaqitError('No API token: pass `token` or set MAWAQIT_TOKEN.');
      }
      headers.set(TOKEN_HEADER, this.#token);
    }
    if (operation.basicAuth) {
      headers.set('Authorization', `Basic ${base64(operation.basicAuth.join(':'))}`);
    }
    return headers;
  }

  async #send(
    request: FailedRequest,
    headers: Headers,
    timeout: number,
    signal: AbortSignal | undefined,
  ): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(TIMED_OUT), timeout);
    const abort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.#fetch(request.url, {
        method: request.method,
        headers,
        // A redirect to another site would carry the token there.
        redirect: 'manual',
        signal: controller.signal,
      });
      // Inside the timeout: the body can be slow too.
      return { response, text: await response.text() };
    } catch (cause) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      const error =
        controller.signal.reason === TIMED_OUT
          ? new APITimeoutError(request, { cause })
          : new APIConnectionError(request, { cause });
      return { error };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  #log(level: Exclude<LogLevel, 'off'>, message: string): void {
    if (LOG_LEVELS[level] <= LOG_LEVELS[this.#logLevel]) {
      this.#logger[level](`[mawaqit] ${message}`);
    }
  }
}

function parse<T>(request: FailedRequest, response: Response, text: string): T {
  if (!response.ok) {
    throw statusError(request, response, text);
  }
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new APIResponseValidationError(
      'MAWAQIT did not answer with JSON.',
      request,
      response,
      text,
      {
        cause,
      },
    );
  }
}

/** Return the delay asked by a `Retry-After` header in milliseconds, if it has a valid one. */
function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get('Retry-After')?.trim();
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  const delay = Number.isNaN(seconds) ? Date.parse(value) - Date.now() : seconds * 1000;
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

function backoff(retriesTaken: number): number {
  const delay = Math.min(INITIAL_RETRY_DELAY * 2 ** retriesTaken, MAX_RETRY_DELAY);
  return delay * (1 - 0.25 * Math.random());
}

function sleep(delay: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function describe(request: FailedRequest): string {
  // The path only: the query has the words searched by the user.
  return `${request.method} ${new URL(request.url).pathname}`;
}

function seconds(delay: number): string {
  return `${(delay / 1000).toFixed(1)} s`;
}

function base64(text: string): string {
  // `btoa` alone fails on characters outside Latin-1, like in some passwords.
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function checkTimeout(timeout: number): number {
  if (!(timeout > 0)) {
    throw new RangeError(`timeout must be positive, not ${timeout}.`);
  }
  return timeout;
}

function checkMaxRetries(maxRetries: number): number {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(`maxRetries must be an integer of 0 or more, not ${maxRetries}.`);
  }
  return maxRetries;
}

function readEnv(name: string): string | undefined {
  // `process` is missing in browsers, and Deno can deny access to the environment.
  try {
    const { process } = globalThis as { process?: { env?: Record<string, string | undefined> } };
    return process?.env?.[name]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readLogLevel(): LogLevel {
  const level = readEnv('MAWAQIT_LOG');
  return level && level in LOG_LEVELS ? (level as LogLevel) : 'warn';
}

function withoutUndefined<T extends object>(options: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
