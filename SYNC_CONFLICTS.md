# SplitLah — multi-member write conflicts (diagnosed v64, Aug 2026)

Status: **diagnosed, not fixed.** Written up after a live data loss on 16 Aug 2026.

## The incident

Chee Wee and Jinks were on the same trip.

1. Chee Wee added **"foot massage"** on poor connectivity → toast *"saved on this device only"*.
2. Jinks added **"sourdough"**. His `PUT` succeeded; the server row now had sourdough, no foot massage.
3. Chee Wee refreshed, force-closed and reopened the app repeatedly — **sourdough never appeared**.
4. Chee Wee signed out and back in via Google SSO. Foot massage synced, Jinks could see it —
   and **sourdough was gone from the server**, for everyone.

No connectivity glitch, no SSO bug. Both behaviours fall directly out of the current sync design.

## Root cause 1 — `PUT /trips/:code` is a whole-document overwrite

`worker.js`:

```js
insert into trips (code, data, updated_at)
values (${code}, ${body}::jsonb, now())
on conflict (code) do update set data = excluded.data, updated_at = now()
```

No field merge, no version check, no history. The last client to `PUT` wins the entire trip —
expenses, members, settlements, status, name. Whatever that client did not have in its local copy
ceases to exist for everybody.

This is a known property (recorded in the SSO memory note as "PUT is last-write-wins with no field
merge"), but its blast radius was underestimated: it is not only a risk for *stale* clients, it is
guaranteed loss whenever two members edit the same trip in the same window.

## Root cause 2 — `pendingSync` makes the client blind to the server

`index.html`, `pull()`:

```js
if(local && local.pendingSync){
  /* unsent local edits win; re-queue instead of clobbering */
  markLocal(c); save(); flushOutbox(); return normalizeTrip(local)
}
```

This guard was added in v57 to stop `pull()` clobbering unsent local work — that part is correct and
must stay. But it returns the local copy **without ever merging what the server sent back**, so while
*any* local edit is unsent:

- the 12s auto-refresh loop (`index.html:590`) shows nothing new,
- manual "refresh" shows nothing new,
- closing and reopening the app shows nothing new.

The trip data was sitting in the DB the whole time. The client was structurally incapable of
displaying it. This is step 3 of the incident.

## Root cause 3 — the one read-modify-write guard is disabled exactly when it is needed

`confirmAddExpense()` (`index.html:443`) does the right thing:

```js
await refreshTrip(true);      // pull latest first
cur.expenses.push(e);
await push(cur);
```

But `refreshTrip → pull` hits the `pendingSync` guard above and returns the *local* copy, so the
refresh is a no-op precisely in the case that matters. The read-modify-write silently degrades into
a blind overwrite.

Worse, several mutations skip the refresh entirely and `push(cur)` straight from local state:

| Call site | Line | Refreshes first? |
|---|---|---|
| `confirmAddExpense()` | 443 | yes (but defeated by the `pendingSync` guard) |
| `delExp()` | 450 | **no** |
| `addMember()` | 459 | **no** |
| `confirmJoinAsNew()` | 178 | **no** |
| settlements / trip edit / close / reopen | various | **no** |

So adding a member while another member adds an expense loses the expense — with both devices fully
online. The offline case is just the most reproducible instance.

## Root cause 4 — deletes are hard deletes, so a naive union-merge is not safe

```js
function delExp(id){ ...; cur.expenses = cur.expenses.filter(e => e.id !== id); push(cur) }
```

An expense removed by its creator simply vanishes from the array. There is no per-expense tombstone,
so "this expense is absent because I deleted it" is indistinguishable from "this expense is absent
because I have never seen it". Any server-side merge that unions expenses by `id` would resurrect
every deleted expense on the next push from a stale client.

**This is the constraint that shapes the fix.** Expense-level tombstones (`deletedAt`, `deletedBy`)
have to land before, or together with, any merge logic.

Expenses already carry a stable `id`, and members are keyed by `uid`, so the identity half of a merge
is already in place. Only the tombstones and the per-item timestamps are missing.

## Blast radius

- Any two members editing one trip concurrently. Poor connectivity widens the window from seconds to
  hours, but does not create the bug.
- Silent. No error, no conflict warning, no toast. The losing write simply never existed.
- Unrecoverable server-side: the `trips` row is overwritten in place with no history and no audit
  trail. Only Neon PITR could recover it, and only within the retention window.
- The victim is the member who was **online and working correctly**. The offline member's write is
  the one that survives.

## Fix options considered

### A. Server-side merge in the worker *(recommended)*

`PUT` merges instead of replacing: union `expenses` by `id` with newest-`updatedAt` wins, union
`members` by uid, same for `settlements`; scalars (name, status, currency) take the newer
`updated_at`. Requires per-expense `updatedAt` + `deletedAt` tombstones, and a client change to write
tombstones instead of filtering.

- Fixes every client at once, including stale TWA installs that never update.
- No dependency on client rollout — important given the service-worker caching problem noted in the
  SSO design.
- Largest change; needs its own regression suite alongside `scripts/test_trip_loss.js`.

### B. Optimistic concurrency + client-side merge

Client sends the `updated_at` it last saw; worker returns `409` if the row moved. Client re-pulls,
merges locally, retries.

- Much smaller worker change.
- Old clients on the current build keep clobbering until they update — and the TWA + service worker
  means "until they update" is not a bounded window.

### C. Minimum viable patch

Change `pull()` to merge server expenses into the local copy rather than returning local wholesale,
keeping the rule that unsent local items always survive. Does **not** stop the overwrite on
`flushOutbox()`, but the user would at least *see* the other member's data and could re-enter it.

- ~30 minutes. Buys time; does not fix the loss.

## Recovery from this incident

The sourdough expense is not recoverable from the API — the row was overwritten in place. Jinks'
device may still hold it in the rolling `sl_codex_v1_bak` localStorage snapshot if he has not
refreshed much since. Otherwise: re-enter it manually.

## Do not regress

- Keep the v57 invariant: never delete a local trip because a request failed. The `pendingSync`
  guard's *intent* is right; only its refusal to merge is wrong.
- Any merge work must ship with tests in `scripts/` that reproduce the two-member concurrent-edit
  case, not just the single-device trip-loss case.

---

## Status: fixed in v65 (17 Aug 2026)

Root causes 1–4 above are addressed. `slMergeTrips` lives byte-identically in
`worker.js` and `index.html`; `scripts/merge_parity.cjs` fails if they drift.

- Whole-document PUT replaced by read-merge-write, compare-and-swapped on a `rev`
  integer inside the JSON. **Not** on the `updated_at` column: timestamptz
  round-trips through the Neon driver at millisecond precision and would have
  429'd every write forever. That one nearly shipped.
- Deletion is a tombstone in `t.tombstones.{ex,mem}`, and a tombstone only kills
  an item OLDER than itself — so re-adding a removed member, or an edit racing a
  delete, survives. Live arrays hold only live items, so no reader changed.
- Trip scalars follow `metaAt`, a clock that moves only when a scalar changes.
  Using `updated_at` meant any device adding an expense reverted a rename it had
  never seen.
- A member referenced by a live expense or settlement is never removed, whatever
  the tombstones say — an orphaned `paidBy` drops that person out of the split
  maths and crashes the settle sheet.
- Settlement identity is `from|to|amount|YYYY-MM-DD`: two people tapping the same
  transfer merge, two genuine payments on different days do not.

Suites: `merge_parity`, `test_concurrent_edits` (replays the 16 Aug incident and
the Safari clobber), plus the existing `test_trip_loss`, `smoke`, `version_check`.

**v76:** existing trips flush a sparse `POST /trips/:code/patch` — only items
stamped after `syncedStamp`. Create still uses whole-document PUT. Pre-v76
clients keep PUTting; the worker still merges. Receipts that are `data:` URLs
still travel with that one new expense.

**Known, not fixed:** `removeMember`'s in-use guard is still local-only (the merge
now prevents the resulting orphan, but the UI can still offer the removal); pre-v65
expenses have no true edit time, so two divergent copies tie and resolve
arbitrarily; receipts are still inline on the expense they belong to.
