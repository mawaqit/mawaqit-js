import { readFileSync } from 'node:fs';
import * as sdk from '@mawaqit/sdk';
import * as hijri from '@mawaqit/sdk/hijri';
import { expect, test } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

test('the version is the one of package.json', () => {
  expect(sdk.VERSION).toBe(pkg.version);
});

test('the public API', () => {
  expect(Object.keys(sdk).sort()).toEqual([
    'APIClient',
    'APIConnectionError',
    'APIError',
    'APIResponseValidationError',
    'APIStatusError',
    'APITimeoutError',
    'Auth',
    'AuthenticationError',
    'BadRequestError',
    'DEFAULT_BASE_URL',
    'DEFAULT_MAX_RETRIES',
    'DEFAULT_TIMEOUT',
    'InternalServerError',
    'Mawaqit',
    'MawaqitError',
    'Mosques',
    'NotFoundError',
    'PermissionDeniedError',
    'RateLimitError',
    'VERSION',
  ]);
  expect(Object.keys(hijri).sort()).toEqual([
    'HijriDate',
    'HijriMonth',
    'fromGregorian',
    'kuwaiti',
    'monthName',
    'today',
  ]);
});
