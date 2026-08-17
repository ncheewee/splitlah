/* The trip-merge rules exist twice: once in worker.js, once inline in
   index.html. They must stay byte-identical, comment included — a silent
   divergence would mean the server and the client disagree about which of two
   concurrent edits survives, which is exactly the class of bug v65 fixes.
   Usage: node merge_parity.cjs [index.html] [worker.js]                      */
const fs = require('fs'), path = require('path');
const A = process.argv[2] || path.join(__dirname, '..', 'index.html');
const B = process.argv[3] || path.join(__dirname, '..', 'worker.js');
const RE = /\/\* ---- trip merge \(v65\)[\s\S]*?\/\* ---- end trip merge ---+ \*\//;
const grab = f => { const m = fs.readFileSync(f, 'utf8').match(RE); return m && m[0]; };
const a = grab(A), b = grab(B);
let fail = 0;
const ok = (n, c, x) => { c ? console.log('  PASS  ' + n) : (fail++, console.log('  FAIL  ' + n + (x ? '  [' + x + ']' : ''))); };
console.log('\n[merge parity]');
ok('merge block present in ' + path.basename(A), !!a);
ok('merge block present in ' + path.basename(B), !!b);
ok('the two copies are byte-identical', !!a && a === b,
   a && b ? 'client ' + a.length + 'B vs worker ' + b.length + 'B' : 'missing');
if (a && b && a === b) {
  /* both copies must also actually run */
  for (const [name, src] of [['client', a], ['worker', b]]) {
    let m = null;
    try { const c = {}; new Function(src + '\nthis.m=slMergeTrips;').call(c); m = c.m; } catch (e) {}
    ok(name + ' copy evaluates and exports slMergeTrips', typeof m === 'function');
    if (typeof m === 'function') {
      const r = m({ code: 'X', expenses: [{ id: '1', desc: 'a' }], updated_at: '2026-01-01T00:00:00Z' },
                  { code: 'X', expenses: [{ id: '2', desc: 'b' }], updated_at: '2026-01-02T00:00:00Z' });
      ok(name + ' copy unions rather than replaces', r.expenses.length === 2, 'got ' + r.expenses.length);
    }
  }
}
console.log(fail ? '>>> DRIFT DETECTED\n' : '>>> in sync\n');
process.exit(fail ? 1 : 0);
