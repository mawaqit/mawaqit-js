/**
 * The errors thrown by the client.
 *
 * Every error extends {@link MawaqitError}, so a single `instanceof` check catches them all:
 *
 * ```ts
 * try {
 *   await client.mosques.prayerTimes(uuid);
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     // No mosque has this UUID.
 *   } else if (error instanceof MawaqitError) {
 *     console.error(error.message); // Invalid token. (HTTP 401)
 *   }
 * }
 * ```
 *
 * @module
 */

/** The request that failed: its method and URL. */
export interface FailedRequest {
  readonly method: string;
  readonly url: string;
}

/** Base class of every error thrown by this library. */
export class MawaqitError extends Error {
  override readonly name: string = 'MawaqitError';
}

/** A request to the MAWAQIT API failed. */
export class APIError extends MawaqitError {
  override readonly name: string = 'APIError';
  /** The request that failed. */
  readonly request: FailedRequest;
  /**
   * The decoded JSON body of the response, its text when it is not JSON, or `undefined` without
   * a response.
   */
  readonly body: unknown;

  constructor(message: string, request: FailedRequest, body: unknown, options?: ErrorOptions) {
    super(message, options);
    this.request = request;
    this.body = body;
  }
}

/** The API could not be reached. The original error is the `cause`. */
export class APIConnectionError extends APIError {
  override readonly name: string = 'APIConnectionError';

  constructor(
    request: FailedRequest,
    options?: ErrorOptions,
    message = 'Could not reach MAWAQIT.',
  ) {
    super(message, request, undefined, options);
  }
}

/** The API did not answer in time. */
export class APITimeoutError extends APIConnectionError {
  override readonly name: string = 'APITimeoutError';

  constructor(request: FailedRequest, options?: ErrorOptions) {
    super(request, options, 'MAWAQIT did not answer in time.');
  }
}

/** The API answered with a body that is not JSON. */
export class APIResponseValidationError extends APIError {
  override readonly name: string = 'APIResponseValidationError';
  /** The HTTP status code of the response. */
  readonly status: number;
  /** The headers of the response. */
  readonly headers: Headers;

  constructor(
    message: string,
    request: FailedRequest,
    response: Response,
    body: unknown,
    options?: ErrorOptions,
  ) {
    super(message, request, body, options);
    this.status = response.status;
    this.headers = response.headers;
  }
}

/** The API answered with an error status code. */
export class APIStatusError<TStatus extends number = number> extends APIError {
  override readonly name: string = 'APIStatusError';
  /** The HTTP status code of the response. */
  readonly status: TStatus;
  /** The headers of the response. */
  readonly headers: Headers;

  constructor(message: string, request: FailedRequest, response: Response, body: unknown) {
    super(`${message} (HTTP ${response.status})`, request, body);
    this.status = response.status as TStatus;
    this.headers = response.headers;
  }
}

/** The API rejected the request as invalid (HTTP 400). */
export class BadRequestError extends APIStatusError<400> {
  override readonly name: string = 'BadRequestError';
}

/** The API token, or the email and password, are wrong (HTTP 401). */
export class AuthenticationError extends APIStatusError<401> {
  override readonly name: string = 'AuthenticationError';
}

/** The account used all its API calls, or the request was blocked (HTTP 403). */
export class PermissionDeniedError extends APIStatusError<403> {
  override readonly name: string = 'PermissionDeniedError';
}

/** The resource does not exist (HTTP 404). */
export class NotFoundError extends APIStatusError<404> {
  override readonly name: string = 'NotFoundError';
}

/** Too many requests were sent (HTTP 429). */
export class RateLimitError extends APIStatusError<429> {
  override readonly name: string = 'RateLimitError';
}

/** The API failed to answer (HTTP 500 and above). */
export class InternalServerError extends APIStatusError {
  override readonly name: string = 'InternalServerError';
}

const STATUS_ERRORS: Readonly<Record<number, typeof APIStatusError<number>>> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  429: RateLimitError,
};

// HTTP/2 responses have no reason phrase.
const REASONS: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** @internal Return the error matching the status code of an error response. */
export function statusError(
  request: FailedRequest,
  response: Response,
  text: string,
): APIStatusError {
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: keep the text, like the HTML page of a missing token.
  }
  const message =
    readMessage(body) ?? (response.statusText || REASONS[response.status] || 'Unknown error');
  const ErrorClass =
    response.status >= 500
      ? InternalServerError
      : (STATUS_ERRORS[response.status] ?? APIStatusError);
  return new ErrorClass(message, request, response, body);
}

function readMessage(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return undefined;
}
