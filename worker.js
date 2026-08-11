import { neon } from '@neondatabase/serverless';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const FEEDBACK_CODE = 'FDBACK';
const RESTORE_CODE = 'RSTORE';
const RESTORE_TOKEN_CHARS = '0123456789';
const RESTORE_TTL_MS = 5 * 60 * 1000;
const RESTORE_PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
const CONFIG_CODE = 'CONFIG';
/* Reserved rows are internal stores, not trips. They must never be reachable
   through /trips/:code — RSTORE holds restore-token hashes, and a 6-digit code
   hashed with SHA-256 is trivially brute-forced if the hash ever leaks. */
const RESERVED_CODES = new Set([FEEDBACK_CODE, RESTORE_CODE, CONFIG_CODE]);
const SESSION_DAYS = 90;

const CONFIG_DEFAULTS = {
  requireAuth: false,      // hard gate on the whole app — leave false
  authCreateOnly: false,   // require sign-in to create a NEW trip
  clientId: '',
  minVersion: 57
};

/* ---- base64url ---- */
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jsonFromB64url(s) { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }

/* ---- Google ID token verification ---- */
let JWKS_CACHE = { at: 0, keys: null };
async function googleKeys(force) {
  if (!force && JWKS_CACHE.keys && Date.now() - JWKS_CACHE.at < 3600000) return JWKS_CACHE.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('Could not fetch Google signing keys');
  const j = await r.json();
  JWKS_CACHE = { at: Date.now(), keys: j.keys || [] };
  return JWKS_CACHE.keys;
}
async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const header = jsonFromB64url(parts[0]);
  const payload = jsonFromB64url(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  let keys = await googleKeys(false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await googleKeys(true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error('Signing key not found');
  const key = await crypto.subtle.importKey('jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
  if (!good) throw new Error('Bad token signature');
  const now = Math.floor(Date.now() / 1000);
  if ((+payload.exp || 0) < now - 60) throw new Error('ID token expired');
  if (payload.iat && +payload.iat > now + 300) throw new Error('ID token issued in the future');
  const iss = payload.iss || '';
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') throw new Error('Unexpected issuer');
  if (clientId && payload.aud !== clientId) throw new Error('Token audience mismatch');
  if (payload.email && payload.email_verified === false) throw new Error('Google email not verified');
  if (!payload.sub) throw new Error('Token has no subject');
  return payload;
}

/* ---- our own session token (long-lived, so the app works offline) ---- */
async function hmacBytes(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function issueSession(secret, sub) {
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    sub, iat: Date.now(), exp: Date.now() + SESSION_DAYS * 86400000
  })));
  return body + '.' + bytesToB64url(await hmacBytes(secret, body));
}
async function readSession(secret, token) {
  if (!secret || !token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = bytesToB64url(await hmacBytes(secret, body));
  if (!timingSafeEqual(expected, sig)) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); } catch (e) { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  return data;
}
async function sessionFrom(request, env) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return readSession(env.SESSION_SECRET, m[1]);
}

/* ---- config, stored in the DB so the kill switch needs no redeploy ---- */
async function loadConfig(sql, env) {
  let stored = {};
  try {
    const rows = await sql`select data from trips where code = ${CONFIG_CODE}`;
    if (rows.length && rows[0].data && typeof rows[0].data === 'object') stored = rows[0].data.config || {};
  } catch (e) { /* fall back to defaults */ }
  return Object.assign({}, CONFIG_DEFAULTS, { clientId: env.GOOGLE_CLIENT_ID || '' }, stored);
}

/* ---- account lookup and merge ---- */
async function loadUser(sql, sub) {
  const rows = await sql`select data from trips where code = ${'U:' + sub}`;
  return rows.length ? rows[0].data : null;
}
async function saveUser(sql, sub, user) {
  user.updated_at = new Date().toISOString();
  const body = JSON.stringify(user);
  await sql`
    insert into trips (code, data, updated_at)
    values (${'U:' + sub}, ${body}::jsonb, now())
    on conflict (code) do update set data = excluded.data, updated_at = now()
  `;
}
/* Trips the user created themselves never appear in local claims — me(t) falls
   back to state.uid — so they must be recovered by reverse lookup or sign-in
   would silently drop them. This is the v52 bug, and it would land harder here. */
