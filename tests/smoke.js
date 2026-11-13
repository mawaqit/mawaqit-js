// Runs the built package on each runtime of the CI: `node tests/smoke.js`, `deno run`, `bun run`.

import { HijriDate, today } from '../dist/hijri.js';
import { Mawaqit, NotFoundError } from '../dist/index.js';
import {
  calculatePrayerTimes,
  defaultCalculationSettings,
  nextPrayer,
} from '../dist/prayer-times.js';

const fetch = async () => Response.json({ message: 'No mosque.' }, { status: 404 });
const client = new Mawaqit({ fetch, token: 'token' });

const error = await client.mosques.prayerTimes('uuid').catch((e) => e);
if (!(error instanceof NotFoundError) || error.message !== 'No mosque. (HTTP 404)') {
  throw new Error(`Unexpected error: ${error}`);
}
const date = today({ hijriAdjustment: 0, hijriDateForceTo30: false }, 'Asia/Riyadh');
if (!(date instanceof HijriDate)) {
  throw new Error(`Unexpected date: ${date}`);
}
const row = ['05:00', '06:30', '12:00', '15:00', '18:00', '19:30'];
const calendar = Array.from({ length: 12 }, () =>
  Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), row])),
);
const next = nextPrayer({ timezone: 'Asia/Riyadh', calendar, iqamaCalendar: [] });
if (!next?.time) {
  throw new Error(`Unexpected next prayer: ${next}`);
}
const position = { latitude: 21.42, longitude: 39.83, timeZone: 'Asia/Riyadh' };
const times = calculatePrayerTimes(position, defaultCalculationSettings('SA'), { year: 2026 });
if (times.calendar[0]?.['1']?.join() !== '05:37,06:59,12:25,15:29,17:50,19:20') {
  throw new Error(`Unexpected calculated times: ${times.calendar[0]?.['1']}`);
}
console.log(
  `OK: ${date}, ${next.name} at ${next.time}, Fajr in Makkah at ${times.calendar[0][1][0]}`,
);
