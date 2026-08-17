/* SplitLah regression harness — concurrent edits between two members.
   Replays the 16 Aug 2026 incident: Chee Wee added "Foot massage" while his
   write was queued, Jinks added "Sourdough" from another device, and the
   whole-document PUT meant whoever synced last erased the other. Twice.

   The fake server here runs the SAME merge as worker.js — extracted from the
   file at run time, so this suite fails the moment the two drift apart.

   Usage: node test_concurrent_edits.cjs /path/to/index.html /path/to/worker.js   */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const FILE = process.argv[2] || path.join(__dirname, '..', 'index.html');
const WORKER = process.argv[3] || path.join(__dirname, '..', 'worker.js');
const html = fs.readFileSync(FILE, 'utf8');

const MERGE_RE = /\/\* ---- trip merge \(v65\)[\s\S]*?\/\* ---- end trip merge ---+ \*\//;
const workerMerge = (fs.readFileSync(WORKER, 'utf8').match(MERGE_RE) || [])[0];
const clientMerge = (html.match(MERGE_RE) || [])[0];

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   [' + extra + ']' : '')); }
};
const J = o => JSON.stringify(o);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The server side of the contract, loaded straight out of worker.js. */
const srvCtx = {};
new Function(workerMerge + '\nthis.slMergeTrips=slMergeTrips;').call(srvCtx);

/* One shared "database" that both devices talk to, behaving like the patched
   worker: stamp the incoming write, merge it onto what is already stored. */
function makeServer(seed) {
  const db = JSON.parse(J(seed || {}));
  return {
    db,
    get(code) { return db[code] ? JSON.parse(J(db[code])) : null; },
    /* Mirrors worker.js exactly: never restamp updated_at before merging, and
       compare-and-swap on the rev integer inside the JSON. The first draft of
       this harness did neither, which is how a CAS that could never match
       shipped past 81 green assertions. */
    put(code, trip) {
      if (!trip.updated_at) trip.updated_at = new Date().toISOString();
      if (!db[code]) { db[code] = Object.assign({}, trip, { rev: 1 }); return JSON.parse(J(db[code])); }
      const priorRev = Math.floor(Number(db[code].rev)) || 0;
      if (this.wedgeRev) { this.wedgeRev = false; db[code].rev = priorRev + 99; }
      const merged = srvCtx.slMergeTrips(db[code], trip);
      merged.rev = priorRev + 1;
      if ((Math.floor(Number(db[code].rev)) || 0) !== priorRev) { const e = new Error('Trip is busy'); e.status = 409; throw e; }
      db[code] = merged;
      return JSON.parse(J(db[code]));
    }
  };
}

