# [Feature] Adult children move out / new-household formation

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `households`, `life-events`, `framework-followup`
- **Depends on:** 023 (shared relocation helper), ideally 015/018 (so move-out can require a means of support)
- **Status:** ✅ **Done** (bundled with 023). Modeled as a `move_out` life event in `json/events.json`
  (eligible: alive, adult, **employed**, and `canMoveOut`), where `canMoveOut` is a new Context attribute backed
  by a `game/HousingMarket` adapter (adult non-head with a vacant home available) — mirroring `JobMarket`/
  `canBeHired`. `City.handleNewDay` builds the adapter per-day and handles the emitted `movedOut` signal via
  `City.resolveMoveOut`, relocating the adult into the lowest-keyed vacant house as a new `Single` household
  (no-op if the last vacancy was taken that day). Housing policy (req. 3): move-out only into an existing vacant
  home. No save-schema change. Tests in `test/householdDynamics.test.ts`.

## Summary

Let **grown children leave the family home** to form their own household, so the population doesn't pile up
indefinitely in birth homes and new households appear organically over time. This is the natural complement to
births (a household grows) and marriage cohabitation (023) — households should also *shed* adults.

## Background / current state (verified)

- Births (013d) add children to the mother's household; nothing ever removes a grown child, so multi-generation
  homes only accrete. `HouseholdDraw` only runs at house **placement**; there is no runtime household
  *formation*.
- A move-out needs a destination home. Today new homes only appear when the **player places a house**. So
  move-out must either (a) target an existing vacant/under-capacity home, or (b) be gated on housing
  availability. Decide and document.
- Relocation machinery exists (013e `relocateMember`; generalised in 023). `ageAt` / adulthood threshold
  (`json/householdDraw.json adultAgeYears`) already used by `City.resolveRehousing`.
- Could be modelled as an **event** (`move_out`) in `json/events.json` (eligibility: adult, still living with
  parents, perhaps employed/solvent) with an `emit` signal handled by `City`, consistent with the framework.

## Goals / Requirements

1. **Model move-out as a life event** (`move_out`) in the manifest: eligible when the subject is an adult
   living in a household they don't head (i.e. with a parent/guardian), with a sensible per-year probability
   gradient (rises in young adulthood). Optionally require employment/solvency (018) as a precondition so
   move-out implies means of support.
2. **Handle the signal in `City`.** On `move_out`, create a **new single-person household** for the mover in
   an available home, or, if paired with marriage (023), into the spouse's home. Use the shared relocation
   helper.
3. **Define housing availability policy.** Recommended: the mover takes a vacant house if one exists; if none,
   the event doesn't fire (no homeless-by-choice). Document this; it interlocks with vacancy created by
   bankruptcy (021) and the future housing market.
4. **Keep both households coherent** (memberIds, head, residents, home), and update city population counts as
   appropriate.
5. **Determinism & save.**

## Out of scope

- A housing market / construction by NPCs — move-out only uses existing vacant homes for now.
- Roommate formation among unrelated movers (possible later, mirrors `HouseholdDraw` roommates arrangement).

## Acceptance criteria

- Over time, eligible adult children leave the parental home to form their own household when housing allows;
  parental households shrink accordingly and stay coherent.
- No move-out into an over-capacity or nonexistent home; deterministic; survives save/load.
- `npm test` passes with a move-out scenario test.

## Notes

- Together with 023 and 022, this makes the living-arrangement layer dynamic rather than frozen at placement —
  closing a real gap (households currently only ever form via the player placing a house).
