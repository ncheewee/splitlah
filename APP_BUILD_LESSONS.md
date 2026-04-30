# App Build Lessons From SplitLah

This note captures what the SplitLah Codex cycles taught us about building small real-world apps faster, with fewer missed UX issues and less back-and-forth. It is written for future app builds before the first beta, not as a post-mortem for blame.

## What The User Was Really Trying To Achieve

The goal was not just "make an expense splitter." The real goal was:

- A low-friction trip expense app that ordinary friends can use without setup anxiety.
- A product that feels shareable and native enough for beta testers to install, open, join, add expenses, inspect receipts, and settle without guidance.
- A practical MVP that avoids heavy authentication at first, but still gives enough control: trip ownership, expense creator controls, profile editing, trip deletion, and admin visibility.
- A beta loop where user confusion and bugs can be captured quickly, reviewed by the builder, and turned into focused iteration cycles.
- A Codex-vs-Claude A/B test where the public build identity is obvious and GitHub Pages can be deliberately pointed at the correct branch.

The lesson: future builds should start with the user’s social workflow, not the app’s feature list. For SplitLah, the real workflow was "I share a trip link with friends, they join from different phones, everyone records messy real expenses, then we settle with a payment app."

## Decisions That Shaped The Product

Key product decisions made during the cycles:

- Keep backend schema stable: one JSON trip per code in Neon via the Cloudflare Worker.
- Use access-by-link for beta instead of real authentication.
- Use local device identity first, with editable name and PayNow proxy.
- Make trip ownership explicit without turning the app into a permissions-heavy system.
- Let expense creators edit/delete their own expenses; let trip owners edit/delete trips.
- Support three split modes: equal, selected people, and custom amounts.
- Prefer OS-native sharing rather than custom share menus.
- Prefer PWA install and OTA-friendly service worker behavior for distribution.
- Add lightweight admin summary and beta feedback without exposing sensitive details.
- Simplify the trip top section around the most important numbers: `Your share`, `Total`, and secondary `Avg/person`.

These were mostly sound. The slow part was that several decisions were made only after beta-like usage exposed the need. Future builds should force these choices earlier with a product contract.

## What Codex Did Across The Iterations

The work naturally clustered into phases:

- Cycles 1-4: build identity, PayNow QR correctness, foreign-currency fallback, and core Worker persistence.
- Cycles 5-8: live GitHub Pages verification, settlement flow, join flow, offline/local-only behavior, and broad tab regression.
- Cycles 9-14: identity, onboarding, profile editing, split modes, sharing, ownership, trip filtering, deletion, dashboard order, and local migration for stale storage.
- Cycle 15: PWA installation and OTA-friendly service worker behavior.
- Cycles 16-18: real beta pain: multi-device sync, stale overwrite risk, creator controls, receipt persistence, Android capture differences, form clearing during refresh, QR save/import, dashboard compression, admin and feedback.
- Cycles 19-21: polish from lived use: gesture back behavior, receipt/expense detail views, FX editability, edit placement, visual hierarchy, chart colours, cleaner QR presentation, and quieter trip header.

The app improved materially, but many later fixes were not "advanced edge cases." They were first-beta basics.

## Why Obvious UX Issues Were Missed

The misses were not because the issues were subtle. They were missed because the testing lens was too narrow early on.

### 1. The Early Tests Were Too Happy-Path

We tested that a trip could be created, expenses could be added, balances could calculate, and settlement could work. That proved the engine, not the product.

What was missing:

- A brand-new user landing cold.
- A second and third person joining from separate devices.
- Someone changing their name after joining.
- Someone making a mistake and needing to edit an expense.
- Someone adding expenses after the host already has the trip open.
- Someone trying Android camera capture.
- Someone saving a QR and importing it into a bank app.
- Someone pressing system back inside an installed PWA.

Future rule: before beta, run the app as a social workflow, not as isolated features.

### 2. Console-Clean Was Treated As More Valuable Than Human-Clear

