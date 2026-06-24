# TownBox

TownBox is a 2D, top-down city builder prototype built on the **Phaser 4** game engine with a **React 18** powered GUI, written in **TypeScript** and bundled with **Parcel**. It is an on-and-off personal project being refactored from a collection of isolated experiments into an actual game with a real gameplay loop.

This document is the canonical, high-level description of the project for AI agents and human contributors. It describes what exists today (verified against the source), how the pieces fit together, and the working agreements ("codebase directives") that every contributor must follow.

---

## 1. Current state (what actually works today)

The prototype currently supports a handful of disconnected mechanics. Be aware that many systems are **partially wired** — the building blocks exist but the end-to-end loop is not fully connected.

- **Tile-based world.** A 384×384 grid of fine tiles (16×16 px each). You can paint **roads**, **soil/grass**, **houses**, and generic **work** buildings onto the grid with the mouse. Roads auto-tile based on their neighbors. Each structure occupies a **3×3 footprint** of tiles (the legacy single 48 px tile, now subdivided), centered on the hovered tile. **Roads snap to a fixed 3×3 supertile grid** (every 3rd tile) so they always connect correctly; **buildings keep finer placement but must sit flush against a road side** (they soft-snap to the nearest road side and can't overlap roads or other buildings — invalid spots preview in red).
- **Tall buildings.** Some building sprites are visually taller than their footprint (e.g. `1x1x2`). The sprite is bottom-anchored so it extends upward, but its footprint is a 3×3 block of tiles. A depth (z-order) system makes people and cars correctly render **in front of** a tall building when they are below it, and **behind** it when they are above it.
- **Population & households.** A new save generates a deterministic **population pool**: thousands of `GenPerson` records across generations (mostly deceased ancestors plus a living cohort) carrying parents, partnerships, and birth/death ticks. Placing a **house** draws a coherent **household** — a *living arrangement* (nuclear family, single occupant, adult siblings, multigenerational, a minor living with a guardian because the parents are deceased, or unrelated roommates) — from that pool and materializes its living members into `Person`s. Family trees span households because everyone shares one genealogy. Kinship and age are derived from the pool, not stored. (Aging/death **over time** is not yet wired — ages are read at a fixed present epoch until the clock system lands.)
- **People.** `Person`s have a `SocialLife` (relationships, home, name, age, gender) and a `WorkLife` (a job and a list of skills). People can walk on sidewalks, cross roads, and be marked as "indoors" (hidden) when inside a building.
- **Vehicles.** Test cars can be spawned on the street and will pick **random** building destinations and drive there, following proper lanes.
- **Pathfinding.** A shared A* pathfinder routes both people and cars over the road network. Roads expose **waypoints** — *curb* points (for pedestrians) and *lane* points (for vehicles) — so people walk sidewalks/crosswalks and cars stay in their lane.
- **Travel state machine.** A `Person` has a `TravelStep` state machine intended to drive the exit-house → walk-to-car → drive → walk-to-building → enter loop. It is **only partially wired**: car spawning/parking and despawning on enter/exit are not connected.
- **React HUD.** A fully functional windowing system (drag/resize via `react-rnd`) exists but is **largely unused**. Clicking a house with the Select tool opens a window that renders the family/household tree as a D3 force graph. The toolbar buttons are currently **not wired** to tools.
- **Title screen.** A `TitleScene` splash with "Start Game" and "Load Game" buttons that transition to the main scene (Load Game restores the most recent save).
- **Save / load.** The entire game state (tiles/roads/buildings, the genealogy **population pool**, **households**, people & relationships, vehicles, city) can be saved and restored. Saves are an id-based JSON snapshot, deflated (`pako`) and base64-encoded, stored via a pluggable `SaveProvider` (`LocalStorageProvider` today). Triggered by the toolbar save button, `Ctrl+S`, or the title-screen Load option, with React toasts for feedback; a debug auto-load can boot a build straight into an embedded save.

What does **not** exist yet: a clock/time system, business generation, a day/night work commute loop, and CI.

---

## 2. Tech stack & tooling

| Concern     | Choice |
| ----------- | ------ |
| Engine      | Phaser `^4.1.0` |
| UI          | React `^18.3.1` + `react-dom`, windows via `react-rnd` |
| Language    | TypeScript `^5.4.5` (strict mode, see `tsconfig.json`) |
| Bundler     | Parcel `^2.12.0` |
| Dev server  | `browser-sync` |
| Test runner | Jest `^30` with `ts-jest`, `testEnvironment: node` |
| Data viz    | D3 `^7` (family tree graph) |
| Fake data   | `@faker-js/faker` (`fakerPT_BR` locale) |
| Icons       | `@mdi/js` + `@mdi/react` |

### Scripts (`package.json`)

- `npm run dev` — concurrently copies images, runs Parcel in watch mode, and serves with browser-sync.
- `npm run package` — production build.
- `npm test` — runs Jest.

### Path aliases

Both `tsconfig.json` and `jest.config.js` define matching aliases. **Always import via these aliases, never via long relative paths:**

```
game/*  -> src/app/game/*
hud/*   -> src/app/hud/*
util/*  -> src/util/*
types/* -> src/types/*
json/*  -> src/json/*
css/*   -> src/css/*
```

TypeScript is configured strictly: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `allowUnreachableCode: false`. New code must compile cleanly under these settings.

---

## 3. Project structure

```
src/
  app/
    main.tsx              # React entrypoint; boots GameManager, mounts <HUD> on "gameInitialized"
    game/                 # Phaser + simulation core (no React here)
      GameManager.ts      # Central orchestrator + event bus + tile<->pixel coordinate math
      MainScene.ts        # Phaser scene: input, camera, grid, draw tiles/people/vehicles
      TitleScene.ts       # Splash screen, "Start Game" -> MainScene
      Field.ts            # Tile matrix, people/vehicles lists, destinations set, update loop
      Tile.ts             # Base tile (row/col, asset, depth)
      Soil.ts             # Grass/ground tile
      Road.ts             # Road tile: auto-tiling, curb (pedestrian) & lane (vehicle) waypoints
      Building.ts         # Base building: entrance point + depth
      House.ts            # Residence: household, residents, occupants, garage; family-tree export
      Workplace.ts        # Work building: employees, available jobs (skill-matched hiring)
      Person.ts           # Citizen: position, walking, travel state machine, family tree export
      Vehicle.ts          # Car: driving, acceleration, lane following, rotation/curving
      PathFinder.ts       # A* over the tile grid (roads + destination tiles)
      Population.ts       # Genealogy pool: deterministic generation + state holder
      HouseholdDraw.ts    # Draws a coherent living household from the pool (+ immigrant fallback)
      SocialLife.ts       # Per-person relationships, home, identity
      WorkLife.ts         # Per-person job + skills
      City.ts             # City name, population, wires "houseBuilt" -> household draw + materialize
      DebugTools.ts       # Optional debug overlays (curbs, lanes, tile depth)
      save/SaveProvider.ts       # Storage backend interface (base64 payload)
      save/LocalStorageProvider.ts # localStorage-backed SaveProvider
      save/SaveManager.ts        # Serialize/deserialize the whole world; deflate (pako) + base64 + provider
    hud/                  # React GUI
      Hud.tsx             # Window manager; HouseSelected windows, save/load toasts, Ctrl+S, hudReady
      Toolbar.tsx         # Toolbar (save button wired; others not yet)
      Toasts.tsx          # Transient save/load toast notifications
      Window.tsx          # Generic draggable/resizable window (react-rnd)
      d3/familyTree.ts    # D3 force-directed family tree renderer
      windows/HouseDetails.tsx  # Window showing a household's family tree
  css/styles.css
  html/index.html         # Loads main.tsx, has #hud-container
  img/                    # Source art (.xcf) + sprites/
  json/
    assets.json           # Sprite manifest loaded by MainScene.preload
    config.json           # Debug flags (masterSwitch gates overlays; debug.autoLoad embeds a save)
    input.json            # Keyboard -> tool mappings (F1..F6)
    toolAssets.json       # Tool -> default sprite key
    population.json       # Genealogy pool generation params (founders, generations, lifespans, …)
    householdDraw.json    # Household draw params (arrangement weights, adult age, …)
  types/                  # Shared TypeScript types (Assets, Cursor, Events, Grid, Movement, Position,
                          # Save, Social, Genealogy, Household, Travel, Work, FamilyTree, HUD, Neighbor, Phaser)
  util/                   # Math.ts, tools.ts, base64.ts, random.ts, kinship.ts, compress.ts (helpers)
test/
  personTravel.test.ts    # Person travel state-machine test
  tileFootprint.test.ts   # 3x3 footprint, depth, pathfinding, placement tests
  saveLoad.test.ts        # Save/load round-trip + base64 tests
```

---

## 4. Architecture & key concepts

### 4.1 Boot sequence

1. `index.html` loads `main.tsx`.
2. `main.tsx` constructs a `GameManager`, which builds the Phaser `Game` with `TitleScene` and `MainScene`, plus a `Field` and `City` once the scene initializes.
3. When the scene emits `sceneInitialized`, `GameManager` creates the `Field` and `City` and emits `gameInitialized`.
4. `main.tsx` listens for `gameInitialized` and mounts the React `<HUD>` into `#hud-container`.

### 4.2 Event bus

`GameManager` implements a small custom event system — **not** Phaser's emitter:

- `on(event, { callback, context })` — register a handler.
- `off(event)` — remove all handlers for an event.
- `emit(event, payload)` — async, fans out to all handlers (`Promise.all`).
- `emitSingle(event, payload)` — async, expects exactly **one** handler and returns its result (used when a caller needs a return value, e.g. spawning a person and getting the instance back).

All event names and payload types are declared in `types/Events.ts` (`EventPayloads`). Current events include: `sceneInitialized`, `gameInitialized`, `update`, `tileClicked`, `personSpawnRequest`, `vehicleSpawnRequest`, `houseBuilt`, `tileSpawned`, `personSpawned`, `vehicleSpawned`, `roadBuilt`, `windowDragStart`, `windowDragStop`, `HouseSelected`, `hudReady`, `saveGameRequest`, `gameSaved`, `saveFailed`, `gameLoaded`, `loadFailed`.

> When adding a new cross-system signal, add it to `EventPayloads` first, then wire handlers.

### 4.3 Grid & coordinates

- The world is a `rows × cols = 384 × 384` fine-tile grid. `gridWidth = gridHeight = 6144`, so each tile is `16 × 16` pixels (`gridParams.cells`). A **structure** (soil/road/building) spans a `gridParams.footprint.tiles` × `gridParams.footprint.tiles` footprint — currently `3 × 3` tiles = `48 × 48` px (`gridParams.footprint`), matching the legacy single-tile size.
- `GameManager.tileToPixelPosition({row, col})` returns the **pixel center** of a tile.
- `GameManager.pixelToTilePosition({x, y})` returns the tile under a pixel (or `null` if outside grid bounds).
- `Field.matrix[row][col]` holds a `Tile` reference at each cell. A structure's `(row, col)` is its footprint **anchor (center)**, and **all 9 cells of a footprint reference the same instance** — so `instanceof Road`/`Building` checks keep working everywhere. `Field.destinations` is a `Set<"row-col">` of every building **anchor** (an address == a footprint's anchor cell), used as the pool of random travel destinations.

