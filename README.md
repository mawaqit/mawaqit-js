# MAWAQIT TypeScript library

[![CI](https://github.com/mawaqit/mawaqit-js/actions/workflows/ci.yml/badge.svg)](https://github.com/mawaqit/mawaqit-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@mawaqit/sdk)](https://www.npmjs.com/package/@mawaqit/sdk)
[![License](https://img.shields.io/npm/l/@mawaqit/sdk)](https://github.com/mawaqit/mawaqit-js/blob/main/LICENSE)

> [!CAUTION]
> **Use of the MAWAQIT API is not authorized outside of the official MAWAQIT applications.**
>
> This library is published for transparency and for the projects of MAWAQIT. Do not use it to
> access the API from a third-party application, script or service: the API may block such
> access without notice. Thank you for respecting this.

The official TypeScript library for the [MAWAQIT](https://mawaqit.net) API: search mosques, and
read their prayer times, iqama times, Hijri date and screen settings.

- **Fully typed**: every parameter, response and field, documented in your editor. Invalid calls,
  like a latitude without a longitude, do not compile.
- **Robust**: retries with backoff, timeouts, cancellation, and one error class per kind of
  failure.
- **Zero dependencies**: it only needs `fetch`, so it runs on Node.js, Deno, Bun, Cloudflare
  Workers and in browsers.
- **Generated from the OpenAPI description of the API**, like the
  [Python library](https://github.com/mawaqit/mawaqit-py), so the methods and types follow it
  exactly.

## Installation

```sh
npm install @mawaqit/sdk
```

Node.js 22.12 or newer, or any runtime with `fetch`. The package is ESM, and Node.js `require()`
loads it too.

## Usage

```ts
import { Mawaqit } from '@mawaqit/sdk';

const client = new Mawaqit({ token: '...' });

const [mosque] = await client.mosques.search({ lat: 48.8414, lon: 2.3557 });
if (mosque) {
  const prayerTimes = await client.mosques.prayerTimes(mosque.uuid);
  // Fajr, Shuruq, Dhuhr, Asr, Maghrib and Isha of 1 January.
  console.log(prayerTimes.calendar[0]?.['1']);
}
```

| Method | Returns |
| --- | --- |
| `client.mosques.search({ word })` or `({ lat, lon })` | A `Mosque[]` |
| `client.mosques.get(mosqueId)` | The `MosqueSummary` of a mosque or a home, with its UUID |
| `client.mosques.prayerTimes(uuid)` | The `PrayerTimes` of the year, with iqama |
| `client.mosques.hijriSettings(uuid)` | The `HijriSettings` of the mosque |
| `client.mosques.config(uuid)` | The `MosqueConfig`: the settings of the mosque screens |
| `client.mosques.flashMessage(uuid)` | The `FlashMessage` of the mosque screens, or `null` |
| `client.auth.login({ email, password })` | The `Account`, with its API token |

Responses are the JSON of the API, typed: fields keep the camelCase names of the API, like
`mosque.womenSpace`. A field that can be `null` is typed `| null`, and one that can be missing is
optional.

### Authentication

Every method but `search()` and `login()` needs an API token, passed as `token` or set in the
`MAWAQIT_TOKEN` environment variable.

### Prayer times of a day

`client.mosques.prayerTimes()` returns the times of the whole year, as the mosque entered them.
`@mawaqit/sdk/prayer-times` reads them for a day, with the instant of each prayer, the iqama
resolved, Imsak, and Jumu'a on Fridays:

```ts
import { nextPrayer, night, prayerDay } from '@mawaqit/sdk/prayer-times';

const prayerTimes = await client.mosques.prayerTimes(uuid);

const today = prayerDay(prayerTimes); // Or prayerDay(prayerTimes, '2026-10-05').
today?.fajr?.time; // '06:12', in the time zone of the mosque
today?.fajr?.at; // A Date
today?.fajr?.iqama?.time; // '06:30', even when the mosque entered '+18'
today?.jumua; // The Jumu'a prayers on Fridays, or []

const next = nextPrayer(prayerTimes); // Jumu'a instead of Dhuhr on Fridays.
if (next) {
  const minutes = Math.round((next.at.getTime() - Date.now()) / 60_000);
  console.log(`${next.name} in ${minutes} min`); // asr in 42 min
}

night(prayerTimes)?.lastThirdStart; // The thirds of the night, from Maghrib to Fajr.
```

They handle what the raw calendar leaves to you:

- Mosques that display Imsak have 7 times a day, with Sabah as Fajr.
- Iqama times are `HH:MM` or minutes after the adhan, like `+10`.
- An Isha after midnight, in summer far from the equator, belongs to the day before.
- Times are converted in the time zone of the mosque, through daylight saving time changes.
- A time entered by hand that is invalid gives a `null` prayer, rather than a wrong one.

`nextPrayer()` takes `{ now, shuruq, jumua, iqama }` options: `iqama: true` gives the next iqama
rather than the next adhan.

### Hijri date

`@mawaqit/sdk/hijri` computes the Hijri date of a mosque from its settings, like the mosque
screens and the app do:

```ts
import { HijriMonth, today } from '@mawaqit/sdk/hijri';

const settings = await client.mosques.hijriSettings(uuid);
const date = today(settings, 'Europe/Paris'); // The time zone of the mosque.
console.log(`${date}`); // 9 Ramadan 1448
if (date.month === HijriMonth.RAMADAN) {
  // ...
}
```

The date changes at midnight in the time zone of the mosque. Only today's date is reliable:
mosques change their settings after the moon sighting. `fromGregorian('2026-10-05', settings)`
gives the date of another day, from an ISO date or a `{ year, month, day }` object like a
`Temporal.PlainDate`.

### Errors

Every error extends `MawaqitError`:

| Error | When |
| --- | --- |
| `AuthenticationError` | The token is wrong (HTTP 401) |
| `PermissionDeniedError` | The account used all its API calls, or the request was blocked (HTTP 403) |
| `NotFoundError` | No mosque has this UUID (HTTP 404) |
| `RateLimitError`, `BadRequestError`, `InternalServerError` | HTTP 429, 400, 500 and above |
| `APIStatusError` | Any other error status, and base class of the ones above |
| `APIConnectionError`, `APITimeoutError` | MAWAQIT could not be reached, or did not answer in time |
| `APIResponseValidationError` | The response is not JSON |

`APIError`, their base class, has the failed `request` and the response `body`. `APIStatusError`
adds the `status` and `headers` of the response: `status` is typed `404` on a `NotFoundError`.

```ts
import { AuthenticationError, MawaqitError } from '@mawaqit/sdk';

try {
  const prayerTimes = await client.mosques.prayerTimes(uuid);
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Ask for a new token.
  } else if (error instanceof MawaqitError) {
    console.error(error.message); // Invalid token. (HTTP 401)
  }
}
```

### Retries, timeouts and cancellation

Network errors, timeouts and HTTP 408, 429, 500, 502, 503 and 504 are retried twice, after about
0.5 then 1 second, or after the delay of `Retry-After` when it is one minute or less. Each attempt
times out after 30 seconds.

```ts
const client = new Mawaqit({ token: '...', maxRetries: 5, timeout: 10_000 });
const fast = client.withOptions({ maxRetries: 0 });

// For a single request, with an AbortSignal that cancels it and its retries.
await client.mosques.prayerTimes(uuid, { timeout: 5_000, signal });
```

A cancelled request rejects with the reason of its signal, an `AbortError` by default, like
`fetch`.

### Logging

Responses are logged at the `debug` level, and retries at the `info` level, to `console` or to the
`logger` option. Set the level with the `logLevel` option or the `MAWAQIT_LOG` environment
variable: `off`, `error`, `warn` (the default), `info` or `debug`. The token is never logged.

```ts
const client = new Mawaqit({ logger: pino(), logLevel: 'debug' });
```

### Custom fetch

Pass the `fetch` of your framework, or one with a proxy:

```ts
const client = new Mawaqit({ fetch: (url, init) => fetch(url, { ...init, dispatcher: proxy }) });
```

## Versioning

This library follows [Semantic Versioning](https://semver.org). See the
[changelog](https://github.com/mawaqit/mawaqit-js/blob/main/CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](https://github.com/mawaqit/mawaqit-js/blob/main/CONTRIBUTING.md).

## License

[Apache 2.0](https://github.com/mawaqit/mawaqit-js/blob/main/LICENSE). The license covers the
code of this library, not access to the MAWAQIT API, which requires an authorization from
MAWAQIT. Questions: [support@mawaqit.net](mailto:support@mawaqit.net).
