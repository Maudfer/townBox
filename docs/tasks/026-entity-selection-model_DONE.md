# [Feature] Entity selection model (people & buildings)

- **Type:** Feature / UI foundation
- **Labels:** `feature`, `ui`, `hud`, `framework-followup`
- **Unblocks:** 027 (person window), 028 (workplace window), 029 (feed links), 031 (overview links)

## Summary

Make the **Select tool a universal inspector**: clicking a person, a workplace, or a house opens the right
window. Today only houses are selectable; people are sprites outside the tile matrix and can't be clicked, and
workplaces do nothing. This task adds the selection plumbing the inspector windows (027/028) need.

## Background / current state (verified)

- `Field.select()` (`src/app/game/Field.ts`) runs for the `Select` tool and only does
  `if (tile instanceof House) Game.emit("HouseSelected", tile)`. There is **no** workplace or person path.
- `MainScene.handleClick()` resolves the pointer to a tile and emits `tileClicked`; `Field.handleTileClick`
  dispatches by tool (`select` → `Field.select`). People/vehicles are Phaser sprites drawn in
  `MainScene.drawPerson`/`drawVehicle` and tracked in `Field.people`/`vehicles` — **not** in the tile matrix,
  so a tile-based click can't find them.
- The HUD (`Hud.tsx`) already maps `WindowTypes.HouseDetails` and has **null placeholders** for
  `WorkplaceDetails`, `PersonDetails`, `VehicleDetails`, `CityDetails` (`types/HUD.ts`). `WindowPayload`
  already includes `House | Workplace | Person | Vehicle | City`. `openWindow(type, data, closeExisting)`
  exists.
- Events are declared in `types/Events.ts`; `HouseSelected: House` exists.

## Goals / Requirements

1. **New bus events.** Add `WorkplaceSelected: Workplace` and `PersonSelected: Person` to
   `types/Events.ts` `EventPayloads` (and `VehicleSelected: Vehicle` if cheap).
2. **Person picking.** When the Select tool is active and the pointer is over/near a person sprite, select the
   person instead of the underlying tile. Implement hit-testing against `Field.getPeople()` (nearest person
   whose sprite bounds/center is within a small radius of the world pointer; ignore indoor/hidden people).
   Decide where this lives — recommended: a `Field.selectAt(pixelPosition)` that checks people first, then
   falls back to the structure at that tile — so `MainScene` stays thin. Note people move every frame, so test
   against current positions.
3. **Workplace selection.** Extend `Field.select` (or `selectAt`) so a `Workplace` tile emits
   `WorkplaceSelected`, a `House` emits `HouseSelected` (unchanged), and a person hit emits `PersonSelected`.
4. **HUD wiring.** In `Hud.tsx`, subscribe to the new events and `openWindow` the matching `WindowTypes` with
   the entity as payload (dedupe like HouseDetails — but consider keying dedupe by entity identity, not just
   window type, so two different people can be open at once; document the choice).
5. **Selection affordance (light).** Optional: a subtle highlight/outline on the selected entity. Not required,
   but emit enough for 027/028 to render.

## Out of scope

- The window *contents* (027 person, 028 workplace) — this task only routes selection to (possibly empty)
  windows.
- Drag-box / multi-select.

## Acceptance criteria

- With the Select tool, clicking a person emits `PersonSelected`; clicking a workplace emits
  `WorkplaceSelected`; clicking a house still emits `HouseSelected`.
- The HUD opens the corresponding window type for each (placeholder content is fine until 027/028).
- Person hit-testing accounts for live positions and ignores hidden/indoor people.
- `npm test` passes (unit-test the pick/hit-test logic where it's scene-free; e.g. nearest-person selection
  given a list of positions).

## Notes

- Per CLAUDE.md §4.9 the sim core talks to the HUD only through the bus — keep selection as events, no React in
  `game/`. The dedupe-by-identity decision matters for 027 (the player will want several person windows open).