### 4.4 Tiles, building & auto-tiling

- Class hierarchy: `Tile` → `Soil` | `Road` | `Building`; `Building` → `House` | `Workplace`.
- `Field.build()` (triggered by the `tileClicked` event) instantiates the correct structure anchored on the hovered tile, **stamps it across its 3×3 footprint** (`Field.stampFootprint`, via `Tile.getFootprintCells`), and re-evaluates the four neighboring footprints (`Field.refreshFootprint`). Overlapping placement is allowed: a previously placed structure is only torn down once none of its cells reference it anymore.
- **Placement rules (`Field.resolvePlacement`).** Both the build preview (`MainScene.handleHover`) and the click (`MainScene.handleClick`) resolve placement through one method so they always agree:
  - **Roads snap to the supertile grid** (`Field.snapToRoadGrid`) — the hovered anchor rounds to the nearest `3k+1` tile (the same anchors the soil grid uses), so adjacent roads are always footprint-aligned and connect/auto-tile correctly.
  - **Buildings soft-snap to road sides** (`Field.resolveBuildingPlacement` / `isValidBuildingPlacement`): a building keeps the finer granularity but must be in bounds, not overlap any road/building, and sit flush against a road (a cell on the ring just outside the footprint is a road). When the cursor is within `BUILDING_SNAP_RADIUS_TILES` of a valid road-side spot it snaps to the closest one; otherwise the placement is invalid. Invalid building previews are tinted red and clicks are rejected. `Field.build()` re-enforces these rules authoritatively.
