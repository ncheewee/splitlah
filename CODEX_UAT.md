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