Clean console logs are useful, but several issues were visible immediately to a human:

- confusing onboarding,
- trip clutter,
- hidden trip edit/delete controls,
- tiny receipt action,
- ugly/default controls,
- compressed dashboard layout,
- similar donut colours,
- noisy trip header,
- QR image visually poor despite being technically valid.

Future rule: every local or live smoke should include one screenshot reviewed against UX heuristics: hierarchy, affordance, spacing, empty states, mobile readability, and "would a friend know what to do?"

### 3. Multi-Party Sync Was Underestimated

The biggest beta embarrassment was User B joining and adding expenses while the host did not see the member or expenses. The root issue was architectural: opening a trip trusted localStorage first, and saving stale local JSON could overwrite newer Worker data.

This should have been a day-one risk because the whole app depends on multiple people editing the same shared object.

Future rule: any app with shared state needs a concurrent-use UAT before beta. Even if the backend is simple, test two writers, stale reads, refresh, reload, and conflict-prone saves.

### 4. Local Identity Was Treated As Implementation Detail, But It Was Product Design

Local `uid` looked simple technically, but it created product questions:

- Is this person joining as a new member or claiming an existing member?
- What happens when they rename themselves?
- Why do they see trips they are not part of?
- Who owns the trip?
- Who can delete or edit what?

Future rule: identity, ownership, and permissions need a written "control model" even when there is no real auth.

### 5. Platform Differences Were Discovered Too Late

iOS and Android behaved differently for image capture. PWA installation and service worker caching created stale-app concerns. Bank-app QR import had different requirements from scanning a live QR.

Future rule: mobile web apps need a device behavior matrix before beta:

- iOS Safari browser
- iOS installed PWA
- Android Chrome browser
- Android installed PWA
- desktop browser for admin/debug
- camera capture
- gallery upload
- OS share
- saved-image import into the target downstream app
- system back gesture
- OTA update after install

### 6. The App Lacked Beta Instrumentation At First

Admin review and in-app feedback came after the user asked how to monitor beta. That should have been included before inviting friends.

Future rule: if beta testing is expected, build feedback and basic admin observability before the first external tester.

## What Could Have Been Done Better

### Start With A Product Contract

Before coding, write a short product contract:

- Target user: friend group on a trip.
- Primary success path: install/open, set name, join trip, add expense, inspect balances, settle.
- Trust model: link-based access, no auth, local identity, owner controls.
- Non-goals: banking transfer execution, full accounting, formal auth, multi-currency accounting perfection.
- Beta readiness bar: three-user live test across iOS/Android, receipt capture, stale sync, QR save/import, PWA update.

This would have surfaced identity, ownership, sync, and beta monitoring earlier.

### Build The "Messy Real Trip" UAT Earlier

The most useful UAT should have happened before wider beta:

1. Host creates trip on Device A.
2. Host adds their name and PayNow.
3. Host shares native OS invite.
4. User B joins from Device B.
5. User C joins from Device C.
6. User B changes name after joining.
7. User B adds three expenses, one with receipt.
8. User C adds a foreign-currency selected split.
9. Host keeps trip open and verifies auto-refresh.
10. Host adds another expense after B/C changes.
11. Each user checks whether they can edit/delete only the right things.
12. One settlement QR is saved and imported into a bank app.
13. Everyone reloads or reopens installed PWA and sees consistent state.

This single test would have caught many Cycle 9-20 issues sooner.

### Use Visual Review Gates, Not Just Functional Gates

Before each push, include a small visual checklist:

- Is the primary action obvious?
- Does the first screen tell a new user what to do through layout, not instructions?
- Are destructive/admin actions discoverable but not too loud?
- Are key numbers visually ranked?
- Does mobile text fit?
- Are charts readable without explanation?
- Are controls native-looking where native is good and app-styled where native is ugly?
- Does the UI still look good with 1, 2, 3, and 5 members?
- Does it still look good with long names and large amounts?

