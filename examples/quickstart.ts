/**
 * Find the nearest mosque, then print its prayer times and Hijri date.
 *
 * Run with: MAWAQIT_TOKEN=... pnpm example
 */

import { Mawaqit } from '@mawaqit/sdk';
import { today } from '@mawaqit/sdk/hijri';

const client = new Mawaqit();

const [mosque] = await client.mosques.search({ lat: 48.8414, lon: 2.3557 });
if (!mosque) {
  throw new Error('No mosque found around this position.');
}
console.log(`${mosque.label}, ${mosque.proximity} m away`);

const [prayerTimes, settings] = await Promise.all([
  client.mosques.prayerTimes(mosque.uuid),
  client.mosques.hijriSettings(mosque.uuid),
]);
// Today's month and day in the time zone of the mosque, like 2026-10-05.
const [, month = 1, day = 1] = new Intl.DateTimeFormat('en-CA', { timeZone: prayerTimes.timezone })
  .format()
  .split('-')
  .map(Number);
const times = prayerTimes.calendar[month - 1]?.[String(day)] ?? [];
console.log(`${today(settings, prayerTimes.timezone)}: ${times.join(', ')}`);
