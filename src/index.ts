/**
 * The official TypeScript library for the MAWAQIT API.
 *
 * ```ts
 * import { Mawaqit } from '@mawaqit/sdk';
 * import { today } from '@mawaqit/sdk/hijri';
 *
 * const client = new Mawaqit({ token: '...' });
 * const [mosque] = await client.mosques.search({ lat: 48.8414, lon: 2.3557 });
 * if (mosque) {
 *   const settings = await client.mosques.hijriSettings(mosque.uuid);
 *   console.log(String(today(settings, 'Europe/Paris')));
 * }
 * ```
 *
 * @module
 */

export { Mawaqit } from './client.ts';
export {
  APIClient,
  type ClientOptions,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  type Fetch,
  type Logger,
  type LogLevel,
  type RequestOptions,
} from './core.ts';
export {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  type FailedRequest,
  InternalServerError,
  MawaqitError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from './errors.ts';
export * from './resources/index.ts';
export type * from './types.ts';
export { VERSION } from './version.ts';
