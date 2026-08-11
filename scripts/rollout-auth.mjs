/* Rollout control for v62 sign-in.
 *
 *   node scripts/rollout-auth.mjs status     show config, trip and account counts
 *   node scripts/rollout-auth.mjs snapshot   grandfather everyone using the app today
 *   node scripts/rollout-auth.mjs enable     require sign-in to CREATE a trip
 *   node scripts/rollout-auth.mjs disable    kill switch — back to open access
 *
 * Order matters: snapshot BEFORE enable, or existing users get gated.
 * DATABASE_URL from env or stdin. Never logged.
 */
import process from 'node:process';
import { neon } from '@neondatabase/serverless';

const cmd = (process.argv[2] || 'status').toLowerCase();
if (!['status', 'snapshot', 'enable', 'disable', 'accounts'].includes(cmd)) {
  console.error('Usage: rollout-auth.mjs status|accounts|snapshot|enable|disable');
  process.exit(1);
}

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

async function readConfig() {
  const rows = await sql`select data from trips where code = 'CONFIG'`;
  return rows.length ? ((rows[0].data || {}).config || {}) : {};
}
async function writeConfig(cfg) {
  await sql`insert into trips (code, data) values ('CONFIG', ${JSON.stringify({ config: cfg })}::jsonb)
            on conflict (code) do update set data = excluded.data, updated_at = now()`;
}
async function counts() {
  const t = await sql`select count(*)::int as n from trips
    where code not in ('FDBACK','RSTORE','CONFIG') and code not like 'U:%'`;
  const a = await sql`select count(*)::int as n from trips where code like 'U:%'`;
  const l = await sql`select count(*)::int as n from legacy_uids`;
  return { trips: t[0].n, accounts: a[0].n, legacy: l[0].n };
}

if (cmd === 'status') {
  const cfg = await readConfig(), c = await counts();
  console.log('config      ', JSON.stringify(cfg));
  console.log('trips       ', c.trips);
  console.log('accounts    ', c.accounts);
  console.log('legacy_uids ', c.legacy);
  const gated = !!(cfg.requireAuth || cfg.authCreateOnly);
  console.log('\nSign-in is currently ' + (gated ? 'REQUIRED to create trips' : 'optional (nobody is gated)'));
  if (gated && c.legacy === 0) console.log('WARNING: gate is on but legacy_uids is empty — existing users are being gated.');
}

/* Diagnostic: what did sign-in actually record? More than one row here means
   more than one Google account was used — the usual cause of "my trips are
   missing on the other device". */
if (cmd === 'accounts') {
  const rows = await sql`select code, data, updated_at from trips where code like 'U:%' order by updated_at desc`;
  if (!rows.length) { console.log('No accounts yet — nobody has signed in.'); process.exit(0); }
  console.log(`${rows.length} account row(s):\n`);
  for (const r of rows) {
    const u = r.data || {};
    const claims = u.claims || {};
    console.log('sub        ', (u.sub || r.code.slice(2)).slice(0, 12) + '…');
    console.log('email      ', u.email || '(none)');
    console.log('name       ', u.name || '(none)');
    console.log('uids       ', JSON.stringify(u.uids || []));
    console.log('claims     ', Object.keys(claims).length, JSON.stringify(claims));
    console.log('updated    ', r.updated_at);
    // Which of those trips would actually be visible to this account?
    for (const [code, memberId] of Object.entries(claims)) {
      const t = await sql`select data->>'name' as name, jsonb_exists(data->'members', ${memberId}) as ok,
                                 (data->>'deletedAt') is not null as deleted
                          from trips where code = ${code}`;
      const row = t[0];
      console.log(`   ${code}  ${row ? row.name : 'MISSING FROM DB'}` +
        (row && !row.ok ? '  <-- memberId not in this trip' : '') +
        (row && row.deleted ? '  <-- deleted' : ''));
    }
    console.log('');
  }
  if (rows.length > 1) {
    console.log('More than one account row. If these are meant to be the same person,');
    console.log('two different Google accounts were used to sign in.');
  }
}

if (cmd === 'snapshot') {
  const before = (await counts()).legacy;
  await sql`insert into legacy_uids (uid)
            select distinct jsonb_object_keys(data->'members') from trips
            where code not in ('FDBACK','RSTORE','CONFIG') and code not like 'U:%'
              and (data->>'deletedAt') is null
            on conflict (uid) do nothing`;
  const after = (await counts()).legacy;
  console.log(`legacy_uids ${before} -> ${after} (+${after - before})`);
  console.log('Everyone who is already a member of a trip can keep creating trips without an account.');
}

if (cmd === 'enable') {
  const c = await counts();
  if (c.legacy === 0) {
    console.error('Refusing: legacy_uids is empty. Run "snapshot" first, or existing users will be gated.');
    process.exit(2);
  }
  const cfg = await readConfig();
  cfg.authCreateOnly = true;
  await writeConfig(cfg);
  console.log('authCreateOnly = true. New users must sign in to create a trip;', c.legacy, 'existing uids are grandfathered.');
  console.log('Clients pick this up at next boot. To undo: rollout-auth.mjs disable');
}

if (cmd === 'disable') {
  const cfg = await readConfig();
  cfg.authCreateOnly = false;
  cfg.requireAuth = false;
  await writeConfig(cfg);
  console.log('Kill switch applied — open access restored. No redeploy needed.');
}
