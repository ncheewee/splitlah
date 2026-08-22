import { neon } from '@neondatabase/serverless';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

/* ---- trip merge (v65) -------------------------------------------------------
   Whole-document last-write-wins destroyed concurrent edits: whoever PUT last
   erased everything the other member had added. Every write now merges item by
   item. The rules live here, and this text is duplicated verbatim into
   worker.js and index.html — scripts/merge_parity.cjs fails if the two drift.

     - expenses / settlements / members: union by id. The item with the newer
       stamp (updatedAt, else created) wins; on a tie the newer trip's
       copy wins, so a rename is never silently reverted by an older peer.
     - deletion is a tombstone, never an absence. tombstones.ex / .mem are
       {id: isoDeletedAt} maps. A tombstone only kills an item whose own stamp
       is OLDER than the tombstone — so re-adding a removed member, or an edit
       that races a delete, survives, and a stale tombstone cannot keep killing
       an item that was legitimately recreated.
     - the trip's own deletion is monotone the same way: deletedAt vs a later
       undeletedAt, so a peer that has not heard about the delete cannot
       resurrect the trip merely by pushing an unrelated expense.
     - trip scalars (name, status, currency, ownerId) follow metaAt, which only
       moves when a scalar actually changes — NOT updated_at, which every write
       bumps. Otherwise a device that merely adds an expense reverts a rename it
       never saw. The server must not restamp either clock before merging.
     - a member is never removed while a live expense or settlement still refers
       to them, whatever the tombstones say: an orphaned paidBy silently drops
       that person out of the split maths and crashes the settle sheet.

   The load-bearing invariant: an item missing from one side is never deleted.
   A stale client that has never seen an expense can no longer destroy it.     */
function slIso(v) { return typeof v === 'string' ? v : ''; }
/* deliberately NOT o.at — that is the user's chosen expense date, which can be
   backdated or set in the future, and must never act as an edit time. */
function slStamp(o) { return slIso(o && (o.updatedAt || o.created)); }
function slMax(a, b) { return slIso(a) > slIso(b) ? slIso(a) : slIso(b); }
function slTomb(t) {
  var x = (t && t.tombstones) || {};
  return { ex: x.ex || {}, mem: x.mem || {} };
}
/* A tombstone only wins against an item older than itself. */
function slKilled(tombAt, item) {
  return !!tombAt && slIso(tombAt) > slStamp(item);
}
/* Settlements shipped without ids. Derive one deterministically so two devices
   that recorded the same payment agree it is one payment, not two. */
