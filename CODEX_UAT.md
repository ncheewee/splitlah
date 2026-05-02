# SplitLah Codex UAT

## Scope
Codex branch only: `codex/redesign-mvp`. Shared backend remains the existing Cloudflare Worker and Neon JSON trip table.

## Test Phases
1. Identity and publish: public page loads, banner says `SPLITLAH - Codex build`, cloud health can be tested.
2. Trip creation: create trip, choose home currency from dropdown, first member is current user, trip pushes to Worker.
3. Members: add member with and without PayNow proxy, normalize 8-digit Singapore mobile to `+65`.
4. Expenses: add SGD expense, add foreign-currency expense with FX rate, verify per-pax and totals.
5. Balances: verify equal split net balances and minimum settlement list.
6. Settlement: open settlement, generate PayNow QR when payee has proxy, mark paid, verify balances update.
7. Join flow: second browser/session joins by code, sees same trip, can add expense, first session can pull it.
8. Offline resilience: bad API URL saves locally and shows local-only feedback.
9. Regression: no console errors on home, trip, expenses, balances, members, dashboard.

## Cycle 1
Focus:
- Visible Codex build identifier.
- Settlement QR must use validated PayNow SGQR payload, not placeholder text.
- First smoke pass on public/local Codex build.

Findings:
- C1-F1: Build identity was not explicit enough in the app chrome for A/B testing.
- C1-F2: Settlement QR generation used placeholder text in the Codex prototype instead of the validated SGQR PayNow payload format.
- C1-F3: Existing browser localStorage can preserve older demo member PayNow values, so old local demo data may not reflect new seeded data until reset. This is expected during iterative local testing.

Fixes:
- C1-X1: Updated home and trip banner to `SPLITLAH - Codex build`.
- C1-X2: Added PayNow proxy normalization for Singapore 8-digit mobile numbers to `+65...`.
- C1-X3: Replaced settlement QR text with EMVCo-style SGQR PayNow payload builder using CRC16, mobile proxy type `0`, and fixed amount field.
- C1-X4: Updated seeded demo Wei Ling PayNow proxy to the validated test mobile number for fresh sessions.

Status:
- Completed. Awaiting user approval for Cycle 2.

## Cycle 2
Focus:
- Live public UAT with GitHub Pages pointed to `codex/redesign-mvp`.
- Test core MVP loop: publish identity, cloud health, trip creation, member add, expense add, balances, settlement.

Findings:
- C2-F1: GitHub Pages was initially pointed to `claude/redesign-mvp`; switched to `codex/redesign-mvp` for Codex UAT with user approval.
- C2-F2: Public Codex build loaded with correct title and banner.
- C2-F3: Cloud health test returned connected through the in-app UI.
- C2-F4: Trip creation worked with currency dropdown. Test trip code: `DKM8T1`.
- C2-F5: Member add worked and normalized `97605390` to `+6597605390` in persisted backend data.
- C2-F6: SGD expense add worked and recalculated total/per-pax/balances correctly.
- C2-F7: Settlement QR generated for PayNow-enabled member and exposed SGQR payload with `+6597605390` and `S$5`.
- C2-F8: Mark-as-paid recorded settlement and cleared balances to zero.
- C2-F9: Worker/Neon verification passed via `GET /trips/DKM8T1`.

Fixes:
- No code fixes needed in Cycle 2. Test-only cycle.

Status:
- Completed. Awaiting user approval for Cycle 3.

## Cycle 3
Focus:
- Clean second-session join flow against shared Worker.
- Foreign-currency expense entry and FX fallback behavior.
- Pull joined-session changes back into the first session.

Findings:
- C3-F1: Clean second session successfully joined trip code 5B2OYE and appeared as a third member.
- C3-F2: Second session added MYR expense `Cycle 3 nasi lemak`; first session pulled it by rejoining the code and saw updated balances.
- C3-F3: FX fallback originally converted MYR at 1:1 when the browser blocked the third-party rate request, overstating RM20 as S$20.
- C3-F4: Local browser UAT also surfaced avoidable console noise from the missing favicon and blocked FX request.

Fixes:
- C3-X1: Added explicit editable fallback estimates for supported foreign currencies instead of defaulting unknown FX to 1.
- C3-X2: Expanded expense currency choices to match more of the trip currency dropdown.
- C3-X3: Avoided blocked third-party FX calls in the fallback path and added an inline favicon to keep console output clean.

Status:
- Local fix verification passed on trip 5B2OYE with clean console logs. Awaiting push/live GitHub Pages UAT approval.

## Cycle 4
Focus:
- Verify live GitHub Pages serves the Codex build after commit `27fb766`.
- Repeat live foreign-currency UAT on the public site.
- Confirm Worker/Neon persistence for the live trip.

Findings:
- C4-F1: Live public page loaded at `https://ncheewee.github.io/splitlah/` with title `SplitLah - Built by Codex` and banner `SPLITLAH - Codex build`.
- C4-F2: Browser profile still contained previous local trips, so the live test used a fresh public trip rather than clearing local storage. Test trip code: `QL6MKH`.
- C4-F3: Added member `Cycle Four`; PayNow proxy `97605390` normalized to `+6597605390` in persisted Worker data.
- C4-F4: Added MYR expense `Cycle 4 live nasi lemak`, RM20, paid by `Cycle Four`.
- C4-F5: Live FX fallback displayed `1 MYR = 0.28500 SGD` with `Fallback estimate · editable`.
- C4-F6: Live app converted RM20 to S$5.70, S$2.85 per pax, with balances showing Chee Wee owes S$2.85 to Cycle Four.
- C4-F7: Worker verification passed via `GET /trips/QL6MKH`; persisted expense has `currency: "MYR"`, `originalAmount: 20`, `fxRate: 0.285`, and SGD amount approximately `5.70`.
- C4-F8: App console warning/error check was clean after the live flow.

Fixes:
- No code fixes needed in Cycle 4. Test-only cycle.

Status:
- Completed. User later approved continuing non-code cycles without pausing.

## Cycle 5
Focus:
- Continue live UAT using the in-app browser.
- Repoint GitHub Pages from the active A/B branch back to the Codex branch for Codex UAT.
- Reconfirm public GitHub Pages build identity.
- Verify settlement QR, mark-paid flow, cleared balances, and Worker persistence on the public site.

