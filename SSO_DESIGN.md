# SplitLah — Google sign-in design

Status: implemented in v62 (unenforced) · Aug 2026

## Goal

Let a person recover their identity and all their trips on any device by signing in, replacing the 5-minute single-use restore code. Close the lost-phone hole. Lay the groundwork for real write authorisation.

**Non-goals for v1:** per-field merge/CRDT sync, email or Apple sign-in, sharing trips with non-members, replacing invite links.

## Evidence so far

Measured with `auth-test.html` (v59+):

| Context | GIS button | One Tap | Redirect | Container | Deep link |
|---|---|---|---|---|---|
| Android TWA (Pixel 8) | pass | pass | pass | shared with Chrome | survived |
| Android Chrome (Pixel 8) | pass | pass | pass | shared with TWA | survived |
| iOS standalone PWA (iPad) | pass | pass | pass | held through redirect | n/a |
| iOS Safari | not tested | not tested | not tested | not compared | n/a |

Android shares storage between the TWA and Chrome, so **the continuity problem is iOS-only**. On Android, sign-in buys recovery and access control, not continuity.

**iOS is cleared.** Tested in the standalone home-screen app on iPad: all three modes pass, and after the Mode C redirect the container ID was unchanged (visits 4), so the OAuth round trip stays inside the app rather than handing off to Safari. Still worth confirming on a real iPhone before enforcement, but that is verification, not discovery.

## Core principle: the account is an index, not an identity

`uid` is not just an identity in SplitLah — it is the **member key inside every trip**: `members[uid]`, `ownerId`, every expense's `paidBy`, every key in `splits`, every settlement's `from`/`to`.

**Therefore: never rewrite member keys.** A Google account points *at* a set of `(tripCode → memberId)` claims; it does not replace them.

Rewriting would mean remapping several structures across trips that other people also hold local copies of — and their devices would push stale copies back over the migration, because `PUT` is last-write-wins with no field merge. That is a worse version of the v56 data loss.

## Schema

As shipped, accounts live in the existing single `trips` table under a `U:<google_sub>` code, which avoids a second store and inherits the existing upsert path. `legacy_uids` is a real table. See `neon.sql`.

```sql
create table if not exists legacy_uids (
  uid text primary key,
  seen_at timestamptz not null default now()
);
create index if not exists trips_members_idx on trips using gin ((data -> 'members'));
```

Account row shape: `{ sub, uids: [], claims: {TRIPCODE: memberId}, name, paynowProxy, email }`.

`uids` is an **array** and this is load-bearing. Chee Wee already has different `uid`s on phone, Safari, and desktop. A single-uid design would silently orphan trips claimed under the others — the same class of bug as the v52 `state.claims` regression.

## Endpoints

### `GET /config`

```json
{ "requireAuth": false, "authCreateOnly": true, "clientId": "...", "minVersion": 57 }
```

Read at boot, cached locally. **This is the kill switch.** If iOS sign-in breaks in the wild, flip `requireAuth` to `false` server-side and everyone is back in without a redeploy — critical, because a locked-out user sitting behind a cached service worker cannot reach the in-app "Check for update" button.

### `POST /auth/google`

Body: `{ idToken, uid, claims, name, paynowProxy }`

1. Fetch and cache Google's JWKS; verify the token signature.
2. Check `iss` is `accounts.google.com`, `aud` equals our client ID, `exp` is in the future, `nonce` matches if supplied.
3. Look up `google_sub`. If absent, create the row.
4. **Adopt and merge** (below).
5. Return `{ sessionToken, uid, claims, name, paynowProxy }`.

### `PUT /trips/:code` — changed

- Trip row exists → unchanged, no auth. Legacy users and invited friends unaffected.
- Trip row does **not** exist (a create) → require a valid session **unless** the `uid` is in `legacy_uids`.

Creation is the natural enforcement seam: real server-side enforcement, no disruption to anyone already using the app.

## Adopt and merge

Runs on **every** sign-in, not just the first. This is the part that must be right.

