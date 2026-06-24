# [Feature] Emergent re-housing of household survivors

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `households`, `life-events`

> **Status: placeholder.** Created as a backlog stub from the 004d follow-up notes. **Not yet detailed —
> run a fresh exploration pass before implementing** (verify the references below against current code).

## Summary

When the live simulation changes a household — most importantly when a **death** leaves a household in
an incoherent state — **move the survivors into a sensible new living arrangement** instead of just
removing the dead. The motivating example (and the original `004` acceptance scenario) is a **minor
left alone** when their guardian/parent dies: they should be relocated to a living relative's household
rather than continuing to "live" by themselves.

## Background / current state (verify during exploration)

- `City.handleNewDay()` (`src/app/game/City.ts`, added in `004d`) runs the yearly simulation and
  **reconciles deaths**: a dead resident is removed from the field (`Field.removePerson`), their
  `House`, and the `Household.memberIds` (head reassigned), and the city population is decremented. It
  does **not** currently relocate the remaining residents.
- The data needed to detect and resolve these cases already exists: the genealogy pool (`Population`),
  kinship derivation (`util/kinship.ts`: `siblingsOf`, `unclesAuntsOf`, `parentsOf`, `isAliveAt`,
  `ageAt`), placement state (`PopulationState.placedIds`), and `Household` records on each `House`.
- Materialized people carry their pool `personId` (`SocialLife`), so survivors can be matched to pool
  records and to other placed households.

## Goals (to refine later)

1. After death reconciliation, detect households left **incoherent** (e.g. a sole remaining **minor**,
   or perhaps an empty house) and resolve them.
2. For an orphaned/abandoned minor, find a **living relative in a placed household** (sibling, aunt/
   uncle, grandparent…) with capacity and move the minor there — updating both `Household`s, the
   `House` resident lists, and the materialized `Person`'s home. Define a clear priority order.
3. Decide the fallback when no suitable relative exists (leave in place? mark household type?).
4. Keep changes consistent with **save/load** (households + residents already serialize).
5. **Tests:** the "minor left alone after the guardian dies is moved to a living relative's household"
   scenario; capacity and no-relative fallbacks.

## Out of scope

- Player-facing notifications/UI for these events.
- Economic consequences of household changes.

## Notes

- Direct follow-up to `004d` (`docs/tasks/004-household-generation-redesign.md`); pairs naturally with
  `010-marriage-formation-over-time.md` (newlyweds may also merge households).