Findings:
- C5-F1: A fresh in-app browser tab loaded `https://ncheewee.github.io/splitlah/` with title `SplitLah`, not `SplitLah - Built by Codex`.
- C5-F2: The public page showed a different SplitLah UI with first-visit profile, ImageKit, custom split, and `Get started` flows instead of the Codex dashboard/banner.
- C5-F3: Cache-busted reload of `https://ncheewee.github.io/splitlah/?codex-cache-check=...` still served the non-Codex UI.
- C5-F4: `https://ncheewee.github.io/splitlah/Built%20By%20Codex/` returned GitHub Pages 404.
- C5-F5: Local workspace branch remains `codex/redesign-mvp` at `27fb766`, synced with `origin/codex/redesign-mvp`, and local `index.html` plus `Built By Codex/index.html` still contain `SplitLah - Built by Codex` and `SPLITLAH - Codex build`.
- C5-F6: Per user direction, GitHub Pages source was restored to `codex/redesign-mvp` at `/`, then a Pages rebuild was triggered.
- C5-F7: Pages rebuild completed successfully at commit `27fb766`.
- C5-F8: Live public page then loaded with title `SplitLah - Built by Codex` and banner `SPLITLAH - Codex build`.
- C5-F9: On trip `QL6MKH`, balances showed Chee Wee owing Cycle Four S$2.85.
- C5-F10: Settlement screen generated a PayNow QR for Cycle Four with proxy `+6597605390` and amount S$2.85.
- C5-F11: Marking the settlement paid showed `Payment recorded`, `1 of 1 settled`, cleared balances to +S$0/+S$0, and showed `All settled`.
- C5-F12: Worker verification passed via `GET /trips/QL6MKH`; persisted settlement has `from` Chee Wee, `to` Cycle Four, amount approximately S$2.85, and a `paidAt` timestamp.
- C5-F13: App console warning/error check was clean after the live settlement flow.

Fixes:
- No code fixes made. GitHub Pages source was restored to the Codex branch for live UAT.

Status:
- Completed. User later approved continuing non-code cycles without pausing.

## Cycle 6
Focus:
- Continue live UAT using the in-app browser without pausing for non-code test cycles.
- Verify live join/pull behavior against the shared Worker.
- Add an expense through the joined live UI and confirm Worker persistence.

Findings:
- C6-F1: Live public page loaded with title `SplitLah - Built by Codex` and banner `SPLITLAH - Codex build`.
- C6-F2: Direct Worker check confirmed earlier test trip `5B2OYE` still existed before join.
- C6-F3: The live UI joined trip `5B2OYE` successfully and opened `Cycle 3 Codex`.
- C6-F4: Because identity is local-only, this browser joined as another `Chee Wee` member instead of merging with the earlier `Chee Wee` member. This matches the current access-by-link/no-auth model.
- C6-F5: Added expense `Cycle 6 joined kaya toast`, S$12, through the joined live UI.
- C6-F6: UI recalculated total from S$5.70 to S$17.70, per-pax share to S$4.43, and expenses count to 2.
- C6-F7: Balances showed Host PayNow +S$7.58, Second Tester +S$1.27, and two Chee Wee entries owing S$4.43 each.
- C6-F8: Worker verification passed via `GET /trips/5B2OYE`; persisted data includes the new Chee Wee member and the new S$12 SGD expense.
- C6-F9: App console warning/error check was clean after the live join and expense flow.

Fixes:
- No code fixes needed in Cycle 6. Test-only cycle.

Status:
- Completed. Continuing to the next non-code UAT cycle per user instruction.

## Cycle 7
Focus:
- Verify offline/local-only resilience on the live Codex build.
- Restore the real Worker URL after the test.
- Confirm the local-only trip did not persist to the Worker.

Findings:
- C7-F1: Temporarily changed the live app Worker API setting to `https://splitlah-api.invalid.test`.
- C7-F2: Created trip `Codex Cycle 7 Offline` with code `S3CMY5`.
- C7-F3: The app opened the trip locally and showed `Local only: Failed to fetch`.
- C7-F4: The local-only trip appeared on the dashboard with 1 member and 0 expenses.
- C7-F5: Restored Worker API setting to `https://splitlah-api.ncheewee.workers.dev`.
- C7-F6: Worker verification via `GET /trips/S3CMY5` returned `Trip not found`, confirming the bad-API trip stayed local only.
- C7-F7: App console warning/error check was clean after restoring the real Worker URL.

Fixes:
- No code fixes needed in Cycle 7. Test-only cycle.

Status:
- Completed. Continuing to the next non-code UAT cycle per user instruction.

## Cycle 8
Focus:
- Run a live regression pass across the primary public Codex UI surfaces.
- Check mobile-width layout readability in the in-app browser.
- Confirm no console warnings/errors after navigating the main tabs.

Findings:
- C8-F1: Live public page loaded with title `SplitLah - Built by Codex` and banner `SPLITLAH - Codex build`.
- C8-F2: Home dashboard displayed expected test trips including `DKM8T1`, `QL6MKH`, `5B2OYE`, and local-only `S3CMY5`.
- C8-F3: Opened trip `5B2OYE` and verified top-line totals: total S$17.70, per-pax S$4.43, 2 expenses, 2 days.
- C8-F4: Expenses tab displayed the SGD joined expense and MYR fallback expense with readable amounts and no visible overlap.
- C8-F5: Balances tab displayed four member rows and settlement rows with readable positive/negative amounts.
- C8-F6: Members tab displayed member add controls and the four member list with paid totals.
- C8-F7: Dashboard tab displayed spending, net balance, and settle-up panels with readable content in the in-app mobile viewport.
- C8-F8: App console warning/error check was clean after Home, Expenses, Balances, Members, and Dashboard navigation.

Fixes:
- No code fixes needed in Cycle 8. Test-only cycle.

Status:
- Completed. UAT plan items exercised through live public Codex checks.

## Cycle 9
Focus:
- Address first-visit/local identity management without adding backend schema or real auth.
- Fix profile rename propagation so changing a device name updates that device's member rows in known trips.
- Add a low-friction join choice so users can claim an existing member instead of creating duplicates.

Findings:
- C9-F1: Pixel 8 UAT found that changing `Your name` in Cloud settings only updated local profile state, not the existing member row inside joined trips.
- C9-F2: Current no-auth model creates one local `uid` per browser/device, so the same person can appear as duplicate members when joining from multiple devices.
- C9-F3: Local static verification confirmed the renamed `Profile & cloud` control opens correctly.
- C9-F4: Local static verification changed profile name from `Chee Wee` to `Pixel 8`; trip card avatar changed to `P8` and Members tab showed `Pixel 8` with `You · This device`.
- C9-F5: Local static verification of joining trip `5B2OYE` showed a `Join Cycle 3 Codex` choice sheet with `This is me` actions for existing members and a `Join as new person` fallback.
- C9-F6: Local console warning/error check was clean after profile rename and join-choice verification.
- C9-F7: GitHub Pages built commit `4468cba`; live smoke check showed `Profile & cloud` on the public Codex build.
- C9-F8: Live console warning/error check was clean after loading the identity fix.

Fixes:
- C9-X1: Renamed `Cloud settings` to `Profile & cloud`.
- C9-X2: `saveSettings()` now updates `members[state.uid].name` across locally known trips and pushes touched trips to the Worker.
- C9-X3: Join flow now pulls the trip and, when the current local identity is not already a member, asks whether the user is an existing member before adding a new member.
- C9-X4: Members list labels the current local identity as `You · This device`.

Status:
- Completed. Identity fix committed, pushed, and live-smoke verified.

