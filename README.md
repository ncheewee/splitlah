# SplitLah MVP

Static expense splitter using GitHub Pages, Cloudflare Workers, and Neon Postgres.

## Architecture

- `index.html`: static app, hosted on GitHub Pages.
- `worker.js`: tiny API, deployed to Cloudflare Workers.
- `neon.sql`: one-table Neon schema.
- Browser stores only the Worker API URL. The Neon connection string stays in Cloudflare as the `DATABASE_URL` secret.

## Setup

1. Create/login to Neon, create a project, open SQL Editor, and run `neon.sql`.
2. Copy the pooled Postgres connection string from Neon.
3. Create/login to Cloudflare, create a Worker named `splitlah-api`.
4. Deploy this Worker code with Wrangler or paste `worker.js` in the dashboard.
5. Add a Worker secret named `DATABASE_URL` with the Neon pooled connection string.
6. Enable GitHub Pages for this repo from `main` / root.
7. Open the Pages URL, tap Setup, enter your name and Worker URL, then save.

## Local Deploy Commands

```sh
npm install
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler deploy
```

## UAT

See `UAT.md`.
