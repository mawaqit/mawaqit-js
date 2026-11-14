# Reference times of the MAWAQIT app

The prayer times of the MAWAQIT mobile app 4.4.0 for a position (_Prayer times by location_),
for every day of 2027, from the calculation of the app itself. `tests/calculation.test.ts`
calculates the same days with the same settings and expects the same times, with Dhuhr one minute
later, as mawaqit/mawaqit-js#16 decided.

One JSON file per place and settings, named like `paris-angle_15.json`:

```json
{
  "source": "The calculation of the MAWAQIT app 4.4.0, run for every day of 2027 on 2026-11-14",
  "position": { "latitude": 48.8566, "longitude": 2.3522, "timeZone": "Europe/Paris" },
  "settings": {
    "method": "angle_15",
    "madhab": "shafi",
    "highLatitudeRule": "twilight_angle",
    "adjustments": {}
  },
  "options": { "hijriAdjustment": 0 },
  "differences": { "2027-06-05": { "fajr": "04:13" } },
  "days": {
    "2027-06-21": ["03:45", "05:47", "13:57", "18:04", "21:58", "23:58"]
  }
}
```

- `position`: the latitude and longitude, with 4 decimals, and the time zone of the phone.
- `settings` and `options`: those of `calculatePrayerTimes()`, set the same in the app.
- `days`: Fajr, Shuruq, Dhuhr, Asr, Maghrib and Isha, as the app shows them.
- `differences`: the times where this library gives another minute than the app, by day and
  prayer. 8 of the 32,850 times, all of them a Fajr one minute earlier, on a day where the
  high-latitude rule sets Fajr less than a second from the half-minute: the app rounds there to
  the next minute, this library keeps the time of adhan-js.

The files cover Paris (`angle_15`, `muslims_of_france`), Lille and Oslo (every high-latitude
rule), London (`north_america`), Tromsø (the midnight sun), Montreal (the Hanafi Asr), Jakarta
(`singapore`), Algiers (`algeria`), Moscow (`russia`), Sydney (the southern hemisphere), Makkah,
and Toulouse (`custom` angles with adjustments).

Two settings are left out:

- `umm_al_qura` and `qatar`: Isha is 90 minutes after Maghrib here, as these methods define it,
  where the app uses an angle of 18°. Makkah is recorded with the app's angles, as `custom`.
- `morocco`: Morocco went back to UTC on 2026-09-20, and a runtime with older time zone data
  shows its times an hour off. The method has the angles of `algeria`.
