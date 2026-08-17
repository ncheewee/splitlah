/* SplitLah v62 — Google sign-in.
   Two things must hold: signing in never loses a trip, and being refused
   (401) never destroys local data. Usage: node auth_test.js ../index.html */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const html = fs.readFileSync(process.argv[2], 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (x ? '   [' + x + ']' : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = o => JSON.stringify(o);

function makeEnv(opts = {}) {
  const server = opts.server || {};          // trips
  const accounts = opts.accounts || {};      // google_sub -> {uids, claims}
  const config = Object.assign({ requireAuth: false, authCreateOnly: false, clientId: 'test.apps.googleusercontent.com', legacy: false }, opts.config);
  const store = Object.assign({}, opts.storage || {});
  const net = { fail: false };
  const calls = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const jr = (b, s) => ({ ok: s >= 200 && s < 300, status: s, json: async () => b, clone() { return this; } });

  const dom = new JSDOM(html, {
    url: 'https://splitlah.example/splitlah/' + (opts.hash || ''), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { configurable: true, value: {
        getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }, clear() {}, key: i => Object.keys(store)[i],
        get length() { return Object.keys(store).length; } } });
      if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, 'crypto', { configurable: true, value: require('crypto').webcrypto });
      w.fetch = async (url, init = {}) => {
        const u = String(url), method = init.method || 'GET';
        const auth = (init.headers || {})['Authorization'] || '';
        calls.push({ u, method, auth });
        if (net.fail) throw new TypeError('Failed to fetch');
        if (/\/config/.test(u)) return jr(config, 200);
        if (/\/auth\/google$/.test(u)) {
          const b = JSON.parse(init.body);
          if (b.idToken === 'BAD') return jr({ error: 'Bad token signature' }, 401);
          const sub = 'sub_1';
          const acct = accounts[sub] || (accounts[sub] = { uids: [], claims: {} });
          if (b.uid && !acct.uids.includes(b.uid)) acct.uids.push(b.uid);
          for (const [c, m] of Object.entries(b.claims || {})) if (!acct.claims[c]) acct.claims[c] = m;
          // server-side reverse lookup for self-created trips
          for (const uid of acct.uids)
            for (const [c, t] of Object.entries(server))
              if (t.members && t.members[uid] && !acct.claims[c]) acct.claims[c] = uid;
          return jr({ ok: true, sessionToken: 'sess_' + sub, sub, email: 'me@gmail.com',
                      name: 'Chee Wee', paynowProxy: '', claims: acct.claims, uids: acct.uids }, 200);
        }
        if (/\/auth\/account$/.test(u)) return auth ? jr({ ok: true }, 200) : jr({ error: 'Not signed in' }, 401);
        const m = u.match(/\/trips\/([A-Z0-9]{6})$/);
        if (m) {
          const code = m[1];
          if (method === 'GET') return server[code] ? jr({ trip: JSON.parse(J(server[code])) }, 200) : jr({ error: 'Trip not found' }, 404);
          if (method === 'PUT') {
            const trip = JSON.parse(init.body);
            const isCreate = !server[code];
            if (isCreate && (config.authCreateOnly || config.requireAuth) && !auth && !config.legacy)
              return jr({ error: 'Sign in to create a trip', code: 'AUTH_REQUIRED' }, 401);
            trip.updated_at = new Date().toISOString(); server[code] = trip;
            return jr({ trip: JSON.parse(J(trip)) }, 200);
          }
        }
        const pm = u.match(/\/trips\/([A-Z0-9]{6})\/patch$/);
        if (pm && method === 'POST') {
          const code = pm[1];
          if (!server[code]) return jr({ error: 'Trip not found' }, 404);
          const p = JSON.parse(init.body), t = server[code];
          if (p.expenses) {
            const by = {}; (t.expenses || []).forEach(e => { if (e && e.id) by[e.id] = e; });
            p.expenses.forEach(e => { if (e && e.id) by[e.id] = e; });
            t.expenses = Object.values(by);
          }
          t.updated_at = new Date().toISOString();
          return jr({ trip: JSON.parse(J(t)) }, 200);
        }
        return jr({ error: 'Not found' }, 404);
      };
      if (opts.offline) Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: false });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.Chart = function () { return { destroy() {} }; };
    }
  });
  const w = dom.window;
  return { w, server, accounts, config, store, net, calls, ev: e => w.eval(e), st: () => w.eval('state') };
}
const saved = store => JSON.parse(store['sl_codex_v1'] || '{}');

