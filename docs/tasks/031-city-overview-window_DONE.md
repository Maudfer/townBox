# [Feature] City overview / dashboard window

- **Type:** Feature / UI
- **Labels:** `feature`, `ui`, `hud`, `framework-followup`
- **Depends on:** 026/030 (to open it). Richer with 015 (employment) and 017–022 (economy).
- **Status:** ✅ **Done.** Aggregation lives in `City.getCityStats(): CityStats` (`types/City.ts`) — derived live
  from the field/economy/population (population, households + avg size, employment, businesses by line of work +
  vacancies, aggregate household/business wealth, stressed counts, homeless, genealogy pool living/total) plus
  cumulative session vital tallies (births/deaths/bankruptcies/evictions, non-persisted counters in `City`).
  `hud/windows/CityDetails.tsx` renders it (registered in `Hud.tsx`'s `windowMap`), opened by **clicking the
  clock widget** (`CitySelected` event), refreshed on a light interval (not the shared `newDay` bus event, whose
  `off()` would drop City's own handler). Reachability via the toolbar is a future nicety; the clock is the
  entry point. Tested via `test/cityOverview.test.ts` against a constructed world.

## Summary

A dashboard summarising the **whole city**: population, households, businesses, employment, and (once it
exists) the economy — births/deaths this year, treasury/aggregate wealth, bankruptcies. Gives the player the
macro view to complement the per-entity inspectors (027/028).

## Background / current state (verified)

- `WindowTypes.CityDetails` exists but is `null` in `Hud.tsx`'s `windowMap`. `WindowPayload` already includes
  `City`.
- `City` (`src/app/game/City.ts`) exposes `getName()`, `getPopulation()`. The richer numbers must be derived:
  - households/people: `Field.getStructures()` filtered to `House`, each `getHousehold()`/`getResidents()`;
    `Field.getPeople()`.
  - businesses: `Field.getStructures()` filtered to `Workplace`, `getBusiness()`/`getEmployees()`.
  - genealogy/demographics: `game.population` (`Population.size()`, living count), `game.clock` for the date.
  - employment: employed = people with a `WorkLife.job` (after 015).
  - economy: balances/P&L (after 017–020).
- Window scaffolding as in 027/028.

## Goals / Requirements

1. **Create `hud/windows/CityDetails.tsx`** and register it in `windowMap`. Opened from the toolbar (030).
2. **Population & demographics:** total residents on the map, # households, average household size, age
   distribution (light — buckets), births/deaths this year (sourced from the feed/signal stream 029 or a
   running tally in `City`).
3. **Employment:** employed vs unemployed adults, # open positions across all businesses (after 015).
4. **Businesses:** count by line of work, # vacant work buildings (after 021).
5. **Economy (gated on 017–020):** aggregate household wealth, aggregate business balance, # financially
   stressed businesses / households, recent bankruptcies/evictions.
6. **Live updates** on a clock tick (`timeChanged`/`newDay`); avoid per-frame recomputation — recompute on the
   day tick or on open.
7. **Reachability:** toolbar button (030); optionally clicking the existing `Clock` widget.

## Out of scope

- Charts/graphs over time (could be a later analytics task) — current snapshot numbers are enough.
- City-wide policy controls (taxes, etc.) — read-only dashboard.

## Acceptance criteria

- A dashboard window shows population, households, businesses, and employment, updating on the day tick.
- Economy figures appear once 017–020 land; absent/placeholder before that.
- Derived purely via `game` getters; no React in `game/`. `npm run dev` builds; `npm test` passes.

## Notes

- Some aggregates (births/deaths this year, bankruptcies) are easiest as running tallies maintained in `City`
  as it processes the daily sim — add lightweight counters there and expose getters, rather than recomputing
  history each render.
