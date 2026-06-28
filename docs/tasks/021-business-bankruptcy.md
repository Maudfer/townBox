# [Feature] Business bankruptcy & closure

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `business`, `framework-followup`
- **Depends on:** 020 (P&L), 015 (employment, to lay off)

## Summary

When a business stays insolvent, it **goes bankrupt and closes**: all employees are laid off, the business is
removed from its work building, and the building becomes vacant (available for a new business). This is the
business-side payoff of the economy and a key driver of unemployment that feeds household insolvency (022).

## Background / current state (verified)

- After 020, a business has a balance and a monthly P&L + a stress/trend signal.
- `Workplace` (`src/app/game/Workplace.ts`) holds the `BusinessInstance`, `employees`, and open positions.
  `layoff(person)` exists; 015 makes it real (frees the slot + clears `WorkLife.job`).
- A bare `Workplace` with no business is valid (013b: jobs are minted on `workplaceBuilt` / `setBusiness`),
  so "vacant building" is a representable state.
- `City` owns work-building wiring (`setupBusiness` on `workplaceBuilt`) and the daily tick.

## Goals / Requirements

1. **Define insolvency → bankruptcy.** Data-driven threshold (e.g. balance below a debt floor for N
   consecutive months, in `json/economy.json`). Deterministic.
2. **Close the business.** On bankruptcy: lay off every employee (via 015's layoff path so jobs/slots clear),
   clear the `BusinessInstance` from the `Workplace` (vacant), and emit a `businessClosed` signal.
3. **Decide re-occupancy.** Choose and document: does the vacant work building immediately get a fresh
   business (re-run `setupBusiness` after a cooldown), stay vacant until the player bulldozes/rebuilds, or
   attract a new business by demand? Recommended: vacant + a chance to attract a new business over time
   (data-driven), so closures are visible but the city heals.
4. **Feed unemployment into the rest of the sim.** Laid-off people become eligible for `get_job` again (015);
   prolonged unemployment reduces income → household arrears (019) → eviction (022).
5. **Emit signals** (`businessClosed`, `massLayoff`) for the feed (029) and notify affected person windows.
6. **Save:** vacant/occupied state and any bankruptcy cooldown round-trip.

## Out of scope

- Household eviction (022) — bankruptcy only produces unemployment + closures.
- Bailouts/loans/investment mechanics (possible later economy task).

## Acceptance criteria

- A sustainedly insolvent business closes: employees laid off, building vacated, `businessClosed` emitted.
- Vacancy/re-occupancy behaves per the documented choice; no orphaned employees or dangling jobs.
- Deterministic; survives save/load.
- `npm test` passes with a bankruptcy-and-layoff scenario test.

## Notes

- With 020 + 021, deliberately bad salary/price numbers will cascade: failing businesses → layoffs →
  unemployed residents → arrears → evictions (022). This cascade is the intended emergent consequence
  (`docs/tasks/013`).