- **Road auto-tiling:** `Road.updateSelfBasedOnNeighbors()` builds a 4-bit code from top/bottom/left/right road neighbors and picks the matching `road_XXXX` sprite. `Field.getNeighbors()` looks one cell **beyond the footprint edge** (offset `floor(footprint/2) + 1`) so adjacent footprints connect.
- **Road waypoints:** on build, a road computes a `curb` (pedestrians) and `lane` (vehicles) from the **footprint** size (`gridParams.footprint`, 48 px) and anchor center, so the corner insets match the legacy single-tile values. Pedestrians use `getClosestCurbPoint()`; vehicles use `getLaneEntryPoint(direction)`.
- **Building entrance:** `Building.calculateEntrance()` stores a single pixel point just below the footprint center. People/cars target the entrance as the final/first waypoint of a trip.

### 4.5 Depth / layering (z-order)

Rendering order is driven by per-object depth values keyed off the structure's **anchor row**:

- `Soil.calculateDepth()` → `0`
- `Road.calculateDepth()` → `row * 10`
- `Building.calculateDepth()` → `(row + 1) * 10`
- `Person` / `Vehicle` depth → `(row + 1) * 10 + 1` (using the anchor row of the footprint they currently stand on)
- Cursor preview → `rows * 10 + 1`; grid lines → `rows * 10 + 100`