### Treat Distribution As A Feature

The PWA and OTA work should not be late polish. Distribution affects:

- stale localStorage,
- service worker cache strategy,
- install prompt,
- home-screen launch,
- version display,
- update behavior,
- user support when old data or code appears.

Future rule: if users will install it, build versioning, migration, and update strategy before beta.

### Instrument Beta Before Inviting Friends

Minimum beta instrumentation:

- in-app feedback entry point,
- app version attached to feedback,
- trip code/screen context attached to feedback,
- admin feedback viewer,
- sanitized admin summary,
- simple release notes or known-issues file,
- a reset/delete policy for test data.

This makes beta less anecdotal and less dependent on chat screenshots.

## Token And Time Savings For Future Builds

Ways to get to the same outcome faster:

- Keep a single build checklist file from Cycle 1, not after Cycle 17.
- Batch product-level decisions before code: identity, ownership, edit rights, deletion, sharing, beta monitoring.
- Define the 3-user UAT script before implementing the first shared-state feature.
- Use screenshots as evidence for every UI change instead of relying mostly on DOM text and console checks.
- Automate predictable checks: synced duplicate HTML, script parse, service worker version, app version, no console errors, primary selectors visible.
- Avoid live-pushing every tiny visual tweak unless the local visual gate passes first.
- Keep branch/source verification as a scripted release step because A/B testing repeatedly pointed Pages at another branch.
- Use real beta scenarios as test data names, not generic demo trips, so screenshots and admin views are easier to read.
- Add admin/feedback earlier to reduce guessing what testers experienced.
- Write a "known platform quirks" section as soon as iOS/Android differences appear.

## Future App Build Playbook

Use this before the first beta of any similar app.

### 1. Product Contract

Write:

- Who is the target user?
- What is the primary real-world workflow?
- What is the trust/identity model?
- Who can create, edit, delete, share, or close things?
- What data is local-only vs shared?
- What does "beta-ready" mean?

### 2. Risk Register

List the riskiest assumptions:

- multi-user sync,
- identity confusion,
- stale local data,
- mobile browser differences,
- installation/update behavior,
- downstream app integration,
- permissions and deletion,
- admin/feedback visibility.

Then test those first, not last.

### 3. Golden UAT Script

Create one end-to-end script with:

- fresh user,
- returning user with old local data,
- host,
- second user,
- third user,
- edit mistake,
- delete/archive path,
- offline or failed backend path,
- mobile capture/share/back gestures,
- live persistence check.

### 4. UI Heuristic Pass

Review screenshots for:

- first action clarity,
- visual hierarchy,
- spacing,
- affordances,
- chart readability,
- form recovery,
- empty states,
- long content,
- mobile thumb reach,
- "less is more" around top-level summaries.

### 5. Release Gate

Do not call a beta build ready until:

- local smoke passes,
- live smoke passes,
- 3-user shared-state UAT passes,
- platform matrix is at least partially checked,
- admin/feedback works,
- version marker is visible,
- rollback or next-fix path is clear.

## SplitLah-Specific Future Checks

Before the next wider beta:

- Confirm Cycle 21 is committed, pushed, and live on GitHub Pages.
- Run a fresh 3-user live UAT on the public Codex build.
- Test QR save/import again after the green-border change.
- Test Android camera capture from browser and installed PWA.
- Test iOS camera/gallery from browser and installed PWA.
- Test an installed PWA receiving an OTA update from v20 to v21 or later.
- Review admin summary and feedback after real tester activity.
- Decide whether link-based access is acceptable for beta, or whether lightweight auth is needed before broader sharing.

## The Core Lesson

The fastest path is not "build less." It is to test the real social workflow earlier.

For SplitLah, the obvious beta issues were mostly at the edges where real people touched the app: joining, naming, sharing, editing mistakes, taking receipts, switching payment apps, using Android/iOS differences, and reopening old installed versions. Future app builds should make those edges first-class requirements from the start.
