# Changelog

All notable changes to this library. It follows [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- `@mawaqit/sdk/prayer-times`: `prayerDay()`, the prayers of a day with their instants, iqama,
  Imsak and Jumu'a; `nextPrayer()`; and `night()`, the thirds of the night.

## 1.0.0-beta.1 - 2026-10-05

The first release, with the operations, errors, retries and Hijri dates of mawaqit-py 2.0.0.

### Added

- `Mawaqit`, the client: `client.mosques.search()`, `get()`, `prayerTimes()`, `hijriSettings()`,
  `config()` and `flashMessage()`, and `client.auth.login()`.
- `@mawaqit/sdk/hijri`: the Hijri date of a mosque, computed like the MAWAQIT apps.
