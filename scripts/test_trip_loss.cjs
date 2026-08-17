/* SplitLah regression harness — reproduces the "all trips vanished" bug on the
   old build and proves the v57 build no longer loses data.
   Usage: node test_trip_loss.js /path/to/index.html                            */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const FILE = process.argv[2];
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   [' + extra + ']' : '')); }
};

function makeEnv(opts = {}) {
  const server = opts.server || {};
  const store = Object.assign({}, opts.storage || {});
  const cfg = { quota: opts.quota || Infinity };
  const net = { fail: false };

  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const jsonRes = (body, status) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } });

  const dom = new JSDOM(html, {
    url: 'https://splitlah.example/app/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', {
        configurable: true,
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => {
            v = String(v);
            const total = Object.entries(store).reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0) + v.length;
            if (total > cfg.quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
            store[k] = v;
          },
          removeItem: k => { delete store[k]; },
          clear: () => { for (const k of Object.keys(store)) delete store[k]; },
          key: i => Object.keys(store)[i],
          get length() { return Object.keys(store).length; }
        }
      });
      if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, 'crypto', { configurable: true, value: require('crypto').webcrypto });
      w.fetch = async (url, init = {}) => {
        if (net.fail) throw new TypeError('Failed to fetch');           // poor connectivity
        const u = String(url), m = u.match(/\/trips\/([A-Z0-9]{6})$/);
        if (m) {
          const code = m[1];
          if ((init.method || 'GET') === 'GET') {
            if (!server[code]) return jsonRes({ error: 'Trip not found' }, 404);
            return jsonRes({ trip: JSON.parse(JSON.stringify(server[code])) }, 200);
          }
          if (init.method === 'PUT') {
            const trip = JSON.parse(init.body); trip.updated_at = new Date().toISOString();
            server[code] = trip; return jsonRes({ trip }, 200);
          }
        }
        const pm = u.match(/\/trips\/([A-Z0-9]{6})\/patch$/);
        if (pm && init.method === 'POST') {
          const code = pm[1];
          if (!server[code]) return jsonRes({ error: 'Trip not found' }, 404);
          const p = JSON.parse(init.body), t = server[code];
          if (p.expenses) {
            const by = {}; (t.expenses || []).forEach(e => { if (e && e.id) by[e.id] = e; });
            p.expenses.forEach(e => { if (e && e.id) by[e.id] = e; });
            t.expenses = Object.values(by);
          }
          t.updated_at = new Date().toISOString();
          return jsonRes({ trip: JSON.parse(JSON.stringify(t)) }, 200);
        }
        if (/\/health$/.test(u)) return jsonRes({ ok: true }, 200);
        return jsonRes({ error: 'Not found' }, 404);
      };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      w.scrollTo = () => {};
      w.Chart = function () { return { destroy() {} }; };
    }
  });
  const w = dom.window;
  return { w, server, store, net, cfg, ev: expr => w.eval(expr), st: () => w.eval('state') };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const saved = store => JSON.parse(store['sl_codex_v1'] || '{}');
const J = o => JSON.stringify(o);