/* A device. Several can share one server. */
function makeDevice(server, opts = {}) {
  const store = Object.assign({}, opts.storage || {});
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
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
          clear: () => { for (const k of Object.keys(store)) delete store[k]; },
          key: i => Object.keys(store)[i],
          get length() { return Object.keys(store).length; }
        }
      });
      if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, 'crypto', { configurable: true, value: require('crypto').webcrypto });
      w.fetch = async (url, init = {}) => {
        if (net.fail) throw new TypeError('Failed to fetch');
        const u = String(url), m = u.match(/\/trips\/([A-Z0-9]{6})$/);
        if (m) {
          const code = m[1];
          if ((init.method || 'GET') === 'GET') {
            const t = server.get(code);
            return t ? jsonRes({ trip: t }, 200) : jsonRes({ error: 'Trip not found' }, 404);
          }
          if (init.method === 'PUT') {
            try { return jsonRes({ trip: server.put(code, JSON.parse(init.body)) }, 200); }
            catch (e) { return jsonRes({ error: e.message }, e.status || 500); }
          }
        }
        const pm = u.match(/\/trips\/([A-Z0-9]{6})\/patch$/);
        if (pm && init.method === 'POST') {
          const code = pm[1];
          if (!server.get(code)) return jsonRes({ error: 'Trip not found' }, 404);
          try { return jsonRes({ trip: server.put(code, JSON.parse(init.body)) }, 200); }
          catch (e) { return jsonRes({ error: e.message }, e.status || 500); }
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
  return { w, net, store, ev: e => w.eval(e), st: () => w.eval('state'),
           trip: c => w.eval('state.trips["' + c + '"]') };
}

const TRIP = {
  code: 'OYL1X3', name: 'JB Shenanigans', currency: 'SGD', status: 'active', ownerId: 'u_cw',
  members: { u_cw: { name: 'Chee Wee', avatarColor: '#0ea371', paynowProxy: '' },
             m_j: { name: 'Jinks', avatarColor: '#3b82f6', paynowProxy: '' } },
  expenses: [
    { id: 'e1', desc: 'Meng Meng', amount: 29.2, currency: 'SGD', fxRate: 1, paidBy: 'm_j', createdBy: 'u_cw', created: '2026-05-03T04:00:00.000Z' },
    { id: 'e2', desc: 'Tea Garden', amount: 19.39, currency: 'SGD', fxRate: 1, paidBy: 'u_cw', createdBy: 'u_cw', created: '2026-06-06T04:00:00.000Z' }
  ],
  settlements: [], updated_at: '2026-08-16T00:00:00.000Z'
};
const exp = (id, desc, amount, by) => ({ id, desc, amount, currency: 'SGD', fxRate: 1, paidBy: by, createdBy: by,
  created: new Date().toISOString(), updatedAt: new Date().toISOString() });
const names = t => (t.expenses || []).map(e => e.desc).sort();

(async () => {
console.log('\n=== concurrent edits: ' + path.basename(FILE) + ' ===');

ok('[0] worker and client carry the same merge', !!workerMerge && workerMerge === clientMerge,
   workerMerge ? (clientMerge ? 'DRIFTED' : 'missing in index.html') : 'missing in worker.js');

/* [1] The exact incident. */
{
  console.log('\n[1] Chee Wee writes while offline, Jinks writes online');
  const server = makeServer({ OYL1X3: JSON.parse(J(TRIP)) });
  const cw = makeDevice(server), jinks = makeDevice(server);
  await sleep(120);

  cw.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');state.claims["OYL1X3"]="u_cw";save()');
  jinks.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');state.claims["OYL1X3"]="m_j";save()');

  /* Chee Wee adds Foot massage with no usable connection. */
  cw.net.fail = true;
  cw.ev('cur=state.trips["OYL1X3"];cur.expenses.push(' + J(exp('e_massage', 'Foot massage', 62.56, 'u_cw')) + ')');
  await cw.ev('push(cur)');
  ok('queued locally while the write cannot leave the device', !!cw.st().outbox['OYL1X3']);

  /* Jinks adds Sourdough and it lands. */
  jinks.ev('cur=state.trips["OYL1X3"];cur.expenses.push(' + J(exp('e_sour', 'Sourdough', 6.29, 'm_j')) + ')');
  await jinks.ev('push(cur)');
  ok('Jinks reaches the server', server.get('OYL1X3').expenses.some(e => e.desc === 'Sourdough'));

  /* THE OLD BUG #1: Chee Wee refreshes and cannot see Sourdough, because a
     queued write made pull() return his local copy and ignore the server. */
  cw.net.fail = false;
  await cw.ev('pull("OYL1X3")');
  ok('a queued write no longer blinds the device to other members',
     names(cw.trip('OYL1X3')).includes('Sourdough'), names(cw.trip('OYL1X3')).join(','));
  ok('his own unsent expense is still there', names(cw.trip('OYL1X3')).includes('Foot massage'));

  /* THE OLD BUG #2: his queued write flushes and erases Sourdough. */
  await cw.ev('flushOutbox(false)');
  const after = server.get('OYL1X3');
  ok('flushing the queue does NOT erase the other member', names(after).includes('Sourdough'), names(after).join(','));
  ok('and does deliver his own expense', names(after).includes('Foot massage'));
  ok('server holds all four expenses', after.expenses.length === 4, 'got ' + after.expenses.length);
  ok('outbox drained', Object.keys(cw.st().outbox).length === 0);

  await jinks.ev('pull("OYL1X3")');
  ok('Jinks converges on the same four', names(jinks.trip('OYL1X3')).length === 4);
  ok('both devices agree', J(names(jinks.trip('OYL1X3'))) === J(names(cw.trip('OYL1X3'))));
}

/* [2] Deleting still works — absence must not delete, but a tombstone must. */
{
  console.log('\n[2] A real delete propagates and is not resurrected');
  const server = makeServer({ OYL1X3: JSON.parse(J(TRIP)) });
  const cw = makeDevice(server), jinks = makeDevice(server);
  await sleep(120);
  cw.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');state.claims["OYL1X3"]="u_cw";cur=state.trips["OYL1X3"];save()');
  jinks.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');state.claims["OYL1X3"]="m_j";cur=state.trips["OYL1X3"];save()');

  await cw.ev('delExp("e2")');
  await sleep(30);
  ok('deleted expense gone from the server', !server.get('OYL1X3').expenses.some(e => e.id === 'e2'));
  ok('a tombstone was recorded', !!server.get('OYL1X3').tombstones.ex.e2);

  /* Jinks still holds e2 and pushes his stale copy. It must not come back. */
  jinks.ev('cur.expenses.push(' + J(exp('e_new', 'Kopi', 1.9, 'm_j')) + ')');
  await jinks.ev('push(cur)');
  const s = server.get('OYL1X3');
  ok('stale peer does not resurrect the deleted expense', !s.expenses.some(e => e.id === 'e2'), names(s).join(','));
  ok('and his new expense still lands', s.expenses.some(e => e.desc === 'Kopi'));
}

