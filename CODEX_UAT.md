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
