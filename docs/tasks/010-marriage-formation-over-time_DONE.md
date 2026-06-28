# [Feature] Marriage / partnership formation over time

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `genealogy`, `life-events`

> **Status: placeholder.** Created as a backlog stub from the 004d follow-up notes. **Not yet detailed —
> run a fresh exploration pass before implementing** (verify the references below against current code).

> **Absorbed by [013-procedural-simulation-framework_DONE.md](013-procedural-simulation-framework_DONE.md).**
> Marriage-over-time becomes a `marriage` **event** in the new framework's event manifest (Engine B),
> resolved by the dependency/capability system, and lands as framework phase **013e**. The goals below
> still describe the desired behaviour, but implement them as an event definition + handler under 013, not
> as a standalone sim system. (The off-map *coarse* pool is deliberately out of scope until it is replaced
> wholesale — see 013 §1 decision 4.)

## Summary

Extend the live population simulation so that **unpaired living adults form new partnerships
(marriages) over in-game time**. Today only partnerships created during pool **generation** and
**immigrant** draws exist; the live yearly simulation (`004d`) applies mortality and births but never
forms *new* couples, so the living population's pairing is effectively frozen after generation. This
makes the genealogy feel static over long play and starves the birth system of new couples.

## Background / current state (verify during exploration)

- The live simulation lives in `simulatePopulation()` / `simulateYear()` in `src/app/game/Population.ts`
  (added in `004d`). It iterates the living pool each in-game year, assigns deaths (Gompertz mortality)
  and births (to already-married fertile couples), and is deterministic via a per-year RNG forked from
  the world seed.
- Partnerships are `Partnership` records on `GenPerson` (`src/types/Genealogy.ts`):
  `{ partnerId, startTick, endTick }`. Generation (`generatePopulation`) and the immigrant fallback
  (`HouseholdDraw.ts`) are the only places that currently create them.
- `util/kinship.ts` already provides `spouseAt`, `siblingsOf`, `ageAt`, `isAliveAt` — useful for
  eligibility/age-gap/close-kin checks.
- Tunables live in `src/json/lifeSimulation.json` (`SimulationParams` in `types/Genealogy.ts`).

## Goals (to refine later)

1. In the yearly simulation, pair some **eligible** unpaired living adults into `Partnership`s:
   opposite-ish gender, within an age-gap bound, not close kin (no shared parent), both currently
   single (no ongoing partnership). Add an annual marriage probability + params to
   `lifeSimulation.json`.
2. Keep it **deterministic** (use the existing per-year RNG stream) and **coherent** (start tick = the
   simulated year; never marry the deceased).
3. New couples should feed the existing **birth** logic in subsequent years.
4. Decide whether widowed people can re-partner (likely yes; respect `endTick`).
5. **Tests:** new partnerships are symmetric, respect constraints, and are reproducible by seed; a
   couple formed this way can later have children.

## Out of scope

- Divorce / separation modeling beyond what `endTick` already allows.
- Re-housing newlyweds into shared homes (see `011-emergent-rehousing_DONE.md`).

## Notes

- Builds directly on `004d` (`docs/tasks/004-household-generation-redesign_DONE.md`). Coordinate with the
  save system — partnerships already serialize as part of the pool.