/* [3] A device that has been stale for weeks cannot roll the trip back.
       This is what Safari did tonight the moment CORS was fixed. */
{
  console.log('\n[3] A long-stale device flushes a queued write');
  const current = JSON.parse(J(TRIP));
  current.expenses.push(exp('e_a', 'Foot massage', 62.56, 'u_cw'), exp('e_b', 'Sourdough', 6.29, 'm_j'));
  current.updated_at = '2026-08-16T08:25:11.390Z';
  const server = makeServer({ OYL1X3: current });

  const stale = makeDevice(server);
  await sleep(120);
  const old = JSON.parse(J(TRIP));           // never saw either August expense
  old.pendingSync = true;
  stale.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(old) + ');state.outbox={OYL1X3:Date.now()};save()');
  await stale.ev('flushOutbox(false)');

  const s = server.get('OYL1X3');
  ok('August expenses survive the stale flush', names(s).includes('Foot massage') && names(s).includes('Sourdough'), names(s).join(','));
  ok('server did not shrink', s.expenses.length === 4, 'got ' + s.expenses.length);
}

/* [4] Three devices, interleaved, converge. */
{
  console.log('\n[4] Three devices converge');
  const server = makeServer({ OYL1X3: JSON.parse(J(TRIP)) });
  const a = makeDevice(server), b = makeDevice(server), c = makeDevice(server);
  await sleep(140);
  for (const [d, who] of [[a, 'u_cw'], [b, 'm_j'], [c, 'u_cw']]) {
    d.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');state.claims["OYL1X3"]="' + who + '";cur=state.trips["OYL1X3"];save()');
  }
  a.net.fail = b.net.fail = c.net.fail = true;
  a.ev('cur.expenses.push(' + J(exp('x1', 'Kopi', 1.9, 'u_cw')) + ')'); await a.ev('push(cur)');
  b.ev('cur.expenses.push(' + J(exp('x2', 'Ming Ang', 8.73, 'm_j')) + ')'); await b.ev('push(cur)');
  c.ev('cur.expenses.push(' + J(exp('x3', 'TnG Top Up', 50, 'u_cw')) + ')'); await c.ev('push(cur)');
  a.net.fail = b.net.fail = c.net.fail = false;
  await a.ev('flushOutbox(false)'); await b.ev('flushOutbox(false)'); await c.ev('flushOutbox(false)');
  await a.ev('pull("OYL1X3")'); await b.ev('pull("OYL1X3")'); await c.ev('pull("OYL1X3")');
  const want = J(['Kopi', 'Meng Meng', 'Ming Ang', 'Tea Garden', 'TnG Top Up']);
  ok('server has every expense', J(names(server.get('OYL1X3'))) === want, names(server.get('OYL1X3')).join(','));
  ok('device A converged', J(names(a.trip('OYL1X3'))) === want);
  ok('device B converged', J(names(b.trip('OYL1X3'))) === want);
  ok('device C converged', J(names(c.trip('OYL1X3'))) === want);
}


