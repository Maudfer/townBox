# [Feature] Money model: wallets & ledger

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `framework-followup`
- **Depends on:** 013 (design-for economic fields)
- **Unblocks:** 018, 019, 020, 021, 022 (everything economic)

## Summary

Introduce **money** as a first-class quantity: a balance on every materialized person and every business,
with a single, auditable way to move money between them. This is the foundation the rest of the economy
(wages, cost of living, business P&L, bankruptcy, eviction) builds on. The framework already reserves the
`adjustMoney` effect and economic fields for exactly this (`docs/tasks/013` §1 decision 3, §5.8); this task
activates the substrate without yet wiring the flows that use it.

## Background / current state (verified)

- `EventEngine.applyEffect` (`src/app/game/EventEngine.ts`) lists `adjustMoney` in the closed effect
  vocabulary but treats it as a **no-op**. The effect carries `target` (role) + `amount` (a `Curve`).
- The engine has a per-person **attribute overlay** (`overlay[personId]`) where a `money` attribute could
  live and already round-trips conceptually; the Context exposes `money` as a driver/attr (events can gate on
  wealth). No balance is ever set today.
- Businesses: `BusinessInstance` (`src/types/Business.ts`) carries design-for `economics` (`priceMarkup`,
  `fixedCostsPerMonth`) but no balance. `Workplace` stores the business.
- Jobs carry a `salary` (`JobPosition`, `types/Work.ts`).
- Save: `WorldSnapshot` (`types/Save.ts`) is the place to persist balances; the per-person `eventHistory`
  side-table (v5) is a good precedent for a per-person `wallet` side-table.

## Goals / Requirements

1. **Person balance.** Add a money balance per materialized person. Recommended: a side-table keyed by pool
   `personId` (mirroring `eventHistory`) held by the `EventEngine` or a new lightweight `Economy` holder, so
   it survives de/re-materialization and serializes cleanly. Expose it to the engine Context as the `money`
   attribute (so probability gradients/eligibility can read wealth).
2. **Business balance.** Add a balance to `BusinessInstance` (or a parallel business-economy record keyed by
   workplace anchor). Serialize it.
3. **A single ledger primitive.** One function/method to transfer money (`credit`/`debit`/`transfer`) that all
   flows go through, so balances are always conserved and auditable. Make `adjustMoney` call it (target role →
   person/business, `amount` evaluated from its `Curve`). Negative balances are allowed (debt) — solvency
   decisions belong to later tasks.
4. **Starting conditions.** Give materialized people and new businesses sensible starting balances (data-driven
   in `json/` — e.g. an `economy.json` with `startingHouseholdFunds`, `startingBusinessCapital`). Deterministic
   per seed.
5. **Save/load.** Balances round-trip; bump `SAVE_VERSION` with a migration (older saves get the configured
   starting balances).
6. **Make it observable for debugging** (a console/debug surface is enough here; the player-facing surfacing is
   027/028/031).

## Out of scope

- Any actual income/expense flow — wages (018), cost of living (019), business revenue/costs (020). This task
  only creates balances + the transfer primitive + `adjustMoney` wiring.
- Bankruptcy/eviction consequences (021/022).

## Acceptance criteria

- People and businesses have persistent, seedable starting balances that survive save/load.
- A single ledger primitive moves money and conserves totals; `adjustMoney` uses it and is no longer a no-op.
- The `money` attribute is readable by the event engine (eligibility/gradients can reference it).
- `npm test` passes with unit tests for the ledger primitive and `adjustMoney`.

## Notes

- Keep the ledger pure/testable. Consider recording recent transactions (a small ring buffer per
  account) to power the finance views in 028/031 and the event feed in 029.