async function tripsForUid(sql, uid) {
  return sql`
    select code, data from trips
    where jsonb_exists(data->'members', ${uid})
      and (data->>'deletedAt') is null
      and code not in (${FEEDBACK_CODE}, ${RESTORE_CODE}, ${CONFIG_CODE})
      and code not like 'U:%'
  `;
}
async function adoptAndMerge(sql, user, deviceUid, deviceClaims) {
  user.uids = Array.isArray(user.uids) ? user.uids : [];
  user.claims = (user.claims && typeof user.claims === 'object') ? user.claims : {};
  if (deviceUid && !user.uids.includes(deviceUid)) user.uids.push(deviceUid);
  user.uids = user.uids.slice(0, 25);

  const claimEntries = Object.entries(deviceClaims || {}).slice(0, 200);
  for (const [rawCode, rawMemberId] of claimEntries) {
    const code = cleanText(rawCode, 6).toUpperCase();
    const memberId = cleanText(rawMemberId, 80);
    if (!code || !memberId || RESERVED_CODES.has(code)) continue;
    if (user.claims[code]) continue;
    const rows = await sql`select data from trips where code = ${code}`;
    if (!rows.length) continue;
    const trip = rows[0].data;
    if (trip.deletedAt || !trip.members || !trip.members[memberId]) continue;
    user.claims[code] = memberId;
  }
  for (const uid of user.uids) {
    const rows = await tripsForUid(sql, uid);
    for (const row of rows) {
      const code = row.data && row.data.code;
      if (code && !user.claims[code]) user.claims[code] = uid;
    }
  }
  return user;
}