## Cycle 10
Focus:
- Review beta readiness from the perspective of a brand-new user.
- Exercise onboarding, name setup, trip creation, member add, expense entry, and settlement.
- Identify gaps before sharing the public URL with friends.

Findings:
- C10-F1: A clean local origin did not show onboarding; it defaulted to `Chee Wee` and a seeded `Tokyo Trip`.
- C10-F2: New users can find `Profile & cloud` and change their name, but the app does not prompt them to do so on first visit.
- C10-F3: Creating a trip worked, but the app opened the Dashboard first instead of guiding the user toward adding members or the first expense.
- C10-F4: Adding a member with PayNow worked and normalized the test mobile proxy.
- C10-F5: Recording an equal-split SGD expense worked and recalculated totals/balances.
- C10-F6: Mistake recovery is weak: saved expenses expose `Delete` only; there is no expense edit flow.
- C10-F7: Non-equal splits are not supported; expense entry always splits across all members equally.
- C10-F8: Settlement worked in declaration mode when the payee had no PayNow proxy.
- C10-F9: There is no trip owner/admin close/archive flow.
- C10-F10: Console warning/error check was clean after the new-user flow.

Fixes:
- No code fixes made in Cycle 10. Findings require product/UI changes before beta.

Status:
- Completed. Recommended to pause for app-code changes before wider beta.

## Cycle 11
Focus:
- Improve beta readiness for a brand-new user without adding real auth or changing the backend schema.
- Add editable PayNow profile details, expense editing, non-equal splits, and a friend-sharing path.
- Verify a clean invite-link onboarding and join flow locally before publishing.

Findings:
- C11-F1: Clean local origin now starts with an empty trip list and opens a first-run `Set up profile` modal.
- C11-F2: Saving profile name `Beta One` and PayNow proxy `97605390` updated the home greeting and seeded new trips with PayNow metadata.
- C11-F3: Created local UAT trip `24UUP3` named `Beta Share Dinner`; the app opened the Members tab first for early setup.
- C11-F4: Added `Beta Two`, then recorded `Skewed dinner` for S$100 with custom split S$70/S$30.
- C11-F5: Header and balances correctly reflected the custom split: `Beta One` share S$70, net +S$30, `Beta Two` net -S$30.
- C11-F6: Edited the same expense down to S$80 with custom split S$50/S$30; totals, share, expense row, and balances updated correctly.
- C11-F7: Share trip modal displayed invite URL `http://127.0.0.1:8766/?join=24UUP3` plus trip code fallback.
- C11-F8: Clean invite URL on a different local origin opened onboarding first, then prefilled join code `24UUP3`, and allowed `Invite Tester` with PayNow proxy `TESTPAYNOW` to join as a new person.
- C11-F9: Late joiner did not retroactively owe for older custom-split expenses; their share remained S$0 for the existing expense.
- C11-F10: Local console warning/error check was clean after onboarding, create, custom split, edit, share, and invite join.
- C11-F11: GitHub Pages built commit `5a75538`; fresh in-app live smoke showed `Share trip`, equal/custom split mode, expense `Edit` buttons, and clean console warnings/errors.

Fixes:
- C11-X1: Removed demo-trip seeding for fresh visitors and added first-run profile onboarding.
- C11-X2: Added editable PayNow proxy to profile settings and propagate the device profile to locally known member records.
- C11-X3: Added custom amount splits for expenses while keeping equal split as the default.
- C11-X4: Added expense edit flow for correcting description, amount, currency, payer, and split amounts.
- C11-X5: Updated balance and personal-share calculations to respect stored custom split amounts.
- C11-X6: Added trip sharing via invite link `?join=CODE` plus visible trip code.

Status:
- Completed. Beta-readiness controls committed, pushed, and live-smoke verified.

## Cycle 12
Focus:
- Refine expense splitting based on beta feedback.
- Replace split-mode dropdown friction with radio-style choices.
- Improve currency and sharing options for friend distribution.

Findings:
- C12-F1: Three split modes better match real expense entry: equal for everyone, equal among selected people, and custom manual amounts.
- C12-F2: Native browser dropdown styling looked out of place beside the app's dark rounded controls.
- C12-F3: Currency coverage was practical but missing VND and several common travel currencies.
- C12-F4: Local UAT on trip `R4EWGL` added `Selected drinks` for S$30 split only to the selected payer; total rose to S$153 and the payer share rose to S$91.50 as expected.
- C12-F5: Share sheet displayed native share, copy link, WhatsApp, and email options with invite URL `http://127.0.0.1:8765/?join=R4EWGL`.
- C12-F6: Local console warning/error check was clean after selected split and share-sheet verification.
- C12-F7: Live GitHub Pages smoke showed VND in the currency list, `Equal` / `Selected` / `Custom` radio split modes, and live share options for native share, copy, WhatsApp, and email.
- C12-F8: Live console warning/error check was clean after opening Expenses and Share trip.

Fixes:
- C12-X1: Replaced split dropdown with app-styled radio controls for `Equal`, `Selected`, and `Custom`.
- C12-X2: Added checkbox member selection for equal-among-selected splits.
- C12-X3: Persisted split mode metadata while keeping old equal and custom expenses backwards-compatible.
- C12-X4: Added VND plus PHP, CNY, NZD, CAD, CHF, and INR to the practical currency list with fallback SG estimates.
- C12-X5: Styled native selects with the app's field treatment and custom arrow affordance.
- C12-X6: Added native share, WhatsApp, and email share actions alongside copy link.

Status:
- Completed. Split-mode and sharing refinements committed, pushed, and live-smoke verified.

## Cycle 13
Focus:
- Reduce beta clutter and make identity, ownership, and trip management clearer.
- Hide trips where the current device identity is not a member.
- Move Dashboard to the left-most tab and make Share trip invoke the OS share action directly.

Findings:
- C13-F1: Home was showing every locally cached trip, including `Tokyo Trip`, even when the current device identity was not a member.
- C13-F2: `Profile & cloud` mixed user identity settings with backend configuration, which was confusing for beta users.
- C13-F3: Trip ownership was not visible, so users could not tell who should be allowed to manage or delete a trip.
- C13-F4: Local UAT showed the home screen now lists only the current user's trip `R4EWGL`; `Tokyo Trip` was hidden for the active `Fresh Tester` identity.
- C13-F5: Local UAT showed `Edit profile` beside the user greeting and the profile sheet only contains name and PayNow fields.
- C13-F6: Local UAT showed Dashboard as the first tab, followed by Expenses, Balances, and Members.
- C13-F7: Local UAT showed owner indicators on the trip card, trip header, and current owner member row.
- C13-F8: Local UAT showed owner-only `Edit trip` and `Delete trip` controls on the Members tab.
- C13-F9: Local UAT showed `Share trip` no longer opens an intermediate share sheet; it invokes native share and falls back to copy.
- C13-F10: Local console warning/error check was clean after home, profile, trip, members, and share checks.
- C13-F11: GitHub Pages initially served the A/B Claude build artifact; Pages source was reset to `codex/redesign-mvp` and rebuilt commit `7f9a1ed`.
- C13-F12: Live smoke showed `Edit profile`, no `Tokyo Trip` for the active Chee Wee identity, owner badges, Dashboard as left-most tab, and clean console warnings/errors.