```
on sign-in with (google_sub, deviceUid, deviceClaims):
  user = users[google_sub]  or  create {uids: [], claims: {}}
  if deviceUid and deviceUid not in user.uids:
      user.uids.push(deviceUid)
  for (code, memberId) in deviceClaims:
      verify trip exists, not deletedAt, and trip.members[memberId] exists
      if valid and code not in user.claims:
          user.claims[code] = memberId
  # self-created trips are not in local claims — recover them by reverse lookup
  for uid in user.uids:
      for trip where trip.members[uid] exists and not deletedAt:
          if trip.code not in user.claims:
              user.claims[trip.code] = uid
  save
```

The reverse-lookup step is essential. `state.claims` is only populated when someone *joins* via an invite link — a trip you created yourself has no claim entry, and `me(t)` falls back to `state.uid`. Enumerating claims alone would silently exclude every self-created trip. This exact bug shipped in v52.

Returned claims are the **union**, so signing in on a second device merges rather than replaces.

## Session model

Do not gate the UI on a live token check. Google ID tokens expire in ~1 hour; SplitLah must stay usable on a trip with no signal.

- Issue our own session token (HMAC-signed, 90-day expiry) on sign-in.
- Store it locally; treat it as valid offline until its own expiry.
- The existing v57 outbox already queues writes and flushes on reconnect, so an expired session mid-trip degrades to "syncs later", not "cannot use the app".
- Re-authenticate silently on next launch with connectivity.

**Never** show a login wall to an already-signed-in user who happens to be offline. That would recreate the Kuantan failure with a different cause.

## Client changes

- `state.auth = { sessionToken, googleSub, signedInAt, email }`.
- Boot: read `/config` (cached, with a fallback to last known values).
- Sign-in entry in Edit profile; "Restore identity from another device" becomes a secondary option rather than the primary recovery path.
- After sign-in, apply returned claims through the existing `applyRestoreToken` path — that code already merges trips correctly and is proven.
- Send `Authorization: Bearer <sessionToken>` on writes when present.
- `createTrip()` checks `authCreateOnly` and prompts for sign-in when required.

## Rollout

1. Ship sign-in **unenforced**. `requireAuth: false`, `authCreateOnly: false`.
2. Chee Wee signs in on phone, Safari, and desktop; confirm one account holds every trip and `uids` has three entries.
3. Confirm iOS behaviour from the iPad, then a real iPhone.
4. Snapshot `legacy_uids`.
5. Flip `authCreateOnly: true`. Existing users notice nothing; new trips need an account.
6. Consider `requireAuth: true` later, with a sunset date announced for legacy anonymous writes.

Never flag-day it. Two auth paths are the price of not hurting anyone.

## Security fix shipped alongside

`/trips/:code` matched any six-character code, and `RSTORE` is six characters. A `GET /trips/RSTORE` returned the restore-token store — SHA-256 hashes of **six-digit** codes, which are trivially brute-forced offline. `FDBACK` was likewise readable. v62 blocks reserved codes from the trip routes, and excludes internal rows from `/admin/summary`.

## Risks and obligations

- **iOS standalone redirect** — the one unknown. Kill switch covers it.
- **Play Store**: apps offering account creation must also offer in-app account deletion *and* a public deletion URL. Real work, not a checkbox.
- **Data safety declaration** changes once emails are collected; `privacy.html` needs updating.
- **Consent screen**: publish it. With only `openid`/`email`/`profile` (non-sensitive) no verification review is required, and Testing mode caps at 100 users with refresh tokens expiring weekly.
- **Two auth paths persist** until the sunset date. Set one.

## Test plan

Extend the jsdom suites in `scripts/`:

- sign-in merges device claims without dropping existing ones
- second device with a different `uid` merges rather than replaces
- self-created trips recovered by reverse lookup (the v52 regression)
- expired session offline → app still usable, writes queue
- `requireAuth: false` restores access with no client change
- create blocked without auth; blocked create does **not** destroy the local trip
- tampered/expired/wrong-`aud` ID tokens rejected

The last two matter most: nothing in this feature may ever delete local data. See the local-first invariant in v57.
