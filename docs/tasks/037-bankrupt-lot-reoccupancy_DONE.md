# [Feature] Bankrupt-lot re-occupancy (vacant buildings attract new businesses)

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `business`, `framework-followup`
- **Depends on:** 021 (bankruptcy → vacant work buildings), 033a (demand model, to bias re-occupancy)
- **Status:** ✅ **Done.** `Workplace` tracks `vacantMonths` + `businessGenerations` (both saved). `City`'s
  generator was refactored into `openBusiness(workplace, category?)` — generation 0 keeps the legacy
  location-only seed (existing placements/saves unchanged), generation ≥ 1 mixes the generation index into the
  seed so a re-occupied lot draws a *different* business. `City.runReoccupancy` (in `processMonthlyEconomy`,
  after `runBusinessEconomics`) ages each vacant lot and, past `reoccupancyMonths` (`json/economy.json`),
  opens a new business in the category with the largest unmet demand (demand − potential supply), accounting
  for each new opening so a tick doesn't over-build; lots with no unmet demand stay vacant. Emits
  `businessOpened` to the feed (029). Chose **demand-gated re-occupancy** (req. 3) over a uniform fallback so
  the city never re-floods an oversupplied category.

## Summary

After 021, a bankrupt work building is **vacated** (its `BusinessInstance` cleared, employees laid off) and
stays vacant forever — there is no teardown yet (025) and no way for a fresh business to move in. A city that
runs long therefore slowly fills with permanently dead lots. This task lets a **vacant work building attract a
new (different) business over time**, so the economy heals: closures stay visible, but good locations recover.

This closes the loop the 021 PR explicitly deferred.

## Background / current state (verified)

- `City.closeBusiness` (`src/app/game/City.ts`) is the only thing that vacates a work building: it calls
  `Workplace.closeBusiness()` (clears employees, open positions, and the `BusinessInstance`), writes off the
  debt (`Economy.setBusinessBalance(key, 0)`), and re-emits `tileSpawned` so the lot renders desaturated.
- `City.setupBusiness(workplace)` (on `workplaceBuilt`) is the existing generator: it seeds an RNG as
  `worldSeed ^ hashStringToSeed(workplace.getIdentifier())`, picks a blueprint, draws a size, names it (faker
  seeded with the same value), calls `generateBusiness(...)`, `workplace.setBusiness(...)`, and seeds capital
  `DEFAULT_ECONOMY_PARAMS.startingBusinessCapital * size`. **This seed is purely location-deterministic**, so
  simply re-running it on a vacated lot would respawn the *identical* failed business — re-occupancy must vary
  the seed (see below).
- `City.processMonthlyEconomy(tick)` (gated by `Economy.lastEconomyMonth`) runs `runPayroll` →
  `runBusinessEconomics` → `runCostOfLiving` once per in-game month. `runBusinessEconomics` already computes
  city-wide per-category demand and per-business capacity — the inputs a demand-biased re-occupancy wants.
- A vacant work building is exactly `Workplace.getBusiness() === null`. `MainScene.drawTile` already renders
  such a workplace via `applyVacantLook` (re-evaluated whenever `tileSpawned` is emitted for the tile).
- **Save:** `SaveManager` serializes a workplace's `business` wholesale and its `employeeIds`; a vacant lot
  round-trips as "no business, no employees". There is currently **no** per-workplace vacancy clock or
  re-occupancy counter to persist (this task adds them — both as optional `StructureSnapshot` fields, no
  `SAVE_VERSION` bump needed since absence reads as "fresh/zero").

## Goals / Requirements

1. **Cooldown.** A vacated lot stays vacant for a data-driven number of months (`reoccupancyMonths` in
   `json/economy.json`) before it can attract a new business. Track elapsed vacant months per work building.
2. **Vary the generation.** The new business must be able to differ from the one that failed. Mix a per-lot
   **generation index** (count of businesses the lot has hosted) into the generation seed — e.g. seed off
   `hashStringToSeed(`${key}:${generation}`)` — and increment it each time a business opens on the lot. Keep it
   deterministic (same world + same sequence of openings → same businesses) and save-stable.
3. **Demand-aware choice (recommended).** Bias the new blueprint toward a **category with unmet demand**
   (`demand[cat] > Σ capacity[cat]` from the demand model) so the city heals where investment is actually
   warranted and doesn't immediately re-flood an oversupplied category. Fall back to a uniform draw when no
   category has unmet demand (or gate re-occupancy off entirely until some does — choose and document).
4. **Open the business.** On re-occupancy: generate + `setBusiness`, reseed capital to the starting amount,
   reset the vacancy clock, re-emit `tileSpawned` (un-vacant look), and announce a `businessOpened` city event
   (029).
5. **Save:** the vacancy clock and generation index round-trip; a reload mid-cooldown resumes correctly.

## Out of scope

- Player-driven teardown/rebuild of lots (025).
- The B2B products/supply chain (035) and locality/catchment demand (033c).
- Re-occupancy of **houses** (a vacant/abandoned-house mechanic, if wanted, is a separate task).

## Integration points (code)

- `json/economy.json` + `EconomyParams` (`types/Economy.ts`): add `reoccupancyMonths` (and any flag chosen for
  requirement 3).
- `Workplace` (`src/app/game/Workplace.ts`): add a serialized vacancy clock + generation index (with
  getters/setters); `closeBusiness` already leaves the lot vacant.
- `City` (`src/app/game/City.ts`): a new `runReoccupancy(tick)` called from `processMonthlyEconomy` (after
  `runBusinessEconomics`, so it sees the month's demand/closures). Refactor the blueprint-pick + generate +
  capital-seed in `setupBusiness` into a shared helper both initial placement and re-occupancy use, parameterised
  by the seed (so the generation-varied seed flows through).
- `SaveManager` (`src/app/game/save/SaveManager.ts`) + `StructureSnapshot` (`types/Save.ts`): persist the two
  new workplace fields (optional; no version bump).

## Determinism & performance

- No new RNG source: the generation seed is derived from the world seed + lot key + generation index, so
  reloads reproduce the same re-occupancy sequence. `runReoccupancy` is `O(workplaces)` per month, reusing the
  demand/capacity already computed for `runBusinessEconomics` (compute once, share).

## Tests

- A vacant lot does **not** re-occupy before `reoccupancyMonths` elapse; **does** after.
- The re-occupied business **differs** from the failed one (generation-varied seed) and (if requirement 3 is
  implemented) lands in an unmet-demand category.
- Capital is reseeded and a `businessOpened` event is emitted; the workplace is no longer vacant.
- Save/load mid-cooldown resumes the clock; the generation index round-trips.

## Acceptance criteria

- Vacant work buildings reliably attract a new, different business after the cooldown; closures heal over time
  instead of accumulating dead lots. Deterministic; survives save/load. `npm test` passes with the new tests.

## Notes

- With 021 + 037 the business economy is self-correcting end-to-end: oversupply → losses → bankruptcy →
  vacancy → (cooldown) → a new business in whatever category now has unmet demand.