Fixes:
- C13-X1: Home now filters to non-deleted trips where `state.uid` is a member.
- C13-X2: New trips store `ownerId`; legacy trips infer owner from the first member for backwards compatibility.
- C13-X3: Owner labels now appear in trip cards, the trip header, and member rows.
- C13-X4: Added owner-only trip rename/currency edit and soft-delete controls.
- C13-X5: Soft-deleted trips are hidden and old invite links are treated as deleted without changing backend schema.
- C13-X6: Replaced `Profile & cloud` with `Edit profile` beside the greeting and removed visible Worker/API settings from the profile sheet.
- C13-X7: Reordered tabs to Dashboard, Expenses, Balances, Members.
- C13-X8: Changed `Share trip` to launch native OS sharing directly with copy fallback.

Status:
- Completed. Ownership/profile cleanup committed, pushed, and live-smoke verified. Cloud purge still requires explicit deletion confirmation before proceeding.

## Cycle 14
Focus:
- Add a production-style local app data migration for over-the-air updates.
- Clean old beta/demo localStorage clutter without deleting shared cloud trips.
- Remove personal-looking PayNow sample values from the UI.
- Show country/region names alongside currency abbreviations.

Findings:
- C14-F1: Normal Chrome can keep old device-local `sl_codex_v1` state even after the static app code updates; incognito appears clean because it starts with empty localStorage.
- C14-F2: Local UAT loaded a previously cluttered device origin and migrated it to an empty trip list while preserving the user profile greeting `Fresh Tester`.
- C14-F3: Profile modal now uses neutral PayNow placeholder `+65 mobile or NRIC`.
- C14-F4: New trip modal now uses neutral placeholder `Weekend trip` and join code placeholder `ABC123`.
- C14-F5: Currency selector displayed country/region labels including `SGD - Singapore`, `MYR - Malaysia`, and `VND - Vietnam`.
- C14-F6: Local console warning/error check was clean after migration, profile, and currency label verification.
- C14-F7: GitHub Pages first build for commit `579a6aa` failed transiently, then a retried build of the same commit succeeded.
- C14-F8: Live smoke showed the existing Chee Wee browser storage migrated to `No trips yet`, preserving the profile while clearing old local test trips.
- C14-F9: Live profile showed neutral PayNow placeholder `+65 mobile or NRIC`, and live new-trip currency selector showed country/region labels including `VND - Vietnam`.
- C14-F10: Live console warning/error check was clean after migration, profile, and new-trip checks.

Fixes:
- C14-X1: Added `APP_VERSION=14` and a local migration hook that runs before rendering.
- C14-X2: Migration removes known beta/demo local trip codes and old Codex/Tokyo/Fresh Beta test trip names from device storage only.
- C14-X3: Migration preserves profile/device identity and stamps `state.appVersion` for future incremental migrations.
- C14-X4: Replaced personal-looking PayNow sample placeholder with a neutral value.
- C14-X5: Currency options now show `CODE - Country/Region` labels while preserving the stored currency code value.

Status:
- Completed. Local migration and UI copy changes committed, pushed, and live-smoke verified.

## Cycle 15
Focus:
- Add installable PWA distribution so SplitLah can feel like a home-screen native app.
- Keep OTA updates working for installed users.

Findings:
- C15-F1: Codex build did not yet include a manifest, service worker, install prompt hook, or home-screen icons.
- C15-F2: Installed PWAs can preserve old app shell code if the service worker uses cache-first navigation; SplitLah should prefer fresh network loads and only fall back to cache when offline.
- C15-F3: Local structural verification confirmed manifest `SplitLah`, `standalone` display, `/splitlah/` scope/start URL, service worker file, and generated green PNG icons exist.
- C15-F4: Local static server verification could not run because approval for starting the server timed out twice.
- C15-F5: GitHub Pages built commit `6fc7920` successfully after source was confirmed as `codex/redesign-mvp`.
- C15-F6: Live smoke confirmed the public page exposes `manifest.webmanifest`, Apple touch icon, theme color `#075943`, service worker registration, install prompt hook, and `APP_VERSION=15`.
- C15-F7: Live manifest is served as `application/manifest+json`, has standalone display, `/splitlah/` scope/start URL, and two icons.
- C15-F8: Live service worker contains cache `splitlah-shell-v15`, immediate activation, old-cache cleanup, and network-first navigation via `cache: 'no-store'`.
- C15-F9: Live console warning/error check was clean after opening the PWA-capable page.

Fixes:
- C15-X1: Added `manifest.webmanifest` with standalone display, `/splitlah/` scope, theme colors, and icons.
- C15-X2: Added green home-screen icons at 192, 512, and Apple touch sizes.
- C15-X3: Added `sw.js` with shell caching, immediate activation, old-cache cleanup, and network-first navigation for OTA-friendly updates.
- C15-X4: Added service worker registration and update check on page load.
- C15-X5: Added install prompt capture and a home-screen install card when the browser exposes `beforeinstallprompt`.
- C15-X6: Bumped `APP_VERSION` to 15 for the PWA-capable app shell.

Status:
- Completed. PWA install shell committed, pushed, and live-smoke verified.

## Cycle 16
Focus:
- Investigate failed first real multi-party beta impression where user B joined and added expenses but host did not see updates.
- Tighten multi-device sync, expense creator controls, and receipt behavior.
- Run a two-session UAT before recommending further beta testing.

Findings:
- C16-F1: Root sync issue found: opening a trip used localStorage only; a host device did not automatically pull the latest Worker trip after another device joined or added expenses.
- C16-F2: Write risk found: adding an expense from a stale local trip could overwrite newer Worker data because `PUT /trips/:CODE` replaces the whole JSON trip.
- C16-F3: Expense controls were too broad; every user could see edit/delete actions for every expense.
- C16-F4: Expense payer selector did not explicitly default to the current app user.
- C16-F5: Receipt capture was preview-only; `previewReceipt()` used a temporary object URL and `addExpense()` saved `receiptUrl:null`, so photos were not sent to the backend.
- C16-F6: Android camera access may need an explicit capture input; a generic image file input can show gallery only depending on browser/PWA behavior.
- C16-F7: Local two-session UAT created trip `0FODTN` (`Lunch @ Vivo UAT`) as host, joined from a second origin as user `L`, and added `L coffee`, `L toast`, and `L juice`.
- C16-F8: Host session refreshed to show member `L` and all three `L` expenses with total S$12 and 2 members.
- C16-F9: Worker verification for `0FODTN` returned members `Fresh Tester`, `L`; all three expenses were paid by `L`, created by `L`, and persisted in Neon/Worker JSON.
- C16-F10: GitHub Pages built commit `950359e` successfully after source was confirmed as `codex/redesign-mvp`.
- C16-F11: Live smoke showed `APP_VERSION=16`, background refresh hook, `createdBy` persistence, camera capture input, and receipt persistence code present.
- C16-F12: Live smoke created trip `Y9S5DY` (`Cycle 16 Smoke`) and verified paid-by defaulted to current user `Chee Wee`, camera/gallery buttons were visible, and console warnings/errors were clean.

