# [Feature] Subdivide each tile into a 3×3 sub-tile grid

- **Type:** Feature / Core systems
- **Labels:** `feature`, `tiling`, `pathfinding`, `breaking-change`

## Summary

Increase placement granularity by splitting the current single tile into a **3×3 grid of smaller
tiles**. A building or road that occupies **1 tile today must occupy 9 sub-tiles** in the new
system. This enables finer placement of roads/buildings and lays the groundwork for buildings and
roads larger than one (old) tile in the future.

This is a deep, cross-cutting change. The exploration/planning pass for this task **must** produce a
multi-phase plan before implementation, because it touches the grid model, building/road placement,
pathfinding, waypoints, addresses, the build preview/cursor, and the depth/layering system.

## Background / current state

The world is a `128 × 128` tile grid (`GameManager` constructor: `fieldParams.rows/cols = 128`,
`gridWidth = gridHeight = 6144`, so `cells = 48 × 48` px). Key facts to verify during exploration:

- **Coordinates:** `GameManager.tileToPixelPosition` / `pixelToTilePosition` convert between
  `{row, col}` and pixel space using `gridParams.cells` and `gridParams.bounds`.
- **Matrix:** `Field.matrix[row][col]` stores one `Tile` per cell. `Field.destinations` is a
  `Set<"row-col">` of building tiles used as travel destinations (i.e. an **address == one tile**
  today).
- **Placement:** `Field.build()` is driven by `tileClicked` (the cursor is the tile under the
  mouse center). It instantiates one tile, replaces it, and re-evaluates the 4 orthogonal
  neighbors. Roads auto-tile via `Road.updateSelfBasedOnNeighbors()` (4-bit neighbor code).
- **Waypoints:** `Road.calculateCurb()` (pedestrian, inset 4) and `Road.calculateLanes()` (vehicle,
  inset 13) compute 4 corner points from the tile's pixel center and cell size.
  `Building.calculateEntrance()` stores one entrance point below the tile center.
- **Preview/cursor:** `MainScene.handleHover()` positions the semi-transparent cursor sprite at the
  hovered tile center (`imageY = tileCenter.y + cells.height/2`). `setCursor()` sets cursor depth to
  `rows * 10 + 1`.
- **Pathfinding:** `PathFinder.findPath()` runs A\* over `Field.matrix`, treating road tiles (and
  the goal tile) as walkable; people/vehicles step from tile to tile via curb/lane waypoints.
- **Depth/layering:** depth is derived from tile `row` (`Soil=0`, `Road=row*10`,
  `Building=(row+1)*10`, entities `(row+1)*10+1`). Building sprites are bottom-anchored
  (`origin (0.5,1)`, drawn at `center.y + cellHeight/2`) so tall sprites extend upward but sort by
  base row.

## Goals / Requirements

1. **Sub-tile grid model.** Subdivide each existing tile into a 3×3 grid of sub-tiles. Decide and
   document (in the plan) whether this is implemented by increasing the matrix resolution
   (e.g. `384 × 384` sub-tiles with `16 × 16` px cells) or via a nested tile abstraction. The
   chosen approach must keep `tileToPixelPosition` / `pixelToTilePosition` correct.
2. **Placement still centers on the mouse.** Placing a building or road must still happen with the
   mouse at the **center** of the placed structure. A structure that was 1 tile (now 3×3 sub-tiles)
   must be centered on the hovered sub-tile, occupying the surrounding 9 sub-tiles.
3. **Roads.** Roads must still place and auto-tile correctly at the new granularity, and remain
   traversable. Account for how the 4-bit neighbor auto-tiling and curb/lane waypoints translate to
   the sub-tile model (e.g. waypoints may now be defined per old-tile footprint, not per sub-tile).
4. **Addresses abstraction.** Introduce an abstraction so a home/work address is no longer a single
   tile but a **footprint** (a set/region of sub-tiles) with a canonical reference point (e.g. the
   entrance). Update `Field.destinations` and anything that resolves a person's home/work to a tile
   accordingly. `Person.social.getHome()` / `WorkLife` destinations must keep working.
5. **Pathfinding & movement.** A\* (`PathFinder`), curb/lane waypoint following
   (`Road.getClosestCurbPoint`, `getLaneEntryPoint`), and the per-tile stepping in `Person.walk()`
   and `Vehicle.drive()` must all keep working at the new resolution. People must still walk
   sidewalks/crosswalks and cars must still follow lanes.
6. **Building entrance system.** `Building.calculateEntrance()` and how people/cars target the
   entrance must be updated for multi-sub-tile footprints.
7. **Build preview / cursor.** `MainScene.handleHover()` / `setCursor()` must preview the full
   footprint at the correct size and centered position, with correct depth.
8. **Tall buildings & layering.** Tall building sprites must still render correctly, and the
   depth/layering system must still make people and cars pass **behind** a tall building when above
   it and **in front** when below it. Re-derive depth from the footprint's base row in the new
   model.
