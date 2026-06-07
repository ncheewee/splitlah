// build-test: auto-build verification commit (safe to ignore/remove) — 2026-06-07T14:33:08Z
import { neon } from '@neondatabase/serverless';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function codeFromPath(pathname) {
  const m = pathname.match(/^\/trips\/([A-Z0-9]{6})$/);
  return m && m[1];
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return json({ ok: true });
      if (!env.DATABASE_URL) return json({ error: 'DATABASE_URL secret missing' }, 500);
      const sql = neon(env.DATABASE_URL);

      const code = codeFromPath(url.pathname);
      if (!code) return json({ error: 'Not found' }, 404);

      if (request.method === 'GET') {
        const rows = await sql`select data from trips where code = ${code}`;
        if (!rows.length) return json({ error: 'Trip not found' }, 404);
        return json({ trip: rows[0].data });
      }

      if (request.method === 'PUT') {
        const trip = await request.json();
        if (!trip || trip.code !== code || !trip.name || !trip.members || !Array.isArray(trip.expenses)) {
          return json({ error: 'Invalid trip payload' }, 400);
        }
        trip.updated_at = new Date().toISOString();
        const body = JSON.stringify(trip);
        const rows = await sql`
          insert into trips (code, data, updated_at)
          values (${code}, ${body}::jsonb, now())
          on conflict (code) do update set data = excluded.data, updated_at = now()
          returning data
        `;
        return json({ trip: rows[0].data });
      }

      return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, 500);
    }
  }
};
