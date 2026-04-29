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