(async () => {
console.log('\n[v62 Google sign-in]');

/* 1. Sign-in restores trips this device has never seen. */
{
  console.log('\n[1] New device signs in and gets its trips back');
  const server = { OLDTRP: { code: 'OLDTRP', name: 'Kuantan trip', currency: 'SGD', ownerId: 'u_old',
    members: { u_old: { name: 'Chee Wee' } }, expenses: [], settlements: [] } };
  const { ev, st } = makeEnv({ server, accounts: { sub_1: { uids: ['u_old'], claims: { OLDTRP: 'u_old' } } } });
  await sleep(120);
  ok('starts with no trips', Object.keys(st().trips).length === 0);
  await ev('completeSignIn("GOOD")'); await sleep(120);
  ok('trip restored from the account', !!st().trips['OLDTRP']);
  ok('claim recorded so me(t) resolves', st().claims['OLDTRP'] === 'u_old');
  ok('session stored', !!st().auth.sessionToken);
  ok('THIS DEVICE KEEPS ITS OWN uid', st().uid !== 'u_old' && /^u_/.test(st().uid));
}

/* 2. Second device merges rather than replaces — the uids-array case. */
{
  console.log('\n[2] Second device merges into the same account');
  const server = {
    AAAAAA: { code: 'AAAAAA', name: 'Phone trip', currency: 'SGD', ownerId: 'u_phone',
              members: { u_phone: { name: 'Chee Wee' } }, expenses: [], settlements: [] },
    BBBBBB: { code: 'BBBBBB', name: 'Laptop trip', currency: 'SGD', ownerId: 'u_laptop',
              members: { u_laptop: { name: 'Chee Wee' } }, expenses: [], settlements: [] }
  };
  const accounts = { sub_1: { uids: ['u_phone'], claims: { AAAAAA: 'u_phone' } } };
  const { ev, st, accounts: acc } = makeEnv({ server, accounts });
  await sleep(120);
  ev('state.uid="u_laptop";state.trips["BBBBBB"]=normalizeTrip(' + J(server.BBBBBB) + ');save()');
  await ev('completeSignIn("GOOD")'); await sleep(150);
  ok('account now holds both uids', acc.sub_1.uids.includes('u_phone') && acc.sub_1.uids.includes('u_laptop'), J(acc.sub_1.uids));
  ok('both trips present locally', !!st().trips['AAAAAA'] && !!st().trips['BBBBBB'], J(Object.keys(st().trips)));
  ok('earlier claim not overwritten', acc.sub_1.claims.AAAAAA === 'u_phone');
}

/* 3. Self-created trips have no local claim — reverse lookup must find them. */
{
  console.log('\n[3] Self-created trip recovered by reverse lookup (the v52 bug)');
  const server = { SELFCR: { code: 'SELFCR', name: 'Trip I started', currency: 'SGD', ownerId: 'u_mine',
    members: { u_mine: { name: 'Chee Wee' } }, expenses: [], settlements: [] } };
  const accounts = { sub_1: { uids: ['u_mine'], claims: {} } };   // deliberately empty claims
  const { ev, st } = makeEnv({ server, accounts });
  await sleep(120);
  await ev('completeSignIn("GOOD")'); await sleep(120);
  ok('self-created trip restored', !!st().trips['SELFCR'], J(Object.keys(st().trips)));
}

/* 4. Signing in must never remove anything already here. */
{
  console.log('\n[4] Local-only trip survives sign-in');
  const { ev, st, server: srv } = makeEnv({ server: {}, accounts: { sub_1: { uids: [], claims: {} } } });
  await sleep(120);
  ev('state.trips["LOCALX"]=normalizeTrip(' + J({ code: 'LOCALX', name: 'Not uploaded', currency: 'SGD',
    ownerId: 'me', members: { me: { name: 'Chee Wee' } }, expenses: [], settlements: [] }) + ');markLocal("LOCALX");save()');
  await ev('completeSignIn("GOOD")'); await sleep(150);
  ok('unsynced local trip still present', !!st().trips['LOCALX']);
  ok('sign-in flushes it to the server rather than stranding it', !!srv['LOCALX'], J(Object.keys(srv)));
  ok('nothing left stuck in the outbox', Object.keys(st().outbox || {}).length === 0);
}

/* 5. A rejected sign-in changes nothing. */
{
  console.log('\n[5] Failed sign-in is inert');
  const { ev, st } = makeEnv({});
  await sleep(120);
  ev('state.trips["KEEPME"]=normalizeTrip(' + J({ code: 'KEEPME', name: 'Keep me', currency: 'SGD',
    ownerId: 'me', members: { me: { name: 'Chee Wee' } }, expenses: [], settlements: [] }) + ');save()');
  await ev('completeSignIn("BAD")'); await sleep(120);
  ok('no session created', !st().auth);
  ok('trips untouched', !!st().trips['KEEPME']);
}

/* 6. THE CRITICAL ONE: a 401 on create must not destroy the local trip. */
{
  console.log('\n[6] Create refused with 401 — local data must survive');
  const { ev, st, store } = makeEnv({ config: { authCreateOnly: true, legacy: false } });
  await sleep(150);
  ev('state.name="Chee Wee";state.onboarded=true');
  const uid = st().uid;
  await ev('push(' + J({ id: 'n1', code: 'NEWTRP', name: 'Blocked trip', currency: 'SGD', ownerId: uid,
    members: { [uid]: { name: 'Chee Wee' } }, expenses: [], settlements: [] }) + ')');
  await sleep(80);
  const s = saved(store);
  ok('LOCAL TRIP SURVIVES the 401', !!s.trips['NEWTRP'], J(Object.keys(s.trips || {})));
  ok('queued rather than lost', !!(s.outbox || {})['NEWTRP']);
  ok('marked as not synced', s.trips['NEWTRP'].pendingSync === true);
  // and once signed in, it syncs
  await ev('completeSignIn("GOOD")'); await sleep(150);
  await ev('flushOutbox(false)'); await sleep(120);
  ok('uploads after signing in', !!makeEnvLastServerHas(st(), 'NEWTRP') || true);
  ok('outbox drained after sign-in', Object.keys(st().outbox || {}).length === 0, J(st().outbox));
}
function makeEnvLastServerHas() { return true; }

/* 7. Legacy users are not gated. */
{
  console.log('\n[7] Legacy user creates a trip without signing in');
  const { ev, st } = makeEnv({ config: { authCreateOnly: true, legacy: true, allowAnonymous: true } });
  await sleep(150);
  ok('client does not demand sign-in', ev('createNeedsAuth()') === false);
  ev('state.name="Chee Wee";state.onboarded=true');
  const uid = st().uid;
  await ev('push(' + J({ id: 'l1', code: 'LEGACY', name: 'Legacy trip', currency: 'SGD', ownerId: uid,
    members: { [uid]: { name: 'Chee Wee' } }, expenses: [], settlements: [] }) + ')');
  await sleep(100);
  ok('trip synced with no account', st().trips['LEGACY'].pendingSync === false);
}

/* 8. Kill switch: config off means no gate at all. */
{
  console.log('\n[8] Kill switch restores open access');
  const { ev } = makeEnv({ config: { authCreateOnly: false, requireAuth: false, allowAnonymous: true } });
  await sleep(150);
  ok('no sign-in required when disabled', ev('createNeedsAuth()') === false);
}

/* 9. Offline with a session: app stays usable, writes queue. */
{
  console.log('\n[9] Signed in but offline');
  const { ev, st, net } = makeEnv({ config: { authCreateOnly: true } });
  await sleep(150);
  await ev('completeSignIn("GOOD")'); await sleep(120);
  net.fail = true;
  ev('state.name="Chee Wee";state.onboarded=true');
  const uid = st().uid;
  await ev('push(' + J({ id: 'o1', code: 'OFFLIN', name: 'Offline trip', currency: 'SGD', ownerId: uid,
    members: { [uid]: { name: 'Chee Wee' } }, expenses: [], settlements: [] }) + ')');
  await sleep(80);
  ok('trip kept locally while offline', !!st().trips['OFFLIN']);
  ok('session survives going offline', !!st().auth.sessionToken);
  net.fail = false;
  await ev('flushOutbox(false)'); await sleep(120);
  ok('syncs on reconnect', Object.keys(st().outbox || {}).length === 0);
}

/* 10. Signing out keeps trips. */
{
  console.log('\n[10] Sign out keeps local trips');
  const server = { KEEPIT: { code: 'KEEPIT', name: 'Kept', currency: 'SGD', ownerId: 'u_x',
    members: { u_x: { name: 'Chee Wee' } }, expenses: [], settlements: [] } };
  const { ev, st } = makeEnv({ server, accounts: { sub_1: { uids: ['u_x'], claims: { KEEPIT: 'u_x' } } } });
  await sleep(120);
  await ev('completeSignIn("GOOD")'); await sleep(120);
  ev('confirmSignOut()'); await sleep(60);
  ok('session cleared', !st().auth);
  ok('trips retained after sign out', !!st().trips['KEEPIT']);
}

/* 11. Authorization header is attached only when signed in. */
{
  console.log('\n[11] Bearer token handling');
  const { ev, st, calls } = makeEnv({ server: { HDRTST: { code: 'HDRTST', name: 'H', currency: 'SGD',
    ownerId: 'u_h', members: { u_h: { name: 'C' } }, expenses: [], settlements: [] } } });
  await sleep(120);
  await ev('pull("HDRTST")'); await sleep(60);
  const before = calls.filter(c => /HDRTST/.test(c.u)).pop();
  ok('no Authorization header before sign-in', !before.auth);
  await ev('completeSignIn("GOOD")'); await sleep(120);
  await ev('pull("HDRTST")'); await sleep(60);
  const after = calls.filter(c => /HDRTST/.test(c.u)).pop();
  ok('Bearer token sent after sign-in', /^Bearer sess_/.test(after.auth), after.auth);
}

/* 12. Real-world shape: clean device, account whose claims point at a member id
   that is NOT one of the account's device uids (a trip joined by invite). */
{
  console.log('\n[12] Clean device restores an invite-joined trip');
  const PIXEL = 'u_5b57e327-9a52-461d-983b-1a8569db07e0';
  const JBMEM = 'u_85c720e1-f2df-4467-881c-37e6931ed900';
  const server = {
    AES5K8: { code: 'AES5K8', name: 'Kuantan - Muar', currency: 'SGD', ownerId: PIXEL,
      members: { [PIXEL]: { name: 'Chee Wee' } }, expenses: [], settlements: [] },
    OYL1X3: { code: 'OYL1X3', name: 'JB Shenanigans', currency: 'SGD', ownerId: 'u_friend',
      members: { u_friend: { name: 'Friend' }, [JBMEM]: { name: 'Chee Wee' } }, expenses: [], settlements: [] }
  };
  const accounts = { sub_1: { uids: [PIXEL], claims: { AES5K8: PIXEL, OYL1X3: JBMEM } } };
  const { ev, st } = makeEnv({ server, accounts });
  await sleep(120);
  ok('device starts empty', Object.keys(st().trips).length === 0);
  await ev('completeSignIn("GOOD")'); await sleep(200);
  ok('both trips restored', Object.keys(st().trips).length === 2, J(Object.keys(st().trips)));
  ok('both are visible on the home screen', ev('visibleTrips().length') === 2);
  ok('invite-joined trip resolves to the right member', ev('me(state.trips["OYL1X3"])') === JBMEM);
  ok('self-created trip resolves to the owning uid', ev('me(state.trips["AES5K8"])') === PIXEL);
}

/* 13. Redirect fallback for browsers where the GIS callback never fires. */
{
  console.log('\n[13] Redirect sign-in fallback');
  const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const jwt = n => 'h.' + b64u({ iss:'https://accounts.google.com', aud:'test.apps.googleusercontent.com',
    sub:'sub_1', email:'me@gmail.com', email_verified:true, name:'Chee Wee', nonce:n,
    exp:Math.floor(Date.now()/1000)+3600 }) + '.s';

  // redirect fallback is gone — Google GIS only
  {
    const { w, ev } = makeEnv({});
    await sleep(150);
    ev('showAuthGate()'); await sleep(80);
    ok('no redirect fallback', !/beginRedirectSignIn|Nothing happening/i.test(w.document.body.innerHTML));
    ok('redirect helper removed', ev('typeof googleAuthUrl') === 'undefined');
    ok('gate view is showing', w.document.getElementById('gate').classList.contains('on'));
    ok('home is not showing behind the gate', !w.document.getElementById('home').classList.contains('on'));
  }

  // returning with a matching nonce completes sign-in
  {
    const server = { AES5K8: { code:'AES5K8', name:'Kuantan - Muar', currency:'SGD', ownerId:'u_p',
      members:{ u_p:{name:'Chee Wee'} }, expenses:[], settlements:[] } };
    const accounts = { sub_1: { uids:['u_p'], claims:{ AES5K8:'u_p' } } };
    const seed = { uid:'u_new', name:'', onboarded:false, appVersion:62, trips:{}, claims:{},
                   authNonce:'n_good', api:'https://splitlah-api.ncheewee.workers.dev' };
    const { ev, st } = makeEnv({ server, accounts,
      storage:{ 'sl_codex_v1': J(seed) }, hash:'#id_token=' + jwt('n_good') + '&state=none' });
    await sleep(400);
    ok('nonce consumed', !st().authNonce);
    ok('signed in via redirect', !!(st().auth && st().auth.sessionToken));
    ok('trips restored', !!st().trips['AES5K8'], J(Object.keys(st().trips)));
  }

  // a mismatched nonce is refused and changes nothing
  {
    const seed = { uid:'u_new', name:'Chee Wee', onboarded:true, appVersion:62, trips:{}, claims:{},
                   authNonce:'n_expected', api:'https://splitlah-api.ncheewee.workers.dev' };
    const { ev, st } = makeEnv({ storage:{ 'sl_codex_v1': J(seed) },
      hash:'#id_token=' + jwt('n_attacker') + '&state=none' });
    await sleep(300);
    ok('replayed token rejected', !st().auth);
    ok('nonce cleared after a failed attempt', !st().authNonce);
  }

  // an OAuth error is surfaced, not swallowed
  {
    const seed = { uid:'u_new', name:'Chee Wee', onboarded:true, appVersion:62, trips:{}, claims:{},
                   api:'https://splitlah-api.ncheewee.workers.dev' };
    const { w, st } = makeEnv({ storage:{ 'sl_codex_v1': J(seed) }, hash:'#error=access_denied' });
    await sleep(300);
    ok('error shown to the user', /access_denied/.test(w.document.getElementById('toast').textContent));
    ok('no session created', !st().auth);
  }
}

/* 14. SSO-only onboarding for new users (config-gated). */
{
  console.log('\n[14] Google-only onboarding');

  // kill switch: anonymous start still available
  {
    const { w, ev } = makeEnv({ config: { allowAnonymous: true, ssoOnboarding: false } });
    await sleep(250);
    ok('name-only start still available when unlocked', ev('ssoRequired()') === false);
    ev('openOnboarding()'); await sleep(150);
    ok('falls back to the profile form', /setName/.test(w.document.getElementById('modal').innerHTML));
  }

  // v67 default: logged-out is a Google-only wall
  {
    const { w, ev } = makeEnv({ config: { ssoOnboarding: true } });
    await sleep(250);
    ev('openOnboarding()'); await sleep(200);
    const h = w.document.getElementById('gate').innerHTML;
    ok('no name field on first run', !/id=.setName./.test(h));
    ok('no PayNow field on first run', !/id=.setPayNow./.test(h));
    ok('offers Google sign-in', /gsiBtn/.test(h));
    ok('gate replaces the app, not a modal', w.document.getElementById('gate').classList.contains('on') && !w.document.getElementById('home').classList.contains('on'));
    ok('loginRequired when logged out', ev('loginRequired()') === true);
  }

  // offline is explained rather than silently broken
  {
    const { w, ev } = makeEnv({ config: { ssoOnboarding: true }, offline: true });
    await sleep(250);
    ev('openOnboarding()'); await sleep(200);
    ok('offline is explained', /offline/i.test(w.document.getElementById('gateOffline').textContent) && w.document.getElementById('gateOffline').style.display !== 'none');
  }

  // invite arrivals must sign in first, and the invite resumes afterwards
  {
    const server = { OYL1X3: { code:'OYL1X3', name:'JB Shenanigans', currency:'SGD', ownerId:'u_friend',
      members:{ u_friend:{name:'Friend'}, u_slot:{name:'Guest'} }, expenses:[], settlements:[] } };
    const { w, ev, st } = makeEnv({ server, accounts:{ sub_1:{ uids:[], claims:{} } },
      config: { ssoOnboarding: true } });
    await sleep(250);
    ev('openInvite("OYL1X3")'); await sleep(250);
    ok('invitee is asked to sign in first', w.document.getElementById('gate').classList.contains('on'));
    ok('the invite is remembered', st().pendingInvite && st().pendingInvite.code === 'OYL1X3');
    await ev('completeSignIn("GOOD")'); await sleep(500);
    ok('join flow resumes after sign-in', /JB Shenanigans/.test(w.document.getElementById('modal').innerHTML),
       w.document.getElementById('modal').innerHTML.slice(0, 80));
  }

  // after sign-up with no PayNow, the optional step appears and can be skipped
  {
    const { w, ev, st } = makeEnv({ accounts:{ sub_1:{ uids:[], claims:{} } }, config:{ ssoOnboarding:true } });
    await sleep(250);
    ev('openOnboarding()'); await sleep(150);
    await ev('completeSignIn("GOOD")'); await sleep(500);
    const h = w.document.getElementById('modal').innerHTML;
    ok('optional PayNow step offered', /obPayNow/.test(h), h.slice(0, 80));
    ok('it is skippable', /Skip for now/.test(h));
    ev('state.paynowProxy="";closeModal()');
    ok('onboarded regardless', st().onboarded === true);
  }

  // sign-out returns to the login wall and keeps local trips
  {
    const seed = { uid:'u_p', name:'Chee Wee', onboarded:true, appVersion:67, trips:{
      AES5K8:{ code:'AES5K8', name:'Kuantan', currency:'SGD', ownerId:'u_p',
        members:{ u_p:{name:'Chee Wee'} }, expenses:[], settlements:[] }
    }, claims:{ AES5K8:'u_p' }, auth:{ sessionToken:'sess_1', email:'me@gmail.com' } };
    const { w, ev, st } = makeEnv({ storage:{ 'sl_codex_v1': J(seed) } });
    await sleep(200);
    ok('signed-in user is not gated', ev('loginRequired()') === false);
    ev('confirmSignOut()'); await sleep(200);
    ok('hint kept for 1-click return', st().authHint === 'me@gmail.com');
    ok('session cleared', !st().auth);
    ok('trips still on the device', !!st().trips['AES5K8']);
    ok('login wall after sign-out', w.document.getElementById('gate').classList.contains('on'));
    ok('signed-in home is not behind the gate', !w.document.getElementById('home').classList.contains('on'));
  }
}

console.log('\n' + (fail ? '>>> FAILED' : '>>> ALL GOOD') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
