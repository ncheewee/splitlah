create table if not exists trips (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists trips_updated_at_idx on trips (updated_at desc);
