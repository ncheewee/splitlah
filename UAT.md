# SplitLah MVP UAT

## Roles

- Trip owner: creates a trip and shares the code.
- Friend: joins with the code.

## Cases

1. Setup: enter name and Worker API URL, save, return to Trips.
2. Owner creates trip: create "Japan Test"; app shows 6-character code.
3. Owner adds members: add Marcus and Priya; member count updates.
4. Owner adds expenses: S$90 paid by owner; S$60 paid by Marcus.
5. Balances: each member's net balance and "Pay" list are correct.
6. Friend joins: use same code in a fresh browser/profile; trip loads.
7. Friend adds expense: add S$30 paid by friend; owner refreshes/rejoins and sees it.
8. Delete expense: remove one expense; balances update.
9. Offline fallback: use bad API URL; new local trip still appears but shows saved-locally warning.
10. Validation: blank expense or zero amount is rejected.