/* [5] The defects found by adversarial review of the first v65 draft. */
{
  console.log('\n[5] Review regressions, end to end');
  const server = makeServer({ OYL1X3: JSON.parse(J(TRIP)) });
  const cw = makeDevice(server);
  await sleep(120);
  cw.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');state.claims["OYL1X3"]="u_cw";state.name="Chee Wee";state.uid="u_cw";cur=state.trips["OYL1X3"];save()');

  /* rev CAS actually engages rather than 409-ing forever */
  await cw.ev('push(cur)');
  ok('a plain write succeeds against the CAS', server.get('OYL1X3').rev >= 1, 'rev=' + server.get('OYL1X3').rev);
  cw.ev('cur.members.u_cw.updatedAt=new Date().toISOString()');
  await cw.ev('push(cur)');
  ok('a second write also succeeds and bumps rev', server.get('OYL1X3').rev >= 2, 'rev=' + server.get('OYL1X3').rev);
  cw.ev('cur.members.u_cw.updatedAt=new Date().toISOString()');
  server.wedgeRev = true;
  await cw.ev('push(cur)');
  ok('a lost CAS race surfaces as 409 and keeps the write queued', !!cw.st().outbox['OYL1X3']);
  await cw.ev('flushOutbox(false)');
  ok('and the retry then succeeds', Object.keys(cw.st().outbox).length === 0);
  ok('nothing left stuck in the outbox', Object.keys(cw.st().outbox).length === 0);

  /* editing your own profile must not be reverted by the merge */
  cw.ev('state.name="Chee Wee Ng";state.paynowProxy="+6592222222";cur.members.u_cw.name="Chee Wee Ng";cur.members.u_cw.paynowProxy="+6592222222";cur.members.u_cw.updatedAt=new Date().toISOString()');
  await cw.ev('push(cur)');
  await sleep(40);
  ok('profile rename reaches the server', (server.get('OYL1X3').members.u_cw || {}).name === 'Chee Wee Ng',
     J((server.get('OYL1X3').members.u_cw || {}).name));
  await cw.ev('pull("OYL1X3")');
  ok('and survives a refresh', cw.trip('OYL1X3').members.u_cw.name === 'Chee Wee Ng');

  /* a stale peer flushing a queued write must not revert trip scalars */
  const stale = makeDevice(server);
  await sleep(120);
  const behind = JSON.parse(J(TRIP));
  behind.name = 'Old name'; behind.pendingSync = true;
  behind.expenses.push(exp('e_late', 'Late kopi', 1.9, 'm_j'));
  behind.updated_at = '2026-08-16T00:00:00.000Z';
  stale.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(behind) + ');state.outbox={OYL1X3:"x#1"};save()');
  await stale.ev('flushOutbox(false)');
  ok('stale peer did not revert the trip name', server.get('OYL1X3').name === 'JB Shenanigans', server.get('OYL1X3').name);
  ok('but its offline expense still landed', server.get('OYL1X3').expenses.some(e => e.desc === 'Late kopi'));
}

