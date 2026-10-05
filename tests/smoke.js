// Runs the built package on each runtime of the CI: `node tests/smoke.js`, `deno run`, `bun run`.

import { HijriDate, today } from '../dist/hijri.js';
import { Mawaqit, NotFoundError } from '../dist/index.js';

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
console.log(`OK: ${date}`);
