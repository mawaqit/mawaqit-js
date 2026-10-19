# Changelog

All notable changes to this library. It follows [Semantic Versioning](https://semver.org).

## Unreleased

## 1.4.0 - 2026-10-19

### Added

- `eventName(event, language)`: the name of an Islamic event in Arabic, English, French, German or
  Turkish, like `Aïd al-Adha` or `Kurban Bayramı`, from a language or a language tag like `fr-FR`.
  Other languages get the English name.

## 1.3.0 - 2026-10-19

### Added

- `monthName(month, language)`: the name of a Hijri month in Arabic, French, German or Turkish,
  as on the MAWAQIT website, from a language or a language tag like `fr-FR`. Other languages
  get the English name, as before.
- `upcomingEvents(settings, timeZone)`: the next day of the Islamic new year, Ashura, Ramadan,
  Eid al-Fitr, Arafah and Eid al-Adha at a mosque, with its Hijri date and the days until it.

### Changed

- The docs of `client.mosques.hijriSettings()` no longer say that `prayerTimes()` lags behind:
  the API refreshes their cache together since 30 September 2026 (mawaqit/api-spec v0.5.3).

### Fixed

- An adjustment outside -2 to 2 counts as 0. The API returns -3 for a French mosque that has not
  chosen its adjustment yet, so its Hijri date was 3 days early.

## 1.2.1 - 2026-10-14

### Fixed

- `MosqueConfig.backgroundUrl` is optional: the API leaves it out when the screens of the mosque
  have a background color.

## 1.2.0 - 2026-10-08

### Added

- `nextPrayer(prayerTimes, { prayer })`: the next time of one prayer, like the next Maghrib for
  iftar, or the next Jumu'a. It looks up to a week ahead.

## 1.1.0 - 2026-10-08

### Added

- `client.hadiths.random()`: a random hadith in a language, as the mosque screens show it, or
  `null` when none is shorter than `maxLength`. It needs no API token.

### Fixed

- `client.mosques.search()` sends the API token: the API has answered 401 without one since
  6 October 2026, so the search failed with an `AuthenticationError`.

## 1.0.0 - 2026-10-05

The first stable release, with the changes of the betas below and these fixes.

### Fixed

- A time entered by mistake earlier than the prayer before it, like 16:30 for Fajr, moved
  the following prayers of the day to the next day. Only an Isha before Maghrib is now after
  midnight, and only within 12 hours of Maghrib.
- `GregorianDay` was missing from the types of `@mawaqit/sdk/hijri` and
  `@mawaqit/sdk/prayer-times`: TypeScript reported an error with `skipLibCheck: false`, and
  treated it as `any` otherwise. The CI now typechecks the built types.

## 1.0.0-beta.2 - 2026-10-05

### Added

- `@mawaqit/sdk/prayer-times`: `prayerDay()`, the prayers of a day with their instants, iqama,
  Imsak and Jumu'a; `nextPrayer()`; and `night()`, the thirds of the night.

## 1.0.0-beta.1 - 2026-10-05

The first release, with the operations, errors, retries and Hijri dates of mawaqit-py 2.0.0.

### Added

- `Mawaqit`, the client: `client.mosques.search()`, `get()`, `prayerTimes()`, `hijriSettings()`,
  `config()` and `flashMessage()`, and `client.auth.login()`.
- `@mawaqit/sdk/hijri`: the Hijri date of a mosque, computed like the MAWAQIT apps.