Building sprites use origin `(0.5, 1)` (bottom-anchored) and are drawn at `y = tileCenter.y + footprintHeight/2`, so tall sprites extend upward out of their footprint while still sorting by their base row. This is what makes entities pass behind tall buildings above them and in front of buildings below them.

### 4.6 Pathfinding & movement

- `PathFinder.findPath(start, goal)` runs A* (Manhattan heuristic) over the fine tile grid. Valid neighbors are road tiles or any cell of the goal structure's footprint (so a road can reach a building's anchor through its footprint). It then **collapses consecutive cells of the same footprint** so the returned `Tile[]` is a footprint-level path (one step per structure, anchored).
- `Person.walk()` moves the citizen one axis at a time (X then Y) between curb waypoints, updating facing direction and depth as it goes.
- `Vehicle.drive()` accelerates/decelerates, slows for curves, follows lane waypoints, and smoothly rotates (`curve()`) toward its heading.
- `updateDestination()` (on both Person and Vehicle) picks a **random** building from `Field.destinations` when idle — this is placeholder behavior, not the real commute loop.

### 4.7 Travel state machine (`Person`)

`types/Travel.ts` defines `TravelStep`: `Idle → ExitingBuilding → WalkingToCar → EnteringCar → Driving → ExitingCar → WalkingToDestination → Arrived`. `Person.processTravel()` advances the machine, but vehicle spawn/parking/despawn and the trigger to start a commute are **not yet connected**.

### 4.8 Households & social model

