import { neon } from '@neondatabase/serverless';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const FEEDBACK_CODE = 'FDBACK';
const RESTORE_CODE = 'RSTORE';
const RESTORE_TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RESTORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESTORE_PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function genRestoreToken(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => RESTORE_TOKEN_CHARS[b % RESTORE_TOKEN_CHARS.length]).join('');
}

async function hashRestoreToken(token) {
  const data = new TextEncoder().encode('splitlah-restore:' + token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function restoreStore() {
  return {
    code: RESTORE_CODE,
    name: 'SplitLah Restore Tokens',
    currency: 'SGD',
    ownerId: 'system',
    members: {},
    expenses: [],
    settlements: [],
    tokens: {},
    updated_at: new Date().toISOString()
  };
}

async function loadRestore(sql) {
  const rows = await sql`select data from trips where code = ${RESTORE_CODE}`;
  const store = rows.length ? rows[0].data : restoreStore();
  store.tokens = (store.tokens && typeof store.tokens === 'object') ? store.tokens : {};
  return store;
}

async function saveRestore(sql, store) {
  store.updated_at = new Date().toISOString();
  const body = JSON.stringify(store);
  await sql`
    insert into trips (code, data, updated_at)
    values (${RESTORE_CODE}, ${body}::jsonb, now())
    on conflict (code) do update set data = excluded.data, updated_at = now()
  `;
}

function purgeRestoreTokens(store) {
  const now = Date.now();
  const kept = {};
  for (const [hash, rec] of Object.entries(store.tokens)) {
    const expiresAt = +rec.expiresAt || 0;
    if (expiresAt > now - RESTORE_PURGE_AFTER_MS) kept[hash] = rec;
  }
  store.tokens = kept;
  return store;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function codeFromPath(pathname) {
  const m = pathname.match(/^\/trips\/([A-Z0-9]{6})$/);
  return m && m[1];
}

function fxCodeFromPath(pathname) {
  const m = pathname.match(/^\/fx\/([A-Z]{3})$/);
  return m && m[1];
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function feedbackStore() {
  return {
    code: FEEDBACK_CODE,
    name: 'SplitLah Feedback',
    currency: 'SGD',
    ownerId: 'admin',
    members: { admin: { name: 'Admin', avatarColor: '#dff8ef', paynowProxy: '' } },
    expenses: [],
    settlements: [],
    feedback: [],
    updated_at: new Date().toISOString()
  };
}

async function loadFeedback(sql) {
  const rows = await sql`select data from trips where code = ${FEEDBACK_CODE}`;
  const store = rows.length ? rows[0].data : feedbackStore();
  store.feedback = Array.isArray(store.feedback) ? store.feedback : [];
  return store;
}

async function saveFeedback(sql, store) {
  store.updated_at = new Date().toISOString();
  const body = JSON.stringify(store);
  await sql`
    insert into trips (code, data, updated_at)
    values (${FEEDBACK_CODE}, ${body}::jsonb, now())
    on conflict (code) do update set data = excluded.data, updated_at = now()
  `;
}

function summarizeTrip(t) {
  const expenses = Array.isArray(t.expenses) ? t.expenses : [];
  const members = t.members || {};
  const currencies = [...new Set(expenses.map(e => e.currency || 'SGD'))];
  return {
    code: t.code,
    name: cleanText(t.name, 80),
    ownerKnown: Boolean(t.ownerId && members[t.ownerId]),
    memberCount: Object.keys(members).length,
    expenseCount: expenses.length,
    settlementCount: Array.isArray(t.settlements) ? t.settlements.length : 0,
    totalSgd: Math.round(expenses.reduce((sum, e) => sum + (+e.amount || 0), 0) * 100) / 100,
    currencies,
    updated_at: t.updated_at || null,
    deleted: Boolean(t.deletedAt)
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return json({ ok: true });
      const fxCode = fxCodeFromPath(url.pathname);
      if (fxCode && request.method === 'GET') {
        if (fxCode === 'SGD') return json({ rate: 1, source: 'SGD', asOf: new Date().toISOString() });
        const cache = caches.default;
        const cacheKey = new Request('https://splitlah.local/fx/' + fxCode);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        const upstream = await fetch('https://open.er-api.com/v6/latest/SGD', {
          cf: { cacheTtl: 21600, cacheEverything: true }
        });
        const data = await upstream.json();
        const perSgd = +(data?.rates?.[fxCode] || 0);
        if (!upstream.ok || data?.result === 'error' || !isFinite(perSgd) || perSgd <= 0) {
          return json({ error: 'FX rate unavailable' }, 502);
        }
        const response = json({
          rate: Math.round((1 / perSgd) * 100000000) / 100000000,
          displayRate: Math.round(perSgd * 10000) / 10000,
          source: 'Open ER API',
          asOf: data.time_last_update_utc || new Date().toISOString()
        });
        response.headers.set('Cache-Control', 'public, max-age=21600');
        await cache.put(cacheKey, response.clone());
        return response;
      }
      if (!env.DATABASE_URL) return json({ error: 'DATABASE_URL secret missing' }, 500);
      const sql = neon(env.DATABASE_URL);

      if (url.pathname === '/feedback' && request.method === 'POST') {
        const payload = await request.json().catch(() => ({}));
        const message = cleanText(payload.message, 2000);
        if (!message) return json({ error: 'Feedback message required' }, 400);
        const item = {
          id: crypto.randomUUID(),
          message,
          rating: Math.max(1, Math.min(5, +(payload.rating || 3))),
          tripCode: cleanText(payload.tripCode, 6).toUpperCase(),
          screen: cleanText(payload.screen, 40),
          appVersion: cleanText(payload.appVersion, 20),
          actorName: cleanText(payload.actorName, 80),
          actorId: cleanText(payload.actorId, 80),
          userAgent: cleanText(payload.userAgent, 200),
          url: cleanText(payload.url, 300),
          createdAt: new Date().toISOString()
        };
        const store = await loadFeedback(sql);
        store.feedback.unshift(item);
        store.feedback = store.feedback.slice(0, 500);
        await saveFeedback(sql, store);
        return json({ ok: true, id: item.id });
      }

      if (url.pathname === '/admin/feedback' && request.method === 'GET') {
        const store = await loadFeedback(sql);
        return json({ feedback: store.feedback.slice(0, 200) });
      }

      if (url.pathname === '/admin/summary' && request.method === 'GET') {
        const rows = await sql`select data from trips order by updated_at desc limit 200`;
        const trips = rows.map(r => r.data).filter(t => t && t.code !== FEEDBACK_CODE);
        const summaries = trips.map(summarizeTrip);
        const active = summaries.filter(t => !t.deleted);
        return json({
          generatedAt: new Date().toISOString(),
          totals: {
            trips: active.length,
            deletedTrips: summaries.length - active.length,
            members: active.reduce((sum, t) => sum + t.memberCount, 0),
            expenses: active.reduce((sum, t) => sum + t.expenseCount, 0),
            totalSgd: Math.round(active.reduce((sum, t) => sum + t.totalSgd, 0) * 100) / 100
          },
          trips: summaries
        });
      }

      if (url.pathname === '/restore' && request.method === 'POST') {
        const payload = await request.json().catch(() => ({}));
        const tripCode = cleanText(payload.tripCode, 6).toUpperCase();
        const memberId = cleanText(payload.memberId, 80);
        const uid = cleanText(payload.uid, 80);
        const name = cleanText(payload.name, 80);
        const paynowProxy = cleanText(payload.paynowProxy, 40);
        if (!tripCode || !memberId || !uid) return json({ error: 'tripCode, memberId and uid are required' }, 400);
        const tripRows = await sql`select data from trips where code = ${tripCode}`;
        if (!tripRows.length) return json({ error: 'Trip not found' }, 404);
        const trip = tripRows[0].data;
        if (trip.deletedAt) return json({ error: 'Trip was deleted' }, 404);
        if (!trip.members || !trip.members[memberId]) return json({ error: 'Member not found in trip' }, 404);
        const token = genRestoreToken(10);
        const tokenHash = await hashRestoreToken(token);
        const store = purgeRestoreTokens(await loadRestore(sql));
        const now = Date.now();
        store.tokens[tokenHash] = { tripCode, memberId, uid, name, paynowProxy, createdAt: now, expiresAt: now + RESTORE_TTL_MS, used: false };
        await saveRestore(sql, store);
        return json({ ok: true, token, expiresAt: store.tokens[tokenHash].expiresAt });
      }

      if (url.pathname.startsWith('/restore/') && request.method === 'GET') {
        const rawToken = decodeURIComponent(url.pathname.slice('/restore/'.length));
        const token = cleanText(rawToken, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!token) return json({ error: 'Restore code required' }, 400);
        const tokenHash = await hashRestoreToken(token);
        const store = await loadRestore(sql);
        const rec = store.tokens[tokenHash];
        if (!rec) return json({ error: 'Restore code not found or already used' }, 404);
        if (rec.used) return json({ error: 'Restore code already used' }, 410);
        if ((+rec.expiresAt || 0) < Date.now()) {
          delete store.tokens[tokenHash];
          await saveRestore(sql, store);
          return json({ error: 'Restore code expired' }, 410);
        }
        rec.used = true;
        rec.usedAt = Date.now();
        await saveRestore(sql, store);
        return json({ ok: true, tripCode: rec.tripCode, memberId: rec.memberId, uid: rec.uid, name: rec.name, paynowProxy: rec.paynowProxy });
      }

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
