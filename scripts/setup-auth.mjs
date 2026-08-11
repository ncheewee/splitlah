/* v62 auth migration — idempotent. Safe to re-run.
   DATABASE_URL from env or stdin, same as init-neon.mjs. Never logged. */
import process from 'node:process';
import { neon } from '@neondatabase/serverless';

let url = process.env.DATABASE_URL || '';
if (!url) {
  url = await new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s.trim()));
  });
}
if (!url) throw new Error('DATABASE_URL required on stdin or env');
const sql = neon(url);

/* Statements are listed explicitly rather than parsed out of neon.sql — that
   file contains commented-out runbook SQL, and splitting it on ';' would feed
   comment-only fragments to Postgres. */
const steps = [
  ['legacy_uids table', `create table if not exists legacy_uids (
      uid text primary key,
      seen_at timestamptz not null default now()
    )`],
  ['members GIN index (reverse lookup at sign-in)',
    `create index if not exists trips_members_idx on trips using gin ((data -> 'members'))`]
];

for (const [label, stmt] of steps) {
  await sql.query(stmt);
  console.log('  ok  ' + label);
}

/* Seed the config row switched OFF. Existing values are never overwritten. */
const existing = await sql`select data from trips where code = 'CONFIG'`;
if (!existing.length) {
  await sql`insert into trips (code, data) values ('CONFIG',
    ${JSON.stringify({ config: { requireAuth: false, authCreateOnly: false, minVersion: 57 } })}::jsonb)`;
  console.log('  ok  CONFIG row created (auth disabled)');
} else {
  console.log('  ok  CONFIG row already exists — left untouched:',
    JSON.stringify((existing[0].data || {}).config || {}));
}

const trips = await sql`select count(*)::int as n from trips
  where code not in ('FDBACK','RSTORE','CONFIG') and code not like 'U:%'`;
const legacy = await sql`select count(*)::int as n from legacy_uids`;
console.log(`\nTrips: ${trips[0].n} · legacy_uids: ${legacy[0].n}`);
console.log('Migration complete. Auth is installed but switched off.');
