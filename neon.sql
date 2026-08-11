create table if not exists trips (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists trips_updated_at_idx on trips (updated_at desc);

-- v62: Google sign-in.
-- Accounts live in the same table under a "U:<google_sub>" code so the schema
-- stays single-table. Reserved codes (FDBACK, RSTORE, CONFIG, U:*) are blocked
-- from the /trips/:code routes in worker.js.

create table if not exists legacy_uids (
  uid text primary key,
  seen_at timestamptz not null default now()
);

-- Speeds up the reverse lookup that finds self-created trips at sign-in.
create index if not exists trips_members_idx on trips using gin ((data -> 'members'));

-- One-time snapshot, run immediately BEFORE enabling authCreateOnly.
-- Everyone already using SplitLah keeps creating trips without an account.
-- insert into legacy_uids (uid)
-- select distinct jsonb_object_keys(data->'members') from trips
--   where code not in ('FDBACK','RSTORE','CONFIG') and code not like 'U:%'
-- on conflict (uid) do nothing;

-- Kill switch. No redeploy: edit this row and every client picks it up at boot.
-- insert into trips (code, data) values ('CONFIG',
--   '{"config":{"requireAuth":false,"authCreateOnly":false,"minVersion":57}}'::jsonb)
-- on conflict (code) do update set data = excluded.data, updated_at = now();