- **Population pool (source of truth).** `Population` (`game/Population.ts`) holds a serializable `PopulationState` (`types/Genealogy.ts`): a flat table of `GenPerson` records — identity, gender, `birthTick`/`deathTick`, parents, and partnerships — spanning many generations (mostly deceased ancestors plus a living cohort). It is generated deterministically at new-save time by the pure `generatePopulation(seed, params)` (seeded via `util/random.ts`; params in `json/population.json`) and serialized into the save. Kinship (siblings, grandparents, uncles/aunts, nieces/nephews, cousins) and age are **derived on demand** by pure functions in `util/kinship.ts`, never stored.
- **Households (living arrangements).** A `Household` (`types/Household.ts`) is a *living arrangement* distinct from bloodline. `HouseholdDraw.selectHousehold()` (`game/HouseholdDraw.ts`) draws a coherent living group from the pool by arrangement (nuclear, single, siblings, multigenerational, guardianship, roommates), only ever selecting living, unplaced people, respecting house capacity, never reusing anyone, and generating an immigrant family when the unplaced-living pool is exhausted. The draw is deterministic (a persisted RNG stream); params live in `json/householdDraw.json`.
- `City.setupHousehold()` runs on `houseBuilt`: it calls `Population.drawHousehold()`, **materializes** each drawn living person into a `Person` bound to the house (via `personSpawnRequest`), mirrors the pool's kinship onto the materialized residents (so the family-tree window renders), records the `Household` on the house, and adds the residents to the city population.
- **Time/death caveat.** `deathTick` makes death representable in the data (enabling scenarios like "lives with a sibling because the parents are deceased"), but aging/death **over time** is not yet wired — ages are read at a fixed present epoch (`tick 0`) until the clock system (task 005) lands.
- `SocialLife` stores a `RelationshipMap` (some relationships single-valued, some arrays), the person's `home`, and identity, populated on the materialized residents. `WorkLife` stores a job and skills (defaults to one `ConstructionSkill`).
- Relationship enums and maps live in `types/Social.ts`; genealogy/household types in `types/Genealogy.ts` / `types/Household.ts`; jobs/skills in `types/Work.ts`.

### 4.9 React HUD

- `Hud.tsx` is a window manager. It listens for `HouseSelected` and opens a `HouseDetails` window (deduped) that renders the household's family tree via `hud/d3/familyTree.ts`.
- `Window.tsx` wraps `react-rnd` and emits `windowDragStart`/`windowDragStop` so the Phaser cursor can be suppressed while interacting with UI.
- The simulation core (`game/`) must remain free of React imports. The HUD talks to the game **only through the `GameManager` event bus**, never by reaching into game internals directly.

### 4.10 Input (`json/input.json` + `MainScene`)

- `F1..F6` select tools (soil, road, house, work, select, bulldoze); `Esc` selects the Select tool.
- `P` spawns a person at the cursor; `V` spawns a vehicle; `G` toggles the grid overlay.
- `W/A/S/D` pan the camera; `Q/E` zoom.
- `Ctrl+S` saves the game (handled in the React HUD, which suppresses the browser save dialog).

### 4.11 Save / load (`game/save/`)