(async () => {
console.log('\n=== ' + FILE + ' ===');

/* [1] THE REPORTED BUG: trip created while connectivity is poor, then opened. */
{
  console.log('\n[1] Trip created during poor connectivity, then auto-refreshed');
  const { ev, st, store, net } = makeEnv({});
  await sleep(80);
  ev('state.name="Chee Wee";state.onboarded=true;save()');
  const uid = st().uid;
  const kuantan = {
    id: 'k1', code: 'KUANTN', name: 'Kuantan trip', currency: 'SGD', ownerId: uid,
    members: { [uid]: { name: 'Chee Wee', avatarColor: '#0ea371', paynowProxy: '' } },
    expenses: [{ id: 'e1', desc: 'Petrol', amount: 80, originalAmount: 80, currency: 'SGD', fxRate: 1,
                 paidBy: uid, splitMode: 'equal', splits: null, at: new Date().toISOString(), date: '2026-08-09' }],
    settlements: [], updated_at: new Date().toISOString()
  };
  net.fail = true;                                   // connection drops
  await ev('push(' + J(kuantan) + ')');
  ok('trip kept locally when the upload fails', !!st().trips['KUANTN']);
  net.fail = false;                                  // back online — but the trip never reached the server
  await ev('openTrip("KUANTN")'); await sleep(40);
  for (let i = 0; i < 5; i++) { await ev('refreshTrip(true)'); await sleep(15); }   // the 12s auto-refresh loop
  const s = saved(store);
  ok('KUANTAN TRIP SURVIVES the 404 refresh loop', !!s.trips['KUANTN'], 'trips: ' + J(Object.keys(s.trips || {})));
  ok('its expenses survive', ((s.trips['KUANTN'] || {}).expenses || []).length === 1);
}

/* [2] Cascade — user taps through their trips while the API 404s. */
{
  console.log('\n[2] API returns 404 for every trip (outage); user opens each one');
  const { ev, st, store } = makeEnv({});
  await sleep(80);
  ev('state.name="Chee Wee";state.onboarded=true');
  const uid = st().uid;
  for (const c of ['AAAAAA', 'BBBBBB', 'CCCCCC']) {
    ev('state.trips["' + c + '"]=normalizeTrip(' + J({
      id: c, code: c, name: 'Trip ' + c, currency: 'SGD', ownerId: uid,
      members: { [uid]: { name: 'Chee Wee' } }, expenses: [], settlements: [],
      updated_at: new Date().toISOString(), syncedAt: new Date().toISOString()
    }) + ')');
  }
  ev('save()');
  for (const c of ['AAAAAA', 'BBBBBB', 'CCCCCC']) { await ev('openTrip("' + c + '")'); await sleep(25); await ev('refreshTrip(true)'); }
  const s = saved(store);
  ok('no trips destroyed by the outage', Object.keys(s.trips || {}).length === 3, 'left: ' + J(Object.keys(s.trips || {})));
}

/* [3] A real owner deletion must still take effect. */
{
  console.log('\n[3] Owner genuinely deleted the trip (server tombstone)');
  const server = { DELETD: { code: 'DELETD', name: 'Old trip', currency: 'SGD', ownerId: 'x',
    members: { x: { name: 'X' } }, expenses: [], settlements: [], deletedAt: new Date().toISOString() } };
  const { ev, store } = makeEnv({ server });
  await sleep(80);
  ev('state.name="Chee Wee";state.onboarded=true;state.trips["DELETD"]=normalizeTrip(' + J({
    code: 'DELETD', name: 'Old trip', currency: 'SGD', ownerId: 'x', members: { x: { name: 'X' } },
    expenses: [], settlements: [], syncedAt: new Date().toISOString() }) + ');save()');
  await ev('openTrip("DELETD")'); await sleep(25); await ev('refreshTrip(true)');
  const s = saved(store);
  ok('tombstoned trip leaves the trip list', !s.trips['DELETD']);
  ok('and is recoverable rather than shredded', !!(s.trash && s.trash['DELETD']));
}

/* [4] Reconnect flushes queued writes. */
{
  console.log('\n[4] Offline write re-uploads once connectivity returns');
  const { ev, st, server, net } = makeEnv({});
  await sleep(80);
  ev('state.name="Chee Wee";state.onboarded=true');
  const uid = st().uid;
  net.fail = true;
  await ev('push(' + J({ id: 'z', code: 'ZZZZZZ', name: 'Flaky trip', currency: 'SGD', ownerId: uid,
    members: { [uid]: { name: 'Chee Wee' } }, expenses: [], settlements: [] }) + ')');
  ok('queued in the outbox while offline', !!(st().outbox || {})['ZZZZZZ']);
  net.fail = false;
  try { await ev('flushOutbox(false)'); } catch (e) { fail++; console.log('  FAIL  flushOutbox exists  [' + e.message + ']'); }
  ok('uploaded to the server on reconnect', !!server['ZZZZZZ']);
  ok('outbox drained', Object.keys(st().outbox || {}).length === 0);
  ok('trip marked as synced', !!st().trips['ZZZZZZ'].syncedAt);
}

/* [5] Unsent local edits are not clobbered by a stale server copy. */
{
  console.log('\n[5] Unsent local edits survive a pull');
  const base = { code: 'EEEEEE', name: 'Trip E', currency: 'SGD', ownerId: 'me', members: { me: { name: 'Chee Wee' } },
    expenses: [], settlements: [], updated_at: new Date(Date.now() - 9e5).toISOString() };
  const { ev, st } = makeEnv({ server: { EEEEEE: JSON.parse(J(base)) } });
  await sleep(80);
  const local = JSON.parse(J(base));
  local.expenses.push({ id: 'local1', desc: 'Offline lunch', amount: 42, currency: 'SGD', fxRate: 1, paidBy: 'me' });
  local.pendingSync = true;
  ev('state.trips["EEEEEE"]=normalizeTrip(' + J(local) + ');state.outbox={EEEEEE:Date.now()};save()');
  try { await ev('pull("EEEEEE")'); } catch (e) {}
  ok('offline expense not overwritten by the server copy',
     (st().trips['EEEEEE'].expenses || []).some(e => e.id === 'local1'));
}

/* [6] Corrupt primary storage boots from the backup snapshot. */
{
  console.log('\n[6] Corrupted localStorage falls back to the backup');
  const backup = { at: new Date().toISOString(), state: { uid: 'u_old', name: 'Chee Wee', onboarded: true, appVersion: 56,
    trips: { BKPBKP: { code: 'BKPBKP', name: 'Backed up trip', currency: 'SGD', ownerId: 'u_old',
      members: { u_old: { name: 'Chee Wee' } }, expenses: [], settlements: [] } } } };
  const { st } = makeEnv({ storage: { 'sl_codex_v1': '{"trips":{"AAA"', 'sl_codex_v1_bak': J(backup) } });
  await sleep(80);
  let s = {};
  try { s = st() || {}; } catch (e) { s = {}; }
  ok('trips recovered from backup after corruption', !!(s.trips && s.trips['BKPBKP']), 'trips: ' + J(Object.keys(s.trips || {})));
  ok('identity preserved', s.uid === 'u_old');
}

/* [7] Quota exhaustion (inline receipt photos) must not break saving. */
{
  console.log('\n[7] localStorage full because of base64 receipt photos');
  const { ev, st, store } = makeEnv({ quota: 60000 });
  await sleep(80);
  const uid = st().uid;
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(80000);
  ev('state.name="Chee Wee";state.onboarded=true;state.trips["PHOTOS"]=normalizeTrip(' + J({
    code: 'PHOTOS', name: 'Photo trip', currency: 'SGD', ownerId: uid, members: { [uid]: { name: 'Chee Wee' } },
    expenses: [{ id: 'p1', desc: 'Dinner', amount: 100, currency: 'SGD', fxRate: 1, paidBy: uid, receiptUrl: big }],
    settlements: [] }) + ')');
  let threw = false;
  try { ev('save()'); } catch (e) { threw = true; }
  ok('save() does not throw on quota overflow', !threw);
  const s = saved(store);
  ok('ledger still persisted (photo dropped instead)', !!(s.trips && s.trips['PHOTOS']), 'keys: ' + J(Object.keys(s.trips || {})));
}

/* [8] Trip codes must always be exactly 6 chars, or the API 404s them. */
{
  console.log('\n[8] Trip code generator');
  const { ev } = makeEnv({});
  await sleep(80);
  const bad = ev('(function(){let b=0;for(let i=0;i<50000;i++){if(!/^[A-Z0-9]{6}$/.test(code()))b++}return b})()');
  ok('50000 generated codes all match /^[A-Z0-9]{6}$/', bad === 0, bad + ' malformed');
}

/* [9] Quota pressure must sacrifice the backup snapshot, not the payment proof. */
{
  console.log('\n[9] Storage pressure: backup is dropped before receipt photos');
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(38000);
  const { ev, store, cfg } = makeEnv({});
  await sleep(80);
  ev('state.name="Chee Wee";state.onboarded=true');
  ev('state.trips["OLDTRP"]=normalizeTrip(' + J({ code: 'OLDTRP', name: 'Older trip', currency: 'SGD', ownerId: 'me',
    members: { me: { name: 'Chee Wee' } }, expenses: [], settlements: [], syncedAt: new Date().toISOString() }) + ');save()');
  ok('a backup snapshot exists while there is room', !!store['sl_codex_v1_bak']);
  const bakLen = (store['sl_codex_v1_bak'] || '').length;
  ev('state.trips["SETTLD"]=normalizeTrip(' + J({
    code: 'SETTLD', name: 'Kuantan trip', currency: 'SGD', ownerId: 'me', status: 'closed',
    members: { me: { name: 'Chee Wee' } }, expenses: [],
    settlements: [{ from: 'me', to: 'friend', amount: 60, paidAt: new Date().toISOString(), receiptUrl: 'PHOTO' }],
    syncedAt: new Date().toISOString() }) + ')');
  ev('state.trips["SETTLD"].settlements[0].receiptUrl=' + J(photo) + ';save()');
  const mainLen = (store['sl_codex_v1'] || '').length;
  // now squeeze: the ledger fits on its own, but not alongside the backup
  cfg.quota = mainLen + Math.floor(bakLen / 2);
  ev('state.showArchived=true;save()');
  const s2 = saved(store);
  ok('closed+settled trip persisted', !!(s2.trips && s2.trips['SETTLD']));
  ok('PAYMENT PROOF PHOTO SURVIVED the squeeze',
     ((s2.trips['SETTLD'] || {}).settlements || [{}])[0].receiptUrl.length > 30000,
     'len ' + (((s2.trips['SETTLD'] || {}).settlements || [{}])[0] || {}).receiptUrl.length);
  ok('backup snapshot was sacrificed instead', !store['sl_codex_v1_bak']);
}

/* [10] A photo dropped from disk is still on the server and returns on pull. */
{
  console.log('\n[10] Photo dropped from disk is restored from the server');
  const photo = 'data:image/jpeg;base64,' + 'B'.repeat(5000);
  const server = { SETTLD: { code: 'SETTLD', name: 'Kuantan trip', currency: 'SGD', ownerId: 'me', status: 'closed',
    members: { me: { name: 'Chee Wee' } }, expenses: [],
    settlements: [{ from: 'me', to: 'friend', amount: 60, paidAt: new Date().toISOString(), receiptUrl: photo }],
    updated_at: new Date().toISOString() } };
  const { ev, st } = makeEnv({ server });
  await sleep(80);
  ev('state.trips["SETTLD"]=normalizeTrip(' + J({ code: 'SETTLD', name: 'Kuantan trip', currency: 'SGD', ownerId: 'me',
    status: 'closed', members: { me: { name: 'Chee Wee' } }, expenses: [],
    settlements: [{ from: 'me', to: 'friend', amount: 60, receiptUrl: '' }], syncedAt: new Date().toISOString() }) + ');save()');
  await ev('pull("SETTLD")');
  ok('payment proof restored from the server', (st().trips['SETTLD'].settlements[0].receiptUrl || '').length > 4000);
  ok('closed status preserved', st().trips['SETTLD'].status === 'closed');
}

console.log('\n' + (fail ? '>>> FAILED' : '>>> ALL GOOD') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
