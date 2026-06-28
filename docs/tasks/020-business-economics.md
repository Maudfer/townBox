# [Feature] Business economics: revenue, materials, P&L & size dynamics

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `business`, `framework-followup`
- **Depends on:** 017 (money), 018 (payroll = the main cost), 019 (household spending = demand)
- **Unblocks:** 021 (bankruptcy)

## Summary

Give businesses a **profit-and-loss**: income from customers, costs for materials and payroll, and a running
balance — and let a business's **size grow or shrink** in response to sustained profit or loss (re-generating
its job positions via Engine A). This makes the deferred `business.size` actually dynamic
(`docs/tasks/013` §1 decision 3 / §4) and sets up bankruptcy (021).

## Background / current state (verified)

- `BusinessInstance` (`src/types/Business.ts`): `size` (stored, currently never changes), `positions`,
  and design-for `economics` (`priceMarkup`, `fixedCostsPerMonth` as a `Curve` over size) +
  `materialsPerMonth` (per-material `qty` `Curve` over size). `json/materials.json` has `basePrice` per
  material.
- `game/BusinessGen.ts` `generateBusiness(blueprintKey, blueprint, jobs, name, size)` is pure and expands
  positions from size — so re-running it at a new size regenerates the establishment. `Workplace.setBusiness`
  re-opens positions.
- After 017/018 the business has a balance and pays payroll; after 019 households spend (the demand side).

## Goals / Requirements

1. **Revenue model (coarse, data-driven).** Define monthly revenue as a function of size, staffing, and local
   demand. Simplest defensible model: revenue = (units sold) × (material cost × `priceMarkup`), where units
   sold derives from nearby household spending (019) and/or a demand curve over local population, capped by
   capacity (size/staff). Put the knobs in `json/businesses.json economics` / `json/economy.json`. Document
   the model; keep it tunable.
2. **Material costs.** Each month, buy `materialsPerMonth` (qty `Curve` × `materials.json basePrice`); debit
   the business via the 017 ledger.
3. **Fixed costs + payroll.** Subtract `economics.fixedCostsPerMonth` and the 018 payroll. Compute a monthly
   **P&L** = revenue − materials − fixed − payroll; apply it to the balance.
4. **Size dynamics.** Track a rolling profitability signal; when a business is sustainably profitable and
   demand exceeds capacity, **grow** `size` (re-run `generateBusiness` at the new size, opening new positions
   → more hiring via 015). When sustainably unprofitable, **shrink** `size` (close positions; lay off via 015
   `releaseSlot`/`Workplace.layoff`). Bound size by the blueprint's `size.max`/`min`. Deterministic.
5. **Expose finances** on the business (monthly P&L, balance, trend) for the workplace inspector (028), the
   feed (029), and bankruptcy (021).
6. **Save:** business balance, size, and any rolling P&L state round-trip.

## Out of scope

- Closure/bankruptcy itself (021) — this task produces the P&L + stress signal that 021 acts on.
- A full products/inventory chain (035) — revenue here is coarse; 035 can refine it.
- Player-facing finance UI (028).

## Acceptance criteria

- Businesses compute a monthly P&L (revenue − materials − fixed − payroll) and update their balance.
- A sustainably profitable business grows in size (more positions, more hiring); a failing one shrinks/sheds
  jobs. Size stays within blueprint bounds. All deterministic per seed.
- Finances round-trip through save/load.
- `npm test` passes with unit tests for P&L computation and the grow/shrink transitions.

## Notes

- This closes the loop so that **bad numbers in the JSON cause failing businesses** — an explicit design goal
  (`docs/tasks/013`). Tune `jobs.json` salaries, `businesses.json` economics, and `economy.json` demand
  together. Re-running `generateBusiness` on size change must preserve already-filled positions sensibly
  (coordinate with 015's per-slot identity note).