- **Format:** an id-based normalized `WorldSnapshot` (`types/Save.ts`) — people/vehicles get stable ids, structures/houses are referenced by their anchor key — serialized to JSON, deflated with `pako` and base64-encoded (`util/compress.ts`; payloads without the compression marker fall back to legacy plain base64). A top-level `version` field (`SAVE_VERSION`, now `2`) drives migrations: `v2` added the genealogy `population` pool and replaced per-house `families` with `households`; `v1` saves still load (with an empty pool). The id-based model lets the cyclic relationship/ownership graph survive a JSON round-trip.
- **Genealogy:** the whole `population` pool (`PopulationState`) and the `Household` records are serialized; both reference pool people by stable id, so households and cross-household genealogy restore intact.
- **Provider abstraction:** `SaveProvider` (`save`/`load`/`list`/`delete` over the payload string) with `LocalStorageProvider` today; swapping providers is a single change in `SaveManager`'s constructor.
- **`SaveManager`** (`game/save/SaveManager.ts`) builds the snapshot from `Field`/`City`/`Population` and restores it. Only roads & buildings are serialized (soil is the implicit grass default); loads apply over a fresh field via `Field.loadStructure`/`loadPerson`/`loadVehicle`, which redraw through the normal `tileSpawned`/`personSpawned`/`vehicleSpawned` events but **never** emit `houseBuilt` (so loading doesn't redraw households). Restore is two-pass: create everything, then relink the graph (relationships, home, household, ownership). In-flight travel is reset to idle on load.
- **Flow & events:** the HUD triggers saves via the `saveGameRequest` event (toolbar button / `Ctrl+S`) and renders toasts from `gameSaved`/`gameLoaded`/`saveFailed`/`loadFailed`. The HUD emits `hudReady` once its listeners are registered; `GameManager` applies a queued load (title-screen load or `config.debug.autoLoad`) only then, so toasts are never missed. Auto-load (`json/config.json` → `debug.autoLoad.{enabled,save}`) skips the splash and boots straight into the embedded save.

---

## 5. Codebase directives (working agreements)

These rules are binding for every contributor (human or AI agent).

### 5.1 Tasks & the `/docs/tasks/` folder

- **Every file in `/docs/tasks/` is a well-defined, self-contained piece of work that is safe to merge to `main` on its own.** Tasks are written JIRA-ticket style: clear, unambiguous goals and requirements, with accurate references to existing code and behavior to prevent intention drift.
- **Starting a task:** pull the latest `main`, create a dedicated branch (e.g. `task/<short-slug>`), and do the work there.
- **Mandatory exploration pass.** Before writing any code for a task, perform a fresh exploration pass on the codebase to verify every claim and reference made in the task description and plan. Code drifts; the task text may be stale.
- **Always ensure test coverage.** Do not ship code that isn't tested. Whether you write new tests or rework existing ones for changing behavior, whenever you work a task that includes new code, map the new behavior to testable assertions and make sure there are tests covering that behavior.
- **Decide on planning depth from the exploration.** Based on the code-tour findings, decide whether the task needs multi-phase planning. If it does, **present a proposal/plan before executing**, and use this moment to ask any questions needed to resolve ambiguities. Small, unambiguous tasks can proceed directly.
- **Finishing a task:** open a **Pull Request**. When finishing, you may **propose** new follow-up tasks for anything left undone.

### 5.2 Branching & merging

- **Never commit or merge directly to `main`. Always open a Pull Request.**
- One task → one branch → one PR. Keep PRs focused on the scope of their task.
- Do not force-push shared branches, rewrite published history, or merge your own PR without the maintainer's review/approval.

### 5.3 Testing & quality gates

- **Always run the test suite (`npm test`) before opening a PR**, and ensure it passes.
- New behavior should ship with tests. Keep the simulation core (`game/`) unit-testable: prefer pure logic that does not require a live Phaser scene where practical.
- Code must compile cleanly under the strict `tsconfig.json` settings — no new type errors, unused locals/parameters, or implicit `any`.
- Do not weaken or bypass quality gates (lint, types, coverage, CI) to land a change.

### 5.4 Authoring tasks

- **Only create new task files with the maintainer's purview, or when explicitly asked.**
- When creating a task file in `/docs/tasks/`, **first do a code-exploration pass** and enrich the task with concrete references to the real codebase (files, classes, methods, events).
- Write tasks with enough detail to prevent intention drift, but do **not** pre-build deep multi-phase plans inside the ticket — detailed planning happens during the task's own exploration pass.

### 5.5 Architecture conventions

- **Keep `game/` (simulation) and `hud/` (React) separate.** Cross the boundary only through the `GameManager` event bus. No React in `game/`; no direct reaching into game internals from React.
- **Add new cross-system signals to `types/Events.ts` (`EventPayloads`) before wiring handlers.**
- **Use the path aliases** (`game/*`, `hud/*`, `types/*`, `util/*`, `json/*`, `css/*`) — never deep relative imports.
- **Centralize tunable data in `src/json/`** (assets, input, config, tool assets, and future game-data files) rather than hard-coding magic values across classes.
- Respect the existing **coordinate** (`tileToPixelPosition` / `pixelToTilePosition`) and **depth** conventions; any change to the tile or layering model must keep both internally consistent.
- Prefer extending the existing `Tile`/`Building` class hierarchy over parallel ad-hoc structures.

### 5.6 Scope & dependencies

- Make only the changes the task requires. Avoid opportunistic refactors, speculative abstractions, and unrelated "improvements" inside a task PR — propose them as follow-up tasks instead.
- Be conservative about adding dependencies. Prefer the libraries already in use; justify any new dependency in the PR.
- Do not commit secrets. Keep build artifacts (`dist/`, `bin/`) and `node_modules/` out of commits.

### 5.7 Documentation

- Keep this `CLAUDE.md` accurate. When a task changes architecture, data flow, or directives, update the relevant section in the **same PR**.
- Do not create extra markdown design docs unless the task asks for them; the task file plus `CLAUDE.md` are the sources of truth.
