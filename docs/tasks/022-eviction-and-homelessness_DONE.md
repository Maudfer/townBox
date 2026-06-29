# [Feature] Household insolvency: eviction & homelessness

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `households`, `framework-followup`
- **Depends on:** 019 (cost of living / arrears), 017 (money), 013e (rehousing infrastructure)
- **Status:** ✅ **Done.** `City.runEvictions` (monthly, after cost-of-living) evicts households whose `arrears`
  reach `evictionArrearsMonths` (`json/economy.json`): each member is first offered a **solvent relative's**
  household (`findRelativeHouse`, broad kinship + capacity + `householdSolvent`); anyone with no taker becomes
  **homeless** — removed from the home (which dissolves/vacates), kept materialized but hidden (`home = null`,
  `indoors`), and registered in `City.homelessHouseholds` (arrangement `HouseholdArrangements.Homeless`).
  `runRecovery` re-homes a homeless household into the lowest-keyed vacant house once pooled funds reach
  `recoveryFunds` (the documented recovery path; re-employment via 015 supplies the funds). Signals `evicted` /
  `becameHomeless` / `rehoused` feed the city feed (029). **On-map representation (req. 2):** homeless people are
  hidden, not despawned, so they survive save/load and stay eligible for jobs. **Downsizing (req. 4):** deferred
  to a future housing market (documented). **Save:** `SAVE_VERSION` 7 adds `homelessHouseholds`; homeless people
  serialize normally with `homeId` null. Death-driven orphan re-housing (013e) shares the relocation helper and
  is unregressed. Tests in `test/eviction.test.ts`.

## Summary

When a household can't pay its way, it **loses its home**: the residents are evicted, the household is marked
**homeless**, and the simulation tries to resolve them (move in with a solvent relative, or downsize) — or
they remain homeless until their fortunes change. This is the household-side payoff of the economy and the
literal "people start losing their houses" goal (`docs/tasks/013`).

## Background / current state (verified)

- After 019, insolvent households accrue arrears and are flagged. After 021, layoffs cut household income.
- `City.resolveRehousing()` (`src/app/game/City.ts`, from 013e) already relocates members into a living
  relative's placed household by kinship priority (sibling → aunt/uncle → grandparent) with capacity checks —
  the same machinery eviction needs.
- `House.getResidents()` / `Household.memberIds` / `Person.social.setHome()` are the resident<->home links;
  `City.relocateMember` (013e, private) moves a member between houses/households.
- A homeless state does not exist yet (no `Person`/household "homeless" flag).

## Goals / Requirements

1. **Define eviction trigger.** Data-driven (e.g. arrears beyond a threshold for N months, `json/economy.json`).
   Deterministic.
2. **Introduce a homeless state.** Represent a household/person with no home (e.g. `Household.arrangement`
   gains a `homeless` value and/or a person `homeless` attribute the engine Context already anticipates).
   Homeless people leave the house resident list; decide their on-map representation (hidden, or a shelter
   point) — keep it simple, document it.
3. **Attempt resolution, reusing 013e.** On eviction, try to **move members into a solvent relative's
   household** (extend/generalise `resolveRehousing` so it's triggered by eviction, not only by death, and so
   it considers solvency/capacity). If no taker, the household stays homeless.
4. **Downsizing (optional but recommended).** A household that can't afford its current house but could afford
   a smaller arrangement may relocate to a vacant smaller home if one exists — or this is left to a future
   housing-market task; document the decision.
5. **Recovery path.** A homeless household whose finances recover (re-employment via 015) can occupy a vacant
   house again. At minimum, don't trap them permanently with no path out.
6. **Emit signals** (`evicted`, `becameHomeless`, `rehoused`) for the feed (029).
7. **Save:** homeless state + arrears round-trip.

## Out of scope

- A full housing market / rent pricing (future task) — eviction here is solvency-driven, not market-driven.
- Player-facing homelessness UI beyond the feed (029) and inspectors (027/028).

## Acceptance criteria

- A sustainedly insolvent household is evicted, marked homeless, and either re-housed with a solvent relative
  or left homeless with a documented recovery path.
- The death-driven orphan re-housing from 013e still works (shared code path not regressed).
- Deterministic; survives save/load.
- `npm test` passes with eviction + re-housing scenario tests.

## Notes

- Generalising 013e's `resolveRehousing` into a shared "find a household for these people" helper (triggered
  by death OR eviction OR marriage move-in) will keep the living-arrangement logic in one place — coordinate
  with 023/024 which also relocate people.