function genRestoreToken(len = 6) {
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
        const rows = await sql`
          select data from trips
          where code not in (${FEEDBACK_CODE}, ${RESTORE_CODE}, ${CONFIG_CODE})
            and code not like 'U:%'
          order by updated_at desc limit 200`;
        const trips = rows.map(r => r.data).filter(t => t && t.code);
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
        const uid = cleanText(payload.uid, 80);
        const name = cleanText(payload.name, 80);
        const paynowProxy = cleanText(payload.paynowProxy, 40);
        const rawClaims = (payload.claims && typeof payload.claims === 'object') ? payload.claims : {};
        if (!uid) return json({ error: 'uid is required' }, 400);
        const entries = Object.entries(rawClaims).slice(0, 200);
        const validClaims = {};
        for (const [rawCode, rawMemberId] of entries) {
          const tripCode = cleanText(rawCode, 6).toUpperCase();
          const memberId = cleanText(rawMemberId, 80);
          if (!tripCode || !memberId) continue;
          const tripRows = await sql`select data from trips where code = ${tripCode}`;
          if (!tripRows.length) continue;
          const trip = tripRows[0].data;
          if (trip.deletedAt) continue;
          if (!trip.members || !trip.members[memberId]) continue;
          validClaims[tripCode] = memberId;
        }
        if (!Object.keys(validClaims).length) return json({ error: 'No trips to restore' }, 400);
        const token = genRestoreToken();
        const tokenHash = await hashRestoreToken(token);
        const store = purgeRestoreTokens(await loadRestore(sql));
        const now = Date.now();
        store.tokens[tokenHash] = { uid, name, paynowProxy, claims: validClaims, createdAt: now, expiresAt: now + RESTORE_TTL_MS, used: false };
        await saveRestore(sql, store);
        return json({ ok: true, token, expiresAt: store.tokens[tokenHash].expiresAt, tripCount: Object.keys(validClaims).length });
      }

      if (url.pathname.startsWith('/restore/') && request.method === 'GET') {
        const rawToken = decodeURIComponent(url.pathname.slice('/restore/'.length));
        const token = cleanText(rawToken, 6).replace(/[^0-9]/g, '');
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
        return json({ ok: true, uid: rec.uid, name: rec.name, paynowProxy: rec.paynowProxy, claims: rec.claims || {} });
      }

      if (url.pathname === '/config' && request.method === 'GET') {
        const cfg = await loadConfig(sql, env);
        const uid = cleanText(url.searchParams.get('uid') || '', 80);
        let legacy = false;
        if (uid) {
          const rows = await sql`select 1 from legacy_uids where uid = ${uid}`;
          legacy = rows.length > 0;
        }
        return json({
          requireAuth: !!cfg.requireAuth,
          authCreateOnly: !!cfg.authCreateOnly,
          clientId: cfg.clientId || '',
          minVersion: cfg.minVersion || 0,
          legacy
        });
      }

      if (url.pathname === '/auth/google' && request.method === 'POST') {
        if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 500);
        const cfg = await loadConfig(sql, env);
        const payload = await request.json().catch(() => ({}));
        let claims;
        try {
          claims = await verifyGoogleIdToken(payload.idToken, cfg.clientId);
        } catch (e) {
          return json({ error: e.message || 'Sign-in failed' }, 401);
        }
        const sub = claims.sub;
        const deviceUid = cleanText(payload.uid, 80);
        let user = await loadUser(sql, sub) || { sub, uids: [], claims: {}, created_at: new Date().toISOString() };
        user.name = cleanText(payload.name, 80) || user.name || cleanText(claims.name, 80);
        user.paynowProxy = cleanText(payload.paynowProxy, 40) || user.paynowProxy || '';
        user.email = cleanText(claims.email, 120) || user.email || '';
        user = await adoptAndMerge(sql, user, deviceUid, payload.claims);
        await saveUser(sql, sub, user);
        return json({
          ok: true,
          sessionToken: await issueSession(env.SESSION_SECRET, sub),
          sub, email: user.email, name: user.name, paynowProxy: user.paynowProxy,
          claims: user.claims, uids: user.uids,
          tripCount: Object.keys(user.claims).length
        });
      }

      if (url.pathname === '/auth/me' && request.method === 'GET') {
        const session = await sessionFrom(request, env);
        if (!session) return json({ error: 'Not signed in' }, 401);
        const user = await loadUser(sql, session.sub);
        if (!user) return json({ error: 'Account not found' }, 404);
        return json({ ok: true, sub: session.sub, email: user.email, name: user.name,
                      paynowProxy: user.paynowProxy, claims: user.claims || {}, uids: user.uids || [] });
      }

      /* Play requires in-app account deletion. Trips are shared data and are
         deliberately NOT deleted — only the account record linking them. */
      if (url.pathname === '/auth/account' && request.method === 'DELETE') {
        const session = await sessionFrom(request, env);
        if (!session) return json({ error: 'Not signed in' }, 401);
        await sql`delete from trips where code = ${'U:' + session.sub}`;
        return json({ ok: true, deleted: true, note: 'Trips are shared with other members and were not deleted.' });
      }

      const code = codeFromPath(url.pathname);
      if (!code) return json({ error: 'Not found' }, 404);
      if (RESERVED_CODES.has(code)) return json({ error: 'Trip not found' }, 404);

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
        const existing = await sql`select 1 from trips where code = ${code}`;
        if (!existing.length) {
          const cfg = await loadConfig(sql, env);
          if (cfg.requireAuth || cfg.authCreateOnly) {
            const session = await sessionFrom(request, env);
            if (!session) {
              const ownerId = cleanText(trip.ownerId, 80);
              const legacy = ownerId ? await sql`select 1 from legacy_uids where uid = ${ownerId}` : [];
              if (!legacy.length) {
                return json({ error: 'Sign in to create a trip', code: 'AUTH_REQUIRED' }, 401);
              }
            }
          }
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