Fixes:
- C16-X1: `openTrip()` now renders local data quickly, then pulls the latest Worker trip and re-renders.
- C16-X2: Active trip view now background-refreshes from the Worker every 12 seconds when no modal is open.
- C16-X3: `addExpense()` now captures the form values, pulls the latest Worker trip, then appends the new expense to reduce stale overwrite risk.
- C16-X4: `push()` now stores the Worker-returned trip back into local state after successful save.
- C16-X5: New expenses now store `createdBy: state.uid`.
- C16-X6: Expense edit/delete actions are shown only to the original expense creator.
- C16-X7: Paid-by selector now defaults to the current app user while still allowing selection of another payer.
- C16-X8: Receipt input is split into camera and gallery actions; camera input uses `capture="environment"`.
- C16-X9: Attached receipts are downscaled to max 900px JPEG data URLs and saved with the expense for beta persistence.

Proposed multi-party UAT:
- UAT-A: Host creates a fresh trip and shares invite link.
- UAT-B: User B joins from a separate device/browser and verifies their name appears in Members.
- UAT-C: User B adds three expenses, including one with receipt photo, and verifies paid-by defaults to themselves.
- UAT-D: Host leaves the trip open and confirms automatic refresh shows user B and all expenses within 12 seconds.
- UAT-E: Host verifies user B expenses do not show edit/delete controls; user B verifies their own expenses do.
- UAT-F: Host adds one expense after user B updates; verify it appends without removing user B member/expenses.
- UAT-G: Reload both devices and verify Worker-persisted members, expenses, balances, and receipts.

Status:
- Completed. Multi-party sync, creator controls, and receipt handling committed, pushed, and live-smoke verified.

## Cycle 17
Focus:
- Make receipt capture more obvious for beta testers.
- Add an in-app beta feedback path.
- Add a lightweight admin review surface without changing the Neon schema.

Findings:
- C17-F1: The split camera/gallery receipt buttons were visually small and duplicated the OS-level choice on iOS.
- C17-F2: A single large `Add receipt` action with neutral helper text better matches both iOS and Android expectations.
- C17-F3: Admin monitoring can start with sanitized aggregate trip summaries and explicit tester feedback before adding heavier analytics or real auth.
- C17-F4: Local file-based in-app browser smoke showed the v17 banner, `Send beta feedback` entry, feedback modal, and single `Add receipt` button.
- C17-F5: Local static checks passed for synced HTML, app script parsing, Worker module parsing, and whitespace.
- C17-F6: Recreated the local Git repository as a standalone `.git` directory inside `/Users/cheewee/Desktop/SplitLah-Codex` so future commits no longer depend on the Claude worktree metadata.
- C17-F7: Days and daily spend are misleading for advance bookings, flight/hotel costs, and post-trip spending, so they were removed from the primary trip summary.
- C17-F8: Average per person is useful as a reference but should be visually secondary to `Your share` and `Total`, especially when selected/custom splits are used.
- C17-F9: Settlement QR was too small for phone-to-phone payment workflows and needed an explicit save path for users switching to another payment app.
- C17-F10: Worker deploy initially failed because dependencies were not installed in the recreated checkout; `npm ci` restored the locked dependencies and Worker deploy succeeded.
- C17-F11: Live Worker UAT passed for `/health`, `POST /feedback`, `/admin/feedback`, and sanitized `/admin/summary`.
- C17-F12: GitHub Pages was still pointed at `claude/redesign-mvp`; it was switched back to `codex/redesign-mvp` for Codex UAT.
- C17-F13: Live GitHub Pages smoke showed v17 banner, feedback entry, simplified trip header without days/daily spend, larger receipt action, and clean console warnings/errors.

Fixes:
- C17-X1: Replaced the receipt camera/gallery pair with one larger `Add receipt` button and `Camera or photo library` helper text.
- C17-X2: Added a beta feedback modal that captures rating, message, app version, screen, trip code, tester name, and tester id.
- C17-X3: Added Worker `POST /feedback`, `GET /admin/feedback`, and `GET /admin/summary` routes using reserved JSON trip code `FDBACK` in the existing table.
- C17-X4: Kept admin summary sanitized to aggregate counts, currencies, totals, and trip metadata instead of exposing PayNow proxies or receipt images.
- C17-X5: Bumped app and service-worker cache version to v17.
- C17-X6: Simplified the trip header to focus on `Your share`, `Total`, and secondary `Avg/person`; expense count moved into the metadata line.
- C17-X7: Removed daily spending from the dashboard.
- C17-X8: Enlarged PayNow QR to about 80% of screen width and added `Save QR image`.

Status:
- Completed. Feedback/admin Worker endpoints deployed, Codex branch pushed, Pages pointed to `codex/redesign-mvp`, and live smoke verified.

## Cycle 18
Focus:
- Fix beta regressions from Pixel 8 and iPad: expense form clearing, Android receipt camera access, QR save/import reliability, and compressed dashboard layout.
- Run a 3-user UAT after the fix.

Findings:
- C18-F1: Expense entry was being wiped by the 12-second background refresh while the user was typing or choosing split mode.
- C18-F2: Android needs an explicit `capture="environment"` input to offer camera capture; the single generic image input can show gallery only.
- C18-F3: Saved QR images need an actual white quiet-zone border in the exported PNG, not only CSS padding around the on-screen QR.
- C18-F4: Dashboard looked compressed after removing daily spending because `Settle up` was still tucked inside the net-balance card.
- C18-F5: Local file-based in-app browser smoke confirmed v18 marker, receipt choice UI, dashboard settle panel, form values surviving past the refresh interval, successful expense add, and clean console warnings/errors.
- C18-F6: Live GitHub Pages served v18 after rebuild; public form-guard smoke confirmed values survived past the refresh interval and console warnings/errors stayed clean.
- C18-F7: Three-user Worker UAT trip `C18LVA` persisted 3 members and 3 expenses totaling S$264.
- C18-F8: Live app joined `C18LVA` as `C18 Host`, showed 3 members / 3 expenses, and displayed expected balances: Host -S$22, Pixel -S$68, iPad +S$90.
- C18-F9: Live dashboard showed the new full-width Settle Up card with 2 suggested payments.
- C18-F10: Admin screens loaded at `?admin=summary` and `?admin=feedback`; summary included the Cycle 18 UAT trip and feedback loaded existing entries.

