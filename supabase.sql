create table if not exists public.trips (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.trips enable row level security;

drop policy if exists "mvp anon read" on public.trips;
drop policy if exists "mvp anon insert" on public.trips;
drop policy if exists "mvp anon update" on public.trips;

create policy "mvp anon read" on public.trips
for select to anon using (true);

create policy "mvp anon insert" on public.trips
for insert to anon with check (true);

create policy "mvp anon update" on public.trips
for update to anon using (true) with check (true);
