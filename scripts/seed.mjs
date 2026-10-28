#!/usr/bin/env node
// Loads supabase/seed.sql: Riverside Motor Group, a fictional dealer with yards in Hamilton and Tauranga,
// seven people on the floor and about thirty leads in every state, from answered-in-four-minutes to
// unanswered-after-fifty. Times are relative to now and every insert skips what is already there, so
// re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  await db.exec(readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
  const [c] = await db.query(`
    select (select count(*) from staff) as staff, (select count(*) from lead_sources) as sources, (select count(*) from vehicles) as vehicles,
           (select count(*) from contacts) as contacts, (select count(*) from leads) as leads, (select count(*) from activities) as activities,
           (select count(*) from test_drives) as test_drives, (select count(*) from appraisals) as appraisals, (select count(*) from deals) as deals`);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(`seed: ${n.staff} staff, ${n.sources} lead sources, ${n.vehicles} vehicles, ${n.contacts} contacts, ${n.leads} leads, ${n.activities} activities, ${n.test_drives} test drives, ${n.appraisals} appraisals, ${n.deals} deals`);
  } finally {
    await db.close();
  }
}
