-- SplitLah v62 auth migration.
-- Paste this whole file into the Neon SQL Editor and Run. Idempotent.
-- Equivalent to: node scripts/setup-auth.mjs

-- 1. Grandfathering list. Populated later, immediately before enforcement.
create table if not exists legacy_uids (
  uid text primary key,
  seen_at timestamptz not null default now()
);

-- 2. Speeds up the reverse lookup that finds self-created trips at sign-in.
create index if not exists trips_members_idx on trips using gin ((data -> 'members'));

-- 3. Runtime config, switched OFF. This row is the kill switch:
--    editing it changes every client's behaviour at next boot, no redeploy.
insert into trips (code, data)
values ('CONFIG', '{"config":{"requireAuth":false,"authCreateOnly":false,"minVersion":57}}'::jsonb)
on conflict (code) do nothing;

-- 4. Check what you just did.
select
  (select count(*) from trips
     where code not in ('FDBACK','RSTORE','CONFIG') and code not like 'U:%') as trips,
  (select count(*) from trips where code like 'U:%')                          as accounts,
  (select count(*) from legacy_uids)                                          as legacy_uids,
  (select data->'config' from trips where code = 'CONFIG')                    as config;


-- ---------------------------------------------------------------------------
-- LATER, when you want new users to need an account. Order matters.
-- Prefer: node scripts/rollout-auth.mjs snapshot   (it refuses unsafe ordering)
-- ---------------------------------------------------------------------------

-- Step A — grandfather everyone already using SplitLah:
-- insert into legacy_uids (uid)
-- select distinct jsonb_object_keys(data->'members') from trips
--   where code not in ('FDBACK','RSTORE','CONFIG') and code not like 'U:%'
--     and (data->>'deletedAt') is null
-- on conflict (uid) do nothing;

-- Step B — only after Step A reports rows, turn the gate on:
-- update trips set data = jsonb_set(data, '{config,authCreateOnly}', 'true'),
--   updated_at = now() where code = 'CONFIG';

-- KILL SWITCH — undo instantly, no redeploy:
-- update trips set data = jsonb_set(
--   jsonb_set(data, '{config,authCreateOnly}', 'false'), '{config,requireAuth}', 'false'),
--   updated_at = now() where code = 'CONFIG';