Fixes:
- C18-X1: Background refresh now skips while the Expenses form has focus, typed values, or an attached receipt.
- C18-X2: `Add receipt` now opens a small choice sheet with `Take photo` and `Choose image`; the camera path uses `capture="environment"`.
- C18-X3: Saved QR PNGs are generated on a 1024px white canvas with a quiet-zone border.
- C18-X4: Dashboard now gives `Settle up` its own full-width card below `Who paid` and `Net balance`.
- C18-X5: Bumped app and service-worker cache version to v18.

Status:
- Completed. Cycle 18 fixes committed, pushed, live-smoke verified, and 3-user UAT passed.

## Cycle 19
Focus:
- Address beta feedback on navigation, trip ownership clarity, feedback spacing/form friction, crowded trip actions, and dashboard scaling.

Findings:
- C19-F1: PWA/system back had no app history states, so gesture back could leave the app instead of returning to the previous SplitLah screen.
- C19-F2: Back/Share controls above the tab content crowded the trip header and tabs.
- C19-F3: Trip ownership existed as a small badge but was not clear enough for non-owners to know who started/manages the trip.
- C19-F4: Feedback rating was unnecessary friction because most tester feedback is bug/confusion/suggestion text.
- C19-F5: The feedback button on Home needed more breathing room before the trip cards.
- C19-F6: Dashboard member lists need to scale more gracefully than a tight two-column card layout.
- C19-F7: Local file-based in-app browser smoke confirmed v19 marker, simpler feedback sheet, visible `Started by`, lower Back/Share actions, dashboard/list layout, and browser back navigation from Expenses to Dashboard to Home with clean console warnings/errors.
- C19-F8: Live GitHub Pages smoke confirmed v19 marker, home feedback spacing/form simplification, visible `Started by`, lower Back/Share actions, and browser back navigation from Expenses to Dashboard to Home with clean console warnings/errors.

Fixes:
- C19-X1: Added lightweight history states for Home, Trip tabs, Settle, and Paid screens so browser/PWA back maps to in-app navigation.
- C19-X2: Moved Back/Share below the active tab content and made Share the primary action.
- C19-X3: Added `Started by ...` on trip cards and in the trip header, with `You manage this trip` for owners.
- C19-X4: Simplified feedback to a textarea-only sheet and kept a default neutral rating only for existing backend compatibility.
- C19-X5: Added spacing below the Home feedback button.
- C19-X6: Changed Dashboard to stacked cards with scrollable member lists for better 3+ member behavior.
- C19-X7: Bumped app and service-worker cache version to v19.

Status:
- Completed. Cycle 19 UX/navigation fixes committed, pushed, and live-smoke verified.

## Cycle 20
Focus:
- Address beta feedback on tab back behavior, dashboard colour meaning, receipt/expense inspection, FX edits, and trip management placement.

Findings:
- C20-F1: Gesture back should leave the trip and return to Trips instead of stepping through Dashboard/Expenses/Balances/Members tabs.
- C20-F2: Dashboard donut colours were static and did not match member avatar colours, making the chart hard to trust.
- C20-F3: `Your share` needed stronger visual emphasis than the secondary summary numbers.
- C20-F4: Receipt thumbnails and expense rows needed a detail view so users can inspect receipt photos, split mode, FX rate, and split allocation.
- C20-F5: Editing a foreign-currency expense did not expose the exchange rate, so correcting FX mistakes required recreating the expense.
- C20-F6: Trip edit/delete under Members was not discoverable enough for owners.
- C20-F7: Local file-based in-app browser smoke confirmed v20 marker, title edit pencil, highlighted `Your share`, tab back returning to Trips, expense detail modal, split detail, FX display, and clean console warnings/errors.
- C20-F8: Live GitHub Pages smoke confirmed v20 marker, title edit pencil, tab back returning to Trips from Expenses, expense detail modal, FX/split details, and clean console warnings/errors.
- C20-F9: Live dashboard donut style used member avatar colours in paid proportions for the three-user UAT trip.

Fixes:
- C20-X1: Tab changes no longer push browser history entries; back from any trip tab returns to Trips.
- C20-X2: Dashboard donut segments now use each member's avatar colour and actual paid proportions.
- C20-X3: `Your share` card now uses the light mint treatment for emphasis.
- C20-X4: Expense rows open a detail sheet with receipt preview, paid-by, amount, original currency, FX rate, split mode, and split detail.
- C20-X5: Receipt thumbnails open an enlarged receipt view.
- C20-X6: Expense edit now includes editable exchange rate to SGD.
- C20-X7: Owner trip edit moved to a pencil button beside the trip title; delete is available from that edit sheet, and the old Members-tab owner tools were removed.
- C20-X8: Bumped app and service-worker cache version to v20.

Status:
- Completed. Cycle 20 expense/detail and trip-control fixes committed, pushed, and live-smoke verified.

## Cycle 21
Focus:
- Polish trip visuals for beta readability: clearer donut/member colours, cleaner PayNow QR framing, lighter trip edit affordance, and simpler trip header copy.

Findings:
- C21-F1: Pastel avatar colours were too close together, so dashboard donut segments were not one-glance meaningful.
- C21-F2: The QR export was functionally scannable, but the on-screen frame and saved image needed a single even green border around a square QR.
- C21-F3: The owner pencil inherited the dark ghost-button fill, making it look heavier than intended.
- C21-F4: The trip header was carrying member/expense counts plus owner-control copy directly under the title, creating too much noise.
- C21-F5: Local file-based in-app browser smoke confirmed the v21 marker, simplified header, outline-only pencil control, higher-contrast avatar/donut colour treatment, and clean console warnings/errors.

Fixes:
- C21-X1: Replaced the soft avatar palette with a higher-contrast deterministic palette and normalized member colours so existing trips render with clearer chart segments.
- C21-X2: Updated PayNow QR display and saved PNG output to use a single green square border with a white QR quiet zone.
- C21-X3: Restyled the title edit affordance as a small transparent pencil button with a white outline.
- C21-X4: Reduced trip header metadata to only trip code and starter name.
- C21-X5: Bumped app and service-worker cache version to v21.

Status:
- Completed. Cycle 21 visual polish and app-build lessons committed, pushed, and live-smoke verified. Live QR frame was code-deployed but the available live settlement path was declaration mode because the payee had no PayNow proxy.

## Cycle 22
Focus:
- Improve dashboard data labels, settlement readability, owner member management, and foreign-exchange display clarity.

Findings:
- C22-F1: Donut segments needed amount and percentage labels, but inline labels on the ring would likely clutter the small mobile chart.
- C22-F2: Settlement rows used a thin text arrow that did not read strongly enough as payer-to-payee direction.
- C22-F3: Trip owners could add members but had no way to remove accidental inactive members.
- C22-F4: FX display was technically correct as `1 foreign = SGD`, but users expect the stronger currency on the left: for weaker currencies show `1 SGD = X foreign`; for stronger currencies show `1 foreign = X SGD`.
- C22-F5: Local file-based in-app browser smoke confirmed v22 marker, MYR rate shown as `1 SGD = 3.5088 MYR`, owner-only remove button for an inactive member, successful member removal, compact donut amount/percentage chips, and clean console warnings/errors.

