# SplitLah MVP

Static expense splitter for GitHub Pages + Supabase.

## Deploy

1. In Supabase SQL Editor, run `supabase.sql`.
2. In GitHub repo settings, enable Pages from `main` / root.
3. Open the Pages URL, tap Setup, and paste your Supabase URL + anon key.

## Data

Supabase stores one row per trip in `public.trips`:

- `code`: share code
- `data`: full trip JSON
- `updated_at`: sync timestamp

This is a friendly MVP. Anyone with the anon key and trip code can update data.
