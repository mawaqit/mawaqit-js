import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  MawaqitError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@mawaqit/sdk';
import { describe, expect, test } from 'vitest';
import { json, mockAPI, UUID } from './helpers.ts';

const PRAYER_TIMES = `/api/2.0/mosque/${UUID}/prayer-times`;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error.');
}

describe('status errors', () => {
  test.each([
    [302, APIStatusError],
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [409, APIStatusError],
    [429, RateLimitError],
    [500, InternalServerError],
    [502, InternalServerError],
  ])('HTTP %i', async (status, ErrorClass) => {
    const body = { message: 'Invalid token.', code: status };
    const { client } = mockAPI([json(body, { status, headers: { 'X-Test': 'yes' } })], {
      maxRetries: 0,
    });

    const error = await caught(client.mosques.prayerTimes(UUID));

    expect(error).toBeInstanceOf(ErrorClass);
    expect((error as object).constructor).toBe(ErrorClass);
    const statusError = error as APIStatusError;
    expect(statusError.name).toBe(ErrorClass.name);
    expect(statusError.message).toBe(`Invalid token. (HTTP ${status})`);
    expect(statusError.status).toBe(status);
    expect(statusError.headers.get('X-Test')).toBe('yes');
    expect(statusError.body).toEqual(body);
    expect(statusError.request.method).toBe('GET');
    expect(new URL(statusError.request.url).pathname).toBe(PRAYER_TIMES);
  });

  test('with an HTML page', async () => {
    const { client } = mockAPI([new Response('<p>error401</p>', { status: 401 })]);

    const error = (await caught(client.mosques.prayerTimes(UUID))) as AuthenticationError;

    expect(error.message).toBe('Unauthorized (HTTP 401)');
    expect(error.body).toBe('<p>error401</p>');
  });

  test.each([
    [{ message: '' }, 404, '', 'Not Found (HTTP 404)'],
    [{ message: 42 }, 404, 'Gone Fishing', 'Gone Fishing (HTTP 404)'],
    [['message'], 418, '', 'Unknown error (HTTP 418)'],
    [null, 503, '', 'Service Unavailable (HTTP 503)'],
  ])('without a message: %j', async (body, status, statusText, message) => {
    const { client } = mockAPI([json(body, { status, statusText })], { maxRetries: 0 });

    await expect(client.mosques.prayerTimes(UUID)).rejects.toThrow(message);
  });
});

test('response that is not JSON', async () => {
  const { client } = mockAPI([new Response('maintenance')]);

  const error = (await caught(client.mosques.prayerTimes(UUID))) as APIResponseValidationError;

  expect(error).toBeInstanceOf(APIResponseValidationError);
  expect(error.message).toBe('MAWAQIT did not answer with JSON.');
  expect(error.body).toBe('maintenance');
  expect(error.status).toBe(200);
  expect(error.headers).toBeInstanceOf(Headers);
  expect(error.cause).toBeInstanceOf(SyntaxError);
});

test('hierarchy', () => {
  for (const ErrorClass of [
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
  ]) {
    expect(ErrorClass.prototype).toBeInstanceOf(APIStatusError);
  }
  expect(APITimeoutError.prototype).toBeInstanceOf(APIConnectionError);
  for (const ErrorClass of [APIStatusError, APIConnectionError, APIResponseValidationError]) {
    expect(ErrorClass.prototype).toBeInstanceOf(APIError);
  }
  expect(APIError.prototype).toBeInstanceOf(MawaqitError);
  expect(MawaqitError.prototype).toBeInstanceOf(Error);
});

test('stack traces start with the name of the error', async () => {
  const { client } = mockAPI([json({ message: 'No mosque.' }, { status: 404 })]);

  const error = (await caught(client.mosques.prayerTimes(UUID))) as NotFoundError;

  expect(error.stack).toMatch(/^NotFoundError: No mosque\. \(HTTP 404\)\n/);
  expect(String(error)).toBe('NotFoundError: No mosque. (HTTP 404)');
});