9. The game must build (`npm run dev`) and `npm test` must pass.

## Out of scope

- Actually adding new larger-than-1-tile building/road types or art. This task only enables the
  capability; new multi-tile structures are follow-up work.
- Visual/art changes beyond what is required to keep current sprites rendering correctly.

## Acceptance criteria

- Each former tile is represented as 3×3 sub-tiles; existing houses, work buildings, and roads
  occupy a 3×3 footprint and render identically to before.
- Placement is centered on the mouse; the build preview matches the final footprint.
- People and cars pathfind, walk sidewalks/cross roads, and drive lanes correctly.
- Home/work addressing resolves through the new footprint abstraction.
- Tall-building layering verified correct from both above and below.
- `npm test` passes.

## Notes / risks

- This is the highest-risk task in the backlog. The planning pass **must** propose a phased rollout
  (e.g. model → coordinates → placement/preview → roads/waypoints → addresses → pathfinding →
  layering) and call out migration of the `destinations` set and depth formulas explicitly.
- Watch for hard-coded magic numbers tied to the `48px` cell size and the `±4`/`±13` waypoint insets
  (`Road.calculateCurb/Lanes`) and the `-5` entrance offset (`Building.calculateEntrance`).
- Consider keeping the old "tile" as a logical footprint unit layered on top of the finer grid to
  minimize churn — evaluate during planning.

## Comments after reviewing this task:

I just wanna make sure we got our terminology right here: After this rework, everyexisting structure in the game, both roads and buildings, will effectively be a larger-than-1-tile structure. That's because they will occupy 9 tiles each, when they previously occupied 1 tile. I realize from your question that I may have confused you into creating a data structure in our program called a sub-tile. Let's keep these smaller subdivisions the tiles, and if you need to create a larger abstraction named something else to occupy 9 tiles, then do it there. I don't want an abstraction called sub-tile that's 1/9 of a tile. Here's how I originally phrased the task, for your further context: 
``` 
  I want the tiling system to allow for more positioning flexibility than it currently does. Right now, each building and road all occupy one single tile. There are tall buildings which occupy multiple tiles visually, because they are tall, but their base still take up one single tile. Let's break the current tile in 3x3 smaller tiles, meaning a building that occupies 1 tile in the current system will take up 9 tiles in the new system. This will allow for much more granular placing of buildings and roads, and also allow for larger buildings and roads in the future. But beware: Changing this has implications for how we place down roads and buildings, which should still work with the mouse being at the center of the building/road being placed. It also has implications on addresses: Right now a person's home or work is a single tile. We need an abstraction to solve this. The way people and cars move from one waypoint to the other and one tile to the other and the entire pathfinding system has to keep working, it will need adjustments. The building entrance coordinate system will need adjustments. The building preview system will need adjustments. Tall buildings need to keep working, the layering system that makes people and cars correctly move in front of tall buildings when below them and behing tall buildings when above them, will need adjustments.
```
So to be clear: After this rework is done, I expect finer placement granularity than what we have today. Whatever abstractions you come up with like Lot, Plot, etc, should be able to overlap, because placement granularity for a building is now finer. Again, solving potential problems with the location/address/coordinates of a building or road on this new system is in the scope of this task.

## Follow-up scope (added after the first implementation landed)

After living with the finer grid, the granular placement is great for buildings but causes problems
for roads. Two additional, related requirements are now part of this task:

### F1. Roads snap to a fixed 3×3 "supertile" grid

Finer placement granularity does **not** work well for roads: two road footprints can end up
touching but not correctly connected (e.g. horizontally adjacent but vertically offset by a single
tile — a third of a road — so they look joined but their lanes/curbs and auto-tiling don't line up).

Decision: **roads snap to a fixed grid of 3×3-tile supertiles** (every 3rd tile, horizontally and
vertically — the same anchors the soil/grass footprints already use). This guarantees adjacent roads
are always footprint-aligned and connect/auto-tile correctly.

- Implementation is free to choose between a dedicated "supertile/supergrid" abstraction or a purely
  mathematical snap (round the hovered anchor to the nearest supertile anchor). Pick whichever yields
  the cleaner code for our use case — it only affects code organization, not behavior.
- The **road build preview must snap too**, so the user always sees exactly where a road will land.

### F2. Buildings are restricted to road sides (soft-snap + invalid feedback)

Buildings keep the finer placement, but with new rules:

- A building may **not** be placed on top of an existing road or another existing building.
- A building must be placed against a **road side**. Use a **soft-snap** system: when the cursor is
  close to a road side, the building snaps to the closest valid road-side placement, while still
  letting the user choose any road side they want by moving the cursor.
- If the user intentionally moves the cursor **too far from any road side to snap**, show the preview
  at the raw cursor position with a **red tint** to indicate an invalid placement (and reject the
  click).
- Likewise, if the cursor is intentionally over another building (or a road), show the red-tinted
  invalid preview and reject the click.

Both the preview and the actual placement must agree on the resolved position and validity.
