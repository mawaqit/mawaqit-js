# Reference times of the MAWAQIT app

The prayer times the MAWAQIT mobile app calculates for a position (_Prayer times by location_),
copied by hand. `tests/calculation.test.ts` calculates the same days with the same settings and
expects the same times, with Dhuhr one minute later, as mawaqit/mawaqit-js#16 decided.

One JSON file per place and settings, named like `paris-angle_15.json`:

```json
{
  "source": "MAWAQIT 5.4.2 on Android, recorded on 2026-11-20",
  "position": { "latitude": 48.8566, "longitude": 2.3522, "timeZone": "Europe/Paris" },
  "settings": {
    "method": "angle_15",
    "madhab": "shafi",
    "highLatitudeRule": "twilight_angle",
    "adjustments": {}
  },
  "options": { "hijriAdjustment": 0 },
  "days": {
    "2027-06-21": ["03:45", "05:47", "13:57", "18:04", "21:58", "23:58"]
  }
}
```

- `position`: the latitude and longitude the app uses, with 4 decimals, and the time zone of the
  phone.
- `settings` and `options`: those of `calculatePrayerTimes()`, set the same in the app. Umm
  al-Qura needs the `hijriAdjustment` of the app, which says when Ramadan starts.
- `days`: Fajr, Shuruq, Dhuhr, Asr, Maghrib and Isha, as the app shows them.

To record, as listed in mawaqit/mawaqit-js#16:

- Paris, FR: `angle_15` and `muslims_of_france`, in June and December
- Lille, FR: `muslim_world_league` on 21 June, where the high-latitude rule decides Fajr
- London, GB: `north_america`, in June
- Oslo, NO: `muslim_world_league`, in June, where the rule decides Fajr and Isha
- Makkah, SA: `umm_al_qura`, in Ramadan and outside it
- Montreal, CA: the Hanafi Asr
- Jakarta, ID: `singapore`
- Algiers, DZ; Casablanca, MA; Moscow, RU: the method of their country
- Tromsø, NO: in June, when the sun does not set
- A `custom` setting with adjustments