/* [6] one payment, two devices — must not double count */
{
  console.log('\n[6] The same transfer marked paid on two devices');
  const server = makeServer({ OYL1X3: JSON.parse(J(TRIP)) });
  const a = makeDevice(server), b = makeDevice(server);
  await sleep(120);
  const pay = { from: 'm_j', to: 'u_cw', amount: 50 };
  for (const d of [a, b]) d.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(TRIP) + ');cur=state.trips["OYL1X3"];settleTarget=' + J(pay) + ';pendingSettleReceiptUrl=null;save()');
  a.ev('markPaid()'); b.ev('markPaid()');
  await sleep(60);
  const n = server.get('OYL1X3').settlements.length;
  ok('one payment stored once, not twice', n === 1, 'got ' + n);
  const total = server.get('OYL1X3').settlements.reduce((s, x) => s + x.amount, 0);
  ok('and is counted once in the maths', total === 50, 'got ' + total);
}

/* [7] one trip the server rejects must not starve the rest of the queue */
{
  console.log('\n[7] A poisoned trip does not block the outbox');
  const server = makeServer({ GOODAA: Object.assign(JSON.parse(J(TRIP)), { code: 'GOODAA' }) });
  const d = makeDevice(server);
  await sleep(120);
  const bad = Object.assign(JSON.parse(J(TRIP)), { code: 'BADAAA', name: '' });   // fails validation forever
  const good = Object.assign(JSON.parse(J(TRIP)), { code: 'GOODAA' });
  good.expenses.push(exp('g1', 'Queued behind the bad one', 5, 'u_cw'));
  d.ev('state.trips["BADAAA"]=' + J(bad) + ';state.trips["GOODAA"]=normalizeTrip(' + J(good) + ');state.outbox={BADAAA:"a#1",GOODAA:"b#1"};save()');
  await d.ev('flushOutbox(false)');
  ok('the healthy trip synced despite the poisoned one ahead of it',
     server.get('GOODAA').expenses.some(e => e.desc === 'Queued behind the bad one'));
}

/* [8] A later expense is a patch, not a whole-document PUT */
{
  console.log('\n[8] Sparse patch does not resend the trip');
  const server = makeServer({ OYL1X3: JSON.parse(J(TRIP)) });
  const cw = makeDevice(server);
  await sleep(120);
  const seed = JSON.parse(J(TRIP));
  seed.rev = 3; seed.syncedAt = '2026-08-01T00:00:00.000Z'; seed.syncedStamp = '2026-08-01T00:00:00.000Z';
  cw.ev('state.trips["OYL1X3"]=normalizeTrip(' + J(seed) + ');state.claims["OYL1X3"]="u_cw";cur=state.trips["OYL1X3"];save()');
  const p0 = JSON.parse(cw.ev('JSON.stringify(tripPatch(state.trips["OYL1X3"]))'));
  ok('a synced trip has an empty patch', cw.ev('patchHasWork(' + J(p0) + ')') === false);
  cw.ev('cur.expenses.push(' + J(exp('e_new', 'Late kopi', 1.9, 'u_cw')) + ')');
  const p1 = JSON.parse(cw.ev('JSON.stringify(tripPatch(state.trips["OYL1X3"]))'));
  ok('patch carries only the new expense', (p1.expenses || []).length === 1 && p1.expenses[0].id === 'e_new', J(p1.expenses));
  ok('patch does not resend older expenses', !(p1.expenses || []).some(e => e.id === 'e1' || e.id === 'e2'));
  ok('patch omits members', !p1.members);
  await cw.ev('push(cur)');
  await sleep(40);
  const after = server.get('OYL1X3');
  ok('server kept the original expenses', after.expenses.some(e => e.id === 'e1') && after.expenses.some(e => e.id === 'e2'));
  ok('and accepted the new one', after.expenses.some(e => e.id === 'e_new'));
}

console.log('\n' + (fail ? '>>> FAILED' : '>>> ALL GOOD') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