Fixes:
- C22-X1: Added compact modern donut label chips showing member initials, amount paid, and percentage paid.
- C22-X2: Restyled settle-up arrows as a larger bold centered arrow shared by dashboard and balances settlement rows.
- C22-X3: Added owner-only member removal for inactive non-owner members; members tied to expenses, splits, or settlements are protected.
- C22-X4: Added `fxDisplay()` so exchange-rate copy flips to the intuitive larger-currency direction while preserving the editable SGD-per-unit rate used for calculations.
- C22-X5: Bumped app and service-worker cache version to v22.

Status:
- Completed. Cycle 22 committed, pushed, and live-smoke verified. Public HTML served v22 immediately; the in-app browser needed one reload for the service worker to activate the v22 shell.

## Cycle 23
Focus:
- Make expense detail receipts inspectable without pushing the key expense details below the fold.

Findings:
- C23-F1: Receipt images in expense detail used the large full-receipt treatment, so users often had to scroll before seeing paid-by, amount, FX, split mode, and split detail.
- C23-F2: The detail sheet needs a bounded receipt viewport, while the existing full receipt view can remain the larger inspection mode.
- C23-F3: Local structural checks confirmed v23 marker, synced HTML copies, clean script parsing, and receipt detail rendering through a bounded `receiptPane` with contained scrolling and tap-to-zoom class toggle.

Fixes:
- C23-X1: Added a `receiptPane` container with a fixed viewport height, internal scrolling, touch pan/pinch behavior, and overscroll containment.
- C23-X2: Expense detail now places receipt images inside that pane so the amount and split details stay close on screen.
- C23-X3: Tapping the receipt pane toggles a zoomed image width for quick inspection without resizing surrounding text.
- C23-X4: Bumped app and service-worker cache version to v23.

Status:
- Completed. Cycle 23 committed, pushed, and live-smoke verified. Public HTML served v23 after Pages propagation, and the in-app browser loaded the v23 shell with clean console warnings/errors.

## Cycle 24
Focus:
- Rework social invite flow for lower-friction distribution through group chats and direct member links.

Findings:
- C24-F1: A plain app URL should remain a cold start with `New trip` primary and `Join code` as backup.
- C24-F2: A group trip link should resolve identity before showing full trip details, because a WhatsApp group link does not imply which person clicked it.
- C24-F3: A direct member link should suggest that member but still allow choosing someone else or joining as new.
- C24-F4: Clicking `I'm not listed` must not immediately add the current local profile; it needs a confirmation/name form to prevent accidental joins.
- C24-F5: Claiming an existing member should be per-trip, not a global device identity replacement, so users do not lose other local trips after claiming a role in one shared trip.
- C24-F6: Local in-app browser smoke confirmed v24 marker, share sheet with group/specific/code options, group invite identity resolution for trip `5B2OYE`, direct member suggestion via `member=...`, `I'm not listed` confirmation form, and clean console warnings/errors.

Fixes:
- C24-X1: Added `member` query parameter support for direct member invite links.
- C24-X2: Changed `?join=CODE` links to open an identity-resolution sheet with trip preview, existing member choices, and `I'm not listed`.
- C24-X3: Added per-trip claimed member mapping in local state so existing-member claims do not overwrite the device's global profile.
- C24-X4: Reworked `Share trip` into a sheet with `Share group invite`, `Invite specific person`, `Copy invite link`, and `Copy trip code`.
- C24-X5: Added a specific-person invite sheet that generates `?join=CODE&member=MEMBER_ID` links.
- C24-X6: `I'm not listed` now opens a name/PayNow confirmation form before adding a new member.
- C24-X7: Bumped app and service-worker cache version to v24.

Status:
- Completed. Cycle 24 committed, pushed, and live-smoke verified. Public v24 showed the share sheet and direct member invite identity resolution with clean console warnings/errors.

## Cycle 25
Focus:
- Make foreign-currency expense entry follow the trip currency by default and make editable FX values match the displayed rate.

Findings:
- C25-F1: Expense creation still showed a full currency dropdown and defaulted to SGD, even when the trip was created with a different default currency.
- C25-F2: FX copy displayed the intuitive direction, such as `1 SGD = 3.5088 MYR`, but the editable field still showed the internal SGD-per-foreign-unit rate, such as `0.285`.
- C25-F3: Beta feedback showed background refresh could wipe slow in-progress form entries outside the expense tab, especially member entry.
- C25-F4: Latest beta feedback also reinforced that the next build should prioritize FX clarity and form stability before adding more beta testers.
- C25-F5: Dedicated in-app browser automation was unavailable in this session, and Computer Use was blocked from controlling the Codex app, so live verification used public asset checks instead of click-through browser automation.

Fixes:
- C25-X1: Expense creation now defaults to the trip currency and hides the full currency picker behind a smaller `Change` action.
- C25-X2: FX display and editable value now use the same direction; internal SGD rates are converted only at save time.
- C25-X3: Added an SGD-equivalent preview that updates as amount or exchange-rate edits change.
- C25-X4: Expense editing now uses the same display-rate model and preserves creator-only edit/delete control.
- C25-X5: Background refresh is now skipped while any trip-tab form input is focused or populated, not only while the expense form is dirty.
- C25-X6: Bumped app and service-worker cache version to v25.

Status:
- Completed. Cycle 25 committed, pushed, and live-smoke verified by public Pages asset checks: the live HTML served v25, included the trip-currency expense UI, matched FX display/edit helpers, and the service worker served `splitlah-shell-v25`.

## Cycle 26
Focus:
- Clean up small UI rough edges and add an expense review step before writing shared data.

Findings:
- C26-F1: FX panels still showed implementation/status copy such as fallback/cached estimates, which added noise without helping normal users.
- C26-F2: Modal close buttons and the trip edit pencil had bordered button styling that looked heavy beside otherwise compact mobile sheets.
- C26-F3: Equal split did not show each member's share before adding an expense, so users had to commit first and inspect after.

Fixes:
- C26-X1: Removed FX source/status helper copy from add/edit expense screens while keeping the exchange-rate value editable.
- C26-X2: Restyled modal close controls as a simple bare `X`.
- C26-X3: Replaced the trip-title pencil with a small uppercase `EDIT` chip.
- C26-X4: Changed add expense into a review-and-confirm flow with amount, payer, FX summary, receipt indicator, and per-member split preview.
- C26-X5: Bumped app and service-worker cache version to v26.

Status:
- Completed. Cycle 26 committed, pushed, and live-smoke verified by public Pages asset checks: the live HTML served v26 with the review expense flow and edit chip, and the service worker served `splitlah-shell-v26`.

## Cycle 27
Focus:
- Fix claimed-member profile/PayNow sync, improve trip edit chip alignment, and add a beta admin dashboard.

