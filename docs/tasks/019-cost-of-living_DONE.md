# [Feature] Cost of living & household spending

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `households`, `framework-followup`
- **Depends on:** 017 (money model), 018 (wages, so there is income to spend)
- **Unblocks:** 022 (eviction), 020 (household spending becomes business revenue)

## Summary

Make living **cost money**. On a regular cadence each household pays recurring expenses (housing + food +
basic upkeep) out of its members' balances. This is the person→economy outflow that, against wages (018),
determines whether a household stays solvent — and feeds business revenue (020) and eviction (022).

## Background / current state (verified)

- After 017, materialized people have balances; after 018 employed people earn wages.
- Households: `House.getHousehold()` → `Household.memberIds`; `House.getResidents()` are the materialized
  people. `City.handleNewDay` iterates households/residents already (rehousing, reconciliation).
- `BusinessInstance.economics.priceMarkup` and `materialsPerMonth` exist (design-for) — the supply side of
  what households buy (020 closes that loop).
- Calendar cadence via the clock (see 018).

## Goals / Requirements

1. **Define household expenses, data-driven.** Add cost-of-living params to `json/economy.json` (housing cost,
   per-capita food/upkeep, etc.). Recommended cadence: **monthly**, matching payroll (018), so solvency is a
   clean monthly comparison.
2. **Charge the household.** On the cadence, debit the household's funds (sum across members, or a designated
   head/"household purse" model — document the choice) via the 017 ledger. Housing cost should scale with the
   home (a simple per-house figure now; tie to property value later).
3. **Route spending to businesses where sensible (optional seam for 020).** Food/goods spending can be modelled
   as revenue to local businesses (020 consumes this); at minimum, structure the expense so 020 can attribute
   some of it to businesses rather than vanishing.
4. **Flag insolvent households.** If a household can't cover its expenses, it goes into debt / arrears and is
   **flagged** — the hook 022 (eviction) consumes. Don't evict here.
5. **Emit a signal** for the feed/finance views (e.g. `householdCharged` / arrears).
6. **Determinism & save:** cadence detection survives load; expenses are deterministic.

## Out of scope

- Eviction/homelessness consequences (022).
- Detailed consumer-choice modelling (which specific shop) — a coarse "spending flows to the local economy" is
  enough; richer demand is a later data/feature task.

## Acceptance criteria

- Households pay recurring expenses on the documented cadence; balances reflect income (018) minus outflow.
- Insolvent households accrue arrears and are flagged (no eviction yet, no crash).
- Deterministic; survives save/load without double-charging.
- `npm test` passes with cost-of-living unit tests.

## Notes

- The interplay wages(018) − cost-of-living(019) is the lever that makes "people lose their houses when the
  numbers are bad" possible (022). Keep all magnitudes in `json/economy.json` so balance can be tuned without
  code changes.
