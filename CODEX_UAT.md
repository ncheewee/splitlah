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

Fixes:
- C14-X1: Added `APP_VERSION=14` and a local migration hook that runs before rendering.
- C14-X2: Migration removes known beta/demo local trip codes and old Codex/Tokyo/Fresh Beta test trip names from device storage only.
- C14-X3: Migration preserves profile/device identity and stamps `state.appVersion` for future incremental migrations.
- C14-X4: Replaced personal-looking PayNow sample placeholder with a neutral value.
- C14-X5: Currency options now show `CODE - Country/Region` labels while preserving the stored currency code value.

Status:
- Code changes verified locally. Ready for commit, push, and live smoke verification.