Findings:
- C27-F1: Feedback and live trip inspection showed Kenneth's PayNow was still blank in shared trip `9L7E48`, even after he added PayNow locally, so settlement QR could not render on another device.
- C27-F2: The cause is direct-member claiming: `saveSettings()` updated `members[state.uid]`, but a direct invite maps the device to a pre-added member id via `state.claims[tripCode]`.
- C27-F3: The `EDIT` trip chip sat visually high beside the title because the title row inherited heading margins.
- C27-F4: Feedback also flagged duplicated native share URLs and non-numeric mobile keyboards for expense entry.
- C27-F5: Admin monitoring needed a single route that combines summary, recent trips, attention areas, and feedback.

Fixes:
- C27-X1: Profile saves now update the claimed member id for each trip, falling back to the device uid only when no claim exists.
- C27-X2: Claiming an existing member now adopts that member's name locally and prompts profile/PayNow completion when missing.
- C27-X3: Restyled the trip title row so the `EDIT` chip is vertically centered with the title.
- C27-X4: Added `inputmode` hints for amount, FX rate, and PayNow fields.
- C27-X5: Removed duplicated URLs from native share text while preserving the native `url` payload.
- C27-X6: Added `?admin=dashboard` with beta overview cards, needs-attention list, recent trips, and latest feedback.
- C27-X7: Bumped app and service-worker cache version to v27.

Status:
- Completed. Cycle 27 committed, pushed, and live-smoke verified by public Pages asset checks: the live HTML served v27 with claimed-member profile sync, admin dashboard route, inputmode hints, share text fix, and centered title edit chip; the service worker served `splitlah-shell-v27`.

## Cycle 28
Focus:
- Tighten trip UX around expense entry, member control, dashboard density, dropdown styling, and current FX rates.

Findings:
- C28-F1: Admin feedback still showed FX rates as stale; the Worker source is in this repo, so a proper backend-mediated FX endpoint is possible without changing the Neon schema.
- C28-F2: Expense creation is a primary trip action, but it lived only inside the Expenses tab.
- C28-F3: Non-owner members could see the add-member form, which conflicts with owner control and adds noise.
- C28-F4: The dashboard repeated “Who paid” data below the donut, wasting vertical space.
- C28-F5: Currency changes required an extra `Change` click before exposing the selector.
- C28-F6: Native dropdowns were visually inconsistent with the app.

Fixes:
- C28-X1: Added Worker `GET /fx/:CURRENCY`, fetching SGD-based rates from Open ER API and caching responses for six hours at the Worker edge.
- C28-X2: Frontend FX now tries the Worker live FX endpoint before falling back to local estimates.
- C28-X3: Added a sticky `+ Expense` action inside trips and moved the add-expense form into a modal review flow.
- C28-X4: Expense currency is now visible as a styled selector from the start, defaulting to trip currency.
- C28-X5: Replaced local select rendering with app-styled custom select menus for consistent dropdown UI.
- C28-X6: Members add form is owner-only; non-owners only see the member list.
- C28-X7: Simplified dashboard “Who paid” to donut plus compact labels, removing the repeated list below.
- C28-X8: Bumped app and service-worker cache version to v28.

Status:
- Completed. Cycle 28 committed, pushed, Worker-deployed, and live-smoke verified. Worker `GET /fx/MYR` returned `1 SGD = 3.1168 MYR`; public Pages served v28 with the floating expense action, custom select menus, simplified dashboard labels, owner-only member add controls, and service worker `splitlah-shell-v28`.

## Cycle 29
Focus:
- Reduce trip-screen crowding, make expense/feedback actions more obvious, improve dashboard payer visualization, and let owners maintain member details after adding people.

Findings:
- C29-F1: Admin feedback had no newer unresolved items beyond the existing FX/profile/invite notes already addressed or queued.
- C29-F2: The trip body still carried bottom navigation/share buttons, crowding the same area as the key expense action.
- C29-F3: Added members could not be corrected later, so owners had no recovery path for typoed names or missing PayNow details.
- C29-F4: The payer donut labels were compact but not yet the callout-style view requested for quicker one-glance reading.
- C29-F5: Dashboard and Balances both exposed settlement-related information, making the section intent blurrier than needed.

Fixes:
- C29-X1: Moved trip BACK and SHARE controls to compact top chips, removed bottom trip actions, and made the sticky action read `ADD EXPENSE`.
- C29-X2: Added a persistent `FEEDBACK` chip available across screens, with the existing feedback payload still attaching screen, trip, actor, and app version.
- C29-X3: Added owner-only member edit controls for name and PayNow proxy; editing the current device member also updates local profile details.
- C29-X4: Renamed `Balances` to `Settle` and removed net-balance duplication from that tab, leaving settlement payments there only.
- C29-X5: Reworked `Who paid` into a callout/list toggle remembered locally, with callouts showing amount and percentage labels around the donut.
- C29-X6: Refined the trip title `EDIT` chip styling and bumped app/service-worker cache version to v29.

Status:
- Completed. Local UAT passed in the in-app browser: verified v29 home and trip screens, top BACK/SHARE chips, separated FEEDBACK and ADD EXPENSE chips, owner member edit modal, callout payer donut, and Settle tab without net-balance duplication. Cycle 29 committed and pushed. Public Pages smoke verified v29 HTML markers and service worker `splitlah-shell-v29`.

## Cycle 30
Focus:
- Improve the core expense and member workflows using v29 beta feedback, while leaving larger chart/category and trip-lifecycle changes for design discussion.

Findings:
- C30-F1: v29 feedback said the add-expense flow worked but needed clearer guidance, with distinct description/receipt, amount/currency, and split sections.
- C30-F2: Expense rows were visually inconsistent when some rows had receipt thumbnails and others had payer avatars.
- C30-F3: Expenses needed editable dates plus simple sorting/filtering for date, payer, and highest spend.
- C30-F4: Members list over-explained generic membership and used a second line for paid amounts.
- C30-F5: Top trip actions needed clearer full-cap labels, and the trip edit chip still looked slightly too tall.

Fixes:
- C30-X1: Rebuilt add/edit expense sheets into three numbered sections and added an editable expense date defaulting to today.
- C30-X2: Expense list rows now use a stable media column with receipt/placeholder plus a mini payer avatar, simplified subtitle to date, and expose sort/filter controls.
- C30-X3: Expense detail/review surfaces now show the selected date.
- C30-X4: Members list now shows only meaningful badges (`Me`, `Owner`, `PayNow set`) and keeps paid amount on one line.
- C30-X5: Trip header is sticky, top actions now read `BACK TO TRIPS` and `SHARE THIS TRIP`, and the `EDIT` chip height was reduced.
- C30-X6: Bumped app and service-worker cache version to v30.

Status:
- Local UAT passed in the in-app browser via DOM/interaction checks. Verified v30 home/trip headers, expense sort/filter controls, aligned expense rows with dates, three-part add expense flow, review screen with date and split preview, and cleaned member badges/paid amounts. In-app screenshot capture timed out, but browser interaction and DOM verification succeeded. Commit/push and live Pages smoke remain.
