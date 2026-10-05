# Changelog

All notable changes to this library. It follows [Semantic Versioning](https://semver.org).

## Unreleased

## 1.0.0-beta.1

The first release, with the operations, errors, retries and Hijri dates of mawaqit-py 2.0.0.

### Added

- `Mawaqit`, the client: `client.mosques.search()`, `get()`, `prayerTimes()`, `hijriSettings()`,
  `config()` and `flashMessage()`, and `client.auth.login()`.
- `@mawaqit/sdk/hijri`: the Hijri date of a mosque, computed like the MAWAQIT apps.