function slSettleId(s) {
  if (!s) return '';
  if (s.id) return s.id;
  return 's_' + [s.from, s.to, s.amount, s.paidAt || ''].join('|');
}
function slMergeMap(a, b) {
  var out = {}, k;
  for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
  for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
    if (!out[k] || slIso(b[k]) > slIso(out[k])) out[k] = b[k];
  }
  return out;
}
/* lose first, win last: a tie hands it to the newer trip. */
function slMergeList(loseList, winList, idOf, tombs) {
  var byId = {}, order = [], i, item, id;
  var take = function (list) {
    for (i = 0; i < (list || []).length; i++) {
      item = list[i]; if (!item) continue;
      id = idOf(item); if (!id) continue;
      if (!(id in byId)) { byId[id] = item; order.push(id); continue; }
      if (slStamp(item) >= slStamp(byId[id])) byId[id] = item;
    }
  };
  take(loseList); take(winList);
  var out = [];
  for (i = 0; i < order.length; i++) {
    id = order[i];
    if (tombs && slKilled(tombs[id], byId[id])) continue;
    out.push(byId[id]);
  }
  return out;
}
function slMergeTrips(a, b) {
  if (!a) return b; if (!b) return a;
  var aWins = slIso(a.updated_at) > slIso(b.updated_at);
  var win = aWins ? a : b, lose = aWins ? b : a;
  /* scalars run on their own clock, so an unrelated write cannot revert them */
  var aMeta = slIso(a.metaAt), bMeta = slIso(b.metaAt);
  /* a side that has never touched a scalar must not outrank one that has, so an
     absent metaAt loses outright rather than falling back to updated_at */
  var sWin = aMeta > bMeta ? a : (bMeta > aMeta ? b : win);

  var out = {}, k;
  for (k in lose) if (Object.prototype.hasOwnProperty.call(lose, k)) out[k] = lose[k];
  for (k in win) if (Object.prototype.hasOwnProperty.call(win, k)) out[k] = win[k];
  var SCALARS = ['name', 'status', 'currency', 'ownerId'];
  for (k = 0; k < SCALARS.length; k++) {
    if (sWin[SCALARS[k]] !== undefined) out[SCALARS[k]] = sWin[SCALARS[k]];
  }
  out.metaAt = slMax(a.metaAt, b.metaAt);
  if (!out.metaAt) delete out.metaAt;

  var at = slTomb(a), bt = slTomb(b);
  var exT = slMergeMap(at.ex, bt.ex), memT = slMergeMap(at.mem, bt.mem);
  out.tombstones = { ex: exT, mem: memT };

  out.expenses = slMergeList(lose.expenses, win.expenses, function (e) { return e.id; }, exT);
  out.settlements = slMergeList(lose.settlements, win.settlements, slSettleId, null);

  var members = {}, src = [lose.members || {}, win.members || {}], j;
  for (j = 0; j < src.length; j++) {
    for (k in src[j]) {
      if (!Object.prototype.hasOwnProperty.call(src[j], k)) continue;
      if (!(k in members) || slStamp(src[j][k]) >= slStamp(members[k])) members[k] = src[j][k];
    }
  }
  for (k in memT) if (slKilled(memT[k], members[k])) delete members[k];
  /* never orphan an expense: a member still referenced stays, tombstone or not */
  var used = {}, i2, e2;
  for (i2 = 0; i2 < out.expenses.length; i2++) {
    e2 = out.expenses[i2];
    if (e2.paidBy) used[e2.paidBy] = 1;
    if (e2.createdBy) used[e2.createdBy] = 1;
    for (k in (e2.splits || {})) if (+e2.splits[k] > 0) used[k] = 1;
  }
  for (i2 = 0; i2 < out.settlements.length; i2++) {
    if (out.settlements[i2].from) used[out.settlements[i2].from] = 1;
    if (out.settlements[i2].to) used[out.settlements[i2].to] = 1;
  }
  var allM = [lose.members || {}, win.members || {}];
  for (i2 = 0; i2 < allM.length; i2++) {
    for (k in allM[i2]) if (used[k] && !members[k]) members[k] = allM[i2][k];
  }
  out.members = members;

  /* Trip deletion is monotone: only a later undeletedAt brings it back. */
  var del = slMax(a.deletedAt, b.deletedAt), undel = slMax(a.undeletedAt, b.undeletedAt);
  if (undel) out.undeletedAt = undel; else delete out.undeletedAt;
  if (del && del > undel) { out.deletedAt = del; out.deletedBy = a.deletedAt === del ? a.deletedBy : b.deletedBy; }
  else { delete out.deletedAt; delete out.deletedBy; }

  out.rev = Math.max(+a.rev || 0, +b.rev || 0);
  out.updated_at = slMax(a.updated_at, b.updated_at);
  return out;
}
/* ---- end trip merge --------------------------------------------------------- */

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
  requireAuth: false,      // server: reject unauthenticated trip creates
  authCreateOnly: false,   // server: require sign-in to create a NEW trip
  ssoOnboarding: false,    // kept for older clients; v67 uses the login wall
  allowAnonymous: false,   // v67 kill switch — true unlocks the logged-out UI
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
          ssoOnboarding: !!cfg.ssoOnboarding,
          allowAnonymous: !!cfg.allowAnonymous,
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

      /* Join-while-signed-in never re-runs POST /auth/google, so invite claims
         used to live only on the device. A wiped PWA then could not restore
         trips whose member id is not one of the account uids (JB Shenanigans). */
      if (url.pathname === '/auth/claims' && request.method === 'POST') {
        const session = await sessionFrom(request, env);
        if (!session) return json({ error: 'Not signed in' }, 401);
        const user = await loadUser(sql, session.sub);
        if (!user) return json({ error: 'Account not found' }, 404);
        const payload = await request.json().catch(() => ({}));
        const merged = await adoptAndMerge(sql, user, cleanText(payload.uid, 80), payload.claims);
        await saveUser(sql, session.sub, merged);
        return json({ ok: true, claims: merged.claims || {}, uids: merged.uids || [],
                      tripCount: Object.keys(merged.claims || {}).length });
      }

      /* Play requires in-app account deletion. Trips are shared data and are
         deliberately NOT deleted — only the account record linking them. */
      if (url.pathname === '/auth/account' && request.method === 'DELETE') {
        const session = await sessionFrom(request, env);
        if (!session) return json({ error: 'Not signed in' }, 401);
        await sql`delete from trips where code = ${'U:' + session.sub}`;
        return json({ ok: true, deleted: true, note: 'Trips are shared with other members and were not deleted.' });
      }

      const patchHit = url.pathname.match(/^\/trips\/([A-Z0-9]{6})\/patch$/);
      if (patchHit) {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        const code = patchHit[1];
        if (RESERVED_CODES.has(code)) return json({ error: 'Trip not found' }, 404);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return json({ error: 'Invalid patch' }, 400);
        const incoming = { code, updated_at: body.updated_at || new Date().toISOString() };
        if (Array.isArray(body.expenses)) incoming.expenses = body.expenses;
        if (Array.isArray(body.settlements)) incoming.settlements = body.settlements;
        if (body.members && typeof body.members === 'object' && !Array.isArray(body.members)) incoming.members = body.members;
        if (body.tombstones && typeof body.tombstones === 'object') incoming.tombstones = body.tombstones;
        if (body.metaAt) {
          incoming.metaAt = body.metaAt;
          if (body.name !== undefined) incoming.name = body.name;
          if (body.status !== undefined) incoming.status = body.status;
          if (body.currency !== undefined) incoming.currency = body.currency;
          if (body.ownerId !== undefined) incoming.ownerId = body.ownerId;
        }
        if (body.deletedAt) { incoming.deletedAt = body.deletedAt; incoming.deletedBy = body.deletedBy; }
        if (body.undeletedAt) incoming.undeletedAt = body.undeletedAt;
        for (let attempt = 0; attempt < 5; attempt++) {
          const prior = await sql`select data from trips where code = ${code}`;
          if (!prior.length) return json({ error: 'Trip not found' }, 404);
          const priorRev = Math.floor(Number(prior[0].data && prior[0].data.rev)) || 0;
          const merged = slMergeTrips(prior[0].data, incoming);
          merged.rev = priorRev + 1;
          const upd = await sql`
            update trips set data = ${JSON.stringify(merged)}::jsonb, updated_at = now()
            where code = ${code} and coalesce((data->>'rev')::int, 0) = ${priorRev}
            returning data`;
          if (upd.length) return json({ trip: upd[0].data });
        }
        return json({ error: 'Trip is busy, please retry' }, 409);
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
        /* Deliberately NOT restamping trip.updated_at: the merge uses it to decide
           whose trip-level scalars win, and a server stamp would hand that to
           whichever stale client happened to push last. */
        if (!trip.updated_at) trip.updated_at = new Date().toISOString();
        /* Read-merge-write. The merge stops a stale client erasing what it never
           saw; the compare-and-swap on rev stops two simultaneous writers erasing
           each other between the read and the write. rev is an integer inside the
           JSON, not the updated_at column: timestamptz round-trips through the
           driver at millisecond precision and would almost never compare equal. */
        for (let attempt = 0; attempt < 5; attempt++) {
          const prior = await sql`select data from trips where code = ${code}`;
          if (!prior.length) {
            const fresh = Object.assign({}, trip, { rev: 1 });
            const ins = await sql`
              insert into trips (code, data, updated_at)
              values (${code}, ${JSON.stringify(fresh)}::jsonb, now())
              on conflict (code) do nothing
              returning data`;
            if (ins.length) return json({ trip: ins[0].data });
            continue;
          }
          const priorRev = Math.floor(Number(prior[0].data && prior[0].data.rev)) || 0;
          const merged = slMergeTrips(prior[0].data, trip);
          merged.rev = priorRev + 1;
          const upd = await sql`
            update trips set data = ${JSON.stringify(merged)}::jsonb, updated_at = now()
            where code = ${code} and coalesce((data->>'rev')::int, 0) = ${priorRev}
            returning data`;
          if (upd.length) return json({ trip: upd[0].data });
        }
        return json({ error: 'Trip is busy, please retry' }, 409);
      }

      return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, 500);
    }
  }
};
