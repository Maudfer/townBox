# [Feature] Structure teardown on bulldoze (residents & businesses)

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `households`, `business`, `cleanup`, `framework-followup`
- **Depends on:** 013 (households/businesses), 023 (shared relocation helper)
- **Status:** ✅ **Done.** `Field.bulldoze` now calls `City.demolishHouse` / `City.demolishWorkplace` (via
  `Game.city`) before the soil overwrite, resolving the `relocateFamily` TODO. A bulldozed **house** runs the
  eviction relocation (`displaceHousehold`, extracted from 022's `evictHousehold`): residents go to a solvent
  relative or become homeless, the household dissolves, no `Person`/`Household` is left pointing at the
  destroyed building. A bulldozed **workplace** runs the 021 closure path (`closeBusiness`: lay off → free jobs
  → clear the `BusinessInstance`). Both emit `structureDemolished` to the feed (029). Post-bulldoze state
  round-trips (homeless households persist, v7). Tests in `test/teardown.test.ts` (house→homeless,
  house→relative, workplace→closed).

## Summary

Make **bulldozing an occupied building** behave coherently: today bulldozing a house silently strands its
household (there's an explicit `relocateFamily` TODO), and bulldozing a workplace would orphan its business
and employees. This task wires teardown to the simulation — relocating or removing residents and closing
businesses cleanly.

## Background / current state (verified)

- `Field.bulldoze()` (`src/app/game/Field.ts`) has a TODO: `// tile.relocateFamily();` and then just builds
  Soil over the tile (`event.tool = Tool.Soil; this.build(event)`), so the `House`/`Workplace` instance is
  torn down by `stampFootprint`'s overwrite logic **without** touching its residents/household/business.
- `stampFootprint`/`destroyStructure` destroy the tile's sprite and drop it from `destinations`, but
  materialized `Person`s still reference the destroyed `House` as their `home`, and the `Household`/business
  records leak.
- Relocation machinery exists (013e `relocateMember`; generalised in 023). Business closure logic exists in
  021 (`Workplace` → lay off + vacate).
- Bulldoze currently happens via the `Bulldoze` tool → `Field.bulldoze` → `build` with `Tool.Soil`.

## Goals / Requirements

1. **Bulldozing a `House`:** before teardown, evict its residents using the shared relocation helper (023/022)
   — try to move them to a relative's/solvent household; if none, mark them homeless (022). Remove the
   `Household` record and clear residents' `home`. Then proceed with the soil overwrite.
2. **Bulldozing a `Workplace`:** close its business via the 021 closure path (lay off employees → free jobs →
   clear the `BusinessInstance`) before teardown.
3. **Confirm-before-destroy UX hook (optional).** Surfacing a confirmation is a UI concern (030/toolbar); at
   minimum emit a signal (`structureDemolished`) so the feed (029) reports it and the player isn't surprised.
4. **No leaks.** After bulldoze: no `Person` points at a destroyed building, no dangling `Household`/business,
   `Field.destinations` is consistent, no orphaned sprites (reuse `destroyStructure`).
5. **Determinism & save:** post-bulldoze state round-trips.

## Out of scope

- The economy consequences themselves (021/022) beyond invoking their code paths.
- Undo/refunds.

## Acceptance criteria

- Bulldozing an occupied house relocates or makes-homeless its residents and removes the household with no
  dangling references; bulldozing a workplace closes its business and lays off employees.
- The `relocateFamily` TODO in `Field.bulldoze` is resolved.
- `npm test` passes with bulldoze-with-occupants tests (house and workplace).

## Notes

- Depends on the shared "relocate people" helper from 023 and the business-closure path from 021; if those
  aren't merged yet, implement a minimal inline version and refactor to the shared helper when they land.
