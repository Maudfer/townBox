# TownBox

TownBox is a 2D, top-down city builder prototype built on the **Phaser 4** game engine with a **React 18** powered GUI, written in **TypeScript** and bundled with **Parcel**. It is an on-and-off personal project being refactored from a collection of isolated experiments into an actual game with a real gameplay loop.

This document is the canonical, high-level description of the project for AI agents and human contributors. It describes what exists today (verified against the source), how the pieces fit together, and the working agreements ("codebase directives") that every contributor must follow.

---

## 1. Current state (what actually works today)

The prototype currently supports a handful of disconnected mechanics. Be aware that many systems are **partially wired** — the building blocks exist but the end-to-end loop is not fully connected.

- **Tile-based world.** A 384×384 grid of fine tiles (16×16 px each). You can paint **roads**, **soil/grass**, **houses**, and generic **work** buildings onto the grid with the mouse. Roads auto-tile based on their neighbors. Each structure occupies a **3×3 footprint** of tiles (the legacy single 48 px tile, now subdivided), centered on the hovered tile. **Roads snap to a fixed 3×3 supertile grid** (every 3rd tile) so they always connect correctly; **buildings keep finer placement but must sit flush against a road side** (they soft-snap to the nearest road side and can't overlap roads or other buildings — invalid spots preview in red).
- **Tall buildings.** Some building sprites are visually taller than their footprint (e.g. `1x1x2`). The sprite is bottom-anchored so it extends upward, but its footprint is a 3×3 block of tiles. A depth (z-order) system makes people and cars correctly render **in front of** a tall building when they are below it, and **behind** it when they are above it.
- **Population & households.** A new save generates a deterministic **population pool**: thousands of `GenPerson` records across generations (mostly deceased ancestors plus a living cohort) carrying parents, partnerships, and birth/death ticks. Placing a **house** draws a coherent **household** — a *living arrangement* (nuclear family, single occupant, adult siblings, multigenerational, a minor living with a guardian because the parents are deceased, or unrelated roommates) — from that pool and materializes its living members into `Person`s. Family trees span households because everyone shares one genealogy. Kinship and age are derived from the pool, not stored — and **age tracks the in-game clock** (people get older as time passes). The pool is also **simulated live**: each in-game year, age-based mortality and births advance the population, and residents who die are removed from their house and the map.
- **Clock & calendar.** In-game time advances from the frame loop: **1 in-game day = 1 real hour**, on a regular 30-day-month / 12-month-year (360-day) calendar counting from **Year 1**. A `Clock` is the single source of time; the HUD shows a live date/time widget, `timeChanged`/`newDay` events fan out on the bus, jobs carry shift start/end times, and the clock state is saved. The clock's day index is the genealogy tick (so the pool and ages stay consistent).
- **Businesses.** Placing a **work** building generates a **business** from a JSON **blueprint** (Engine A of the procedural framework, §4.13): a line of work (supermarket, hospital, school, restaurant, construction site), a generated name, a drawn **size**, and a set of **job positions** whose counts scale with size via declarative **curves** (e.g. a supermarket's clerks scale faster and higher than its janitors). Jobs and their required **skills** are JSON reference tables. Generation is deterministic per world seed + building location.
- **Life events.** A data-driven **event engine** (Engine B, §4.13) runs detailed life events (death, marriage, divorce, sex, pregnancy/birth, …) over **materialized** people each in-game day. Events are flat JSON records with eligibility predicates, age/state probability gradients, and effects; a load-time compiler derives their dependency/exclusivity graph (NPM-style). Deaths despawn residents and **re-house** orphaned minors with a living relative; births materialize a newborn into the mother's house. The off-map genealogy pool keeps its coarse yearly demographic sim, excluding materialized people (whom the event engine now owns).
- **People.** `Person`s have a `SocialLife` (relationships, home, name, age, gender) and a `WorkLife` (a job and a list of skills). People can walk on sidewalks, cross roads, and be marked as "indoors" (hidden) when inside a building.
- **Vehicles.** Test cars can be spawned on the street and will pick **random** building destinations and drive there, following proper lanes.
- **Pathfinding.** A shared A* pathfinder routes both people and cars over the road network. Roads expose **waypoints** — *curb* points (for pedestrians) and *lane* points (for vehicles) — so people walk sidewalks/crosswalks and cars stay in their lane.
- **Daily commute (task 006).** Employed residents commute home↔work each day: at shift start a car is spawned at the origin building's entrance and the `Person`'s `TravelStep` machine drives exit-house → walk-to-car → drive → walk-to-building → enter, despawning the car on arrival; the reverse runs at shift end. The scheduler is `City.handleCommute` (on `timeChanged`), reading each employee's shift times and `WorkLife.getWorkplace()`. Commute cars are flagged "controlled" so the placeholder random-destination wandering doesn't hijack them.
- **React HUD.** A fully functional windowing system (drag/resize via `react-rnd`) exists but is **largely unused**. Clicking a house with the Select tool opens a window that renders the family/household tree as a D3 force graph. The toolbar buttons are currently **not wired** to tools.
- **Title screen.** A `TitleScene` splash with "Start Game" and "Load Game" buttons that transition to the main scene (Load Game restores the most recent save).
- **Save / load.** The entire game state (tiles/roads/buildings, the genealogy **population pool**, **households**, people & relationships, vehicles, city) can be saved and restored. Saves are an id-based JSON snapshot, deflated (`pako`) and base64-encoded, stored via a pluggable `SaveProvider` (`LocalStorageProvider` today). Triggered by the toolbar save button, `Ctrl+S`, or the title-screen Load option, with React toasts for feedback; a debug auto-load can boot a build straight into an embedded save.

What does **not** exist yet: the **economy** (money, prices, P&L, bankruptcy — the framework carries design-for fields but the money loop is unbuilt), and CI.

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
      Population.ts       # Genealogy pool: deterministic generation + coarse off-map yearly sim + state holder
      HouseholdDraw.ts    # Draws a coherent living household from the pool (+ immigrant fallback)
      BusinessGen.ts      # Engine A: pure generateBusiness() — expands blueprint job curves by size
      EventCompiler.ts    # Engine B: compileEvents() -> dependency/exclusion/topo graph (NPM-like)
      EventEngine.ts      # Engine B: per-day life-event runtime over materialized people (+ history)
      Clock.ts            # Single source of in-game time; advances from "update", derives the calendar
      SocialLife.ts       # Per-person relationships, home, identity
      WorkLife.ts         # Per-person job + skills
      City.ts             # Wires houseBuilt->household, workplaceBuilt->business, newDay->event sim + rehousing
      DebugTools.ts       # Optional debug overlays (curbs, lanes, tile depth)
      save/SaveProvider.ts       # Storage backend interface (base64 payload)
      save/LocalStorageProvider.ts # localStorage-backed SaveProvider
      save/SaveManager.ts        # Serialize/deserialize the whole world; deflate (pako) + base64 + provider
    hud/                  # React GUI
      Hud.tsx             # Window manager; HouseSelected windows, save/load toasts, Ctrl+S, hudReady
      Toolbar.tsx         # Toolbar (save button wired; others not yet)
      Toasts.tsx          # Transient save/load toast notifications
      Clock.tsx           # Persistent date/time widget (reads the timeChanged event)
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
    lifeSimulation.json   # Coarse off-map mortality/fertility params (death curve, birth rate, age cap, …)
    businesses.json       # Engine A blueprints: lines of work, size range, per-job count curves, economics
    jobs.json             # Job reference table: title, salary, required skills, design-for strain/admiration
    materials.json        # Material reference table (stub; design-for prices)
    events.json           # Engine B life-event manifest (roles, probability, effects)
  types/                  # Shared TypeScript types (Assets, Cursor, Events, Grid, Movement, Position, Save,
                          # Social, Genealogy, Household, Time, Travel, Work, FamilyTree, HUD, Neighbor, Phaser,
                          # Simulation (Context), Business, LifeEvent)
  util/                   # Math.ts, tools.ts, base64.ts, random.ts, kinship.ts, compress.ts, familyGraph.ts,
                          # time.ts, curve.ts (scaling/gradient curves), predicate.ts (eligibility AST)
test/
  personTravel.test.ts    # Person travel state-machine test
  tileFootprint.test.ts   # 3x3 footprint, depth, pathfinding, placement tests
  saveLoad.test.ts        # Save/load round-trip + base64 tests
  curve.test.ts / predicate.test.ts            # Substrate (curves + predicates)
  businessGen.test.ts / businessSetup.test.ts  # Engine A generation + placement wiring
  eventCompiler.test.ts / eventEngine.test.ts  # Engine B compiler + per-day runtime
  cityLifeEvents.test.ts / rehousing.test.ts   # Birth materialization + orphan re-housing
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

All event names and payload types are declared in `types/Events.ts` (`EventPayloads`). Current events include: `sceneInitialized`, `gameInitialized`, `update`, `tileClicked`, `personSpawnRequest`, `vehicleSpawnRequest`, `houseBuilt`, `workplaceBuilt`, `tileSpawned`, `personSpawned`, `vehicleSpawned`, `roadBuilt`, `windowDragStart`, `windowDragStop`, `HouseSelected`, `hudReady`, `saveGameRequest`, `gameSaved`, `saveFailed`, `gameLoaded`, `loadFailed`, `timeChanged`, `newDay`.

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
- `updateDestination()` (on both Person and Vehicle) picks a **random** building from `Field.destinations` when idle — placeholder wandering for un-owned/test entities. `Field.update` skips it for **controlled** (commute) cars, and retiring it for residents is task 016.

### 4.7 Travel state machine & commute (`Person`)

`types/Travel.ts` defines `TravelStep`: `Idle → ExitingBuilding → WalkingToCar → EnteringCar → Driving → ExitingCar → WalkingToDestination → Arrived`. `Person.processTravel()` advances the machine and is now driven end-to-end by the commute (task 006): `City.startCommute` spawns/assigns the car and calls `Person.setDestination(building)`; `Arrived` records the `currentBuilding` (home/workplace, for the scheduler) and despawns the car via `Field.removeVehicle`. `City.handleCommute` (on `timeChanged`) dispatches employed, idle residents against their job's `shiftStart`/`shiftEnd` and `WorkLife.getWorkplace()` (the employer reference set on hire by `JobMarket`, restored on load).

### 4.8 Households & social model

- **Population pool (source of truth).** `Population` (`game/Population.ts`) holds a serializable `PopulationState` (`types/Genealogy.ts`): a flat table of `GenPerson` records — identity, gender, `birthTick`/`deathTick`, parents, and partnerships — spanning many generations (mostly deceased ancestors plus a living cohort). It is generated deterministically at new-save time by the pure `generatePopulation(seed, params)` (seeded via `util/random.ts`; params in `json/population.json`) and serialized into the save. Kinship (siblings, grandparents, uncles/aunts, nieces/nephews, cousins) and age are **derived on demand** by pure functions in `util/kinship.ts`, never stored.
- **Households (living arrangements).** A `Household` (`types/Household.ts`) is a *living arrangement* distinct from bloodline. `HouseholdDraw.selectHousehold()` (`game/HouseholdDraw.ts`) draws a coherent living group from the pool by arrangement (nuclear, single, siblings, multigenerational, guardianship, roommates), only ever selecting living, unplaced people, respecting house capacity, never reusing anyone, and generating an immigrant family when the unplaced-living pool is exhausted. The draw is deterministic (a persisted RNG stream); params live in `json/householdDraw.json`.
- `City.setupHousehold()` runs on `houseBuilt`: it calls `Population.drawHousehold()`, **materializes** each drawn living person into a `Person` bound to the house (via `personSpawnRequest`), mirrors the pool's kinship onto the materialized residents (so the family-tree window renders), records the `Household` on the house, and adds the residents to the city population.
- **Time, aging & the live simulation.** Age derives from `birthTick` against the live `Clock` (`SocialLife.getAge()`), so people age as in-game time passes; the household draw uses `clock.getCurrentTick()` so composition matches the date. `City.handleNewDay()` runs each `newDay` and drives **two** simulations (§4.13): the **coarse** off-map pool sim (`Population.simulate()` → `simulatePopulation()`, age-based mortality + couple fertility, yearly, **excluding materialized people**), and the per-day **event engine** (Engine B) over materialized people, whose `died`/`born` results drive reconciliation — a dead resident is removed from the field (`Field.removePerson`), their house, and the `Household.memberIds` (head reassigned), orphaned minors are **re-housed** with a living relative, and newborns are materialized into the mother's house. Materialized people carry their pool `personId` (`SocialLife`) so events match back. Both sims are deterministic (each tick/year forks an RNG from the world seed). Coarse tunables in `json/lifeSimulation.json`; event definitions in `json/events.json`.
- `SocialLife` stores a `RelationshipMap` (some relationships single-valued, some arrays), the person's `home`, and identity, populated on the materialized residents. `WorkLife` stores a job and skills; skills start empty and are assigned a deterministic, age-aware set at materialization by `util/skills.ts` (`assignSkills`, seeded from the world seed ^ `personId`; weights in `json/skills.json`), so hiring (006/015) has something to match (`WorkLife.addSkill` is the hook for education events).
- Relationship enums and maps live in `types/Social.ts`; genealogy/household types in `types/Genealogy.ts` / `types/Household.ts`; jobs/skills in `types/Work.ts`.

### 4.9 React HUD

- **Selection & windows (task 026/027).** The **Select tool is the universal inspector**: `MainScene` routes a Select click to `Field.selectAt(pixel)`, which hit-tests visible people first (`findPersonAt`) then the structure, emitting `PersonSelected` / `HouseSelected` / `WorkplaceSelected`. `Hud.tsx` (the window manager) opens the matching window: `HouseDetails` (the household family tree via `hud/d3/familyTree.ts`, derived from the genealogy pool in `util/familyGraph.ts` — spans households, deceased ancestors dimmed/†), and `PersonDetails` (`hud/windows/`), which shows identity/age/job/skills/relationships and the person's **life-event log** (read from `EventEngine.getHistory()`, dated via `util/time.ts` `formatDay`). and `WorkplaceDetails` (business name/line/size, a filled/open **positions** table via `util/positions.ts` `summarizePositions`, and the employee list). House windows are singletons; person windows dedupe by identity (several may be open). Map hit-testing only finds **visible** (outdoor) people, but the `HouseDetails` resident list and `WorkplaceDetails` employee list are clickable (they `emit("PersonSelected", …)`), so **any** person — including indoor residents — is inspectable. Finance fields on `WorkplaceDetails` await the economy (task 020).
- `Window.tsx` wraps `react-rnd` and emits `windowDragStart`/`windowDragStop` so the Phaser cursor can be suppressed while interacting with UI.
- The simulation core (`game/`) must remain free of React imports. The HUD talks to the game **only through the `GameManager` event bus**, never by reaching into game internals directly.

### 4.10 Input (`json/input.json` + `MainScene`)

- `F1..F6` select tools (soil, road, house, work, select, bulldoze); `Esc` selects the Select tool.
- `G` toggles the grid overlay. `P` (spawn a wandering test person) / `V` (spawn a test car) are **debug-only**, gated behind `json/config.json` `debug.spawnKeys` (off by default) — in normal play all people/cars come from the simulation (households, newborns, commuters). See task 016.
- `W/A/S/D` pan the camera; `Q/E` zoom.
- `Ctrl+S` saves the game (handled in the React HUD, which suppresses the browser save dialog).

### 4.11 Save / load (`game/save/`)

- **Format:** an id-based normalized `WorldSnapshot` (`types/Save.ts`) — people/vehicles get stable ids, structures/houses are referenced by their anchor key — serialized to JSON, deflated with `pako` and base64-encoded (`util/compress.ts`; payloads without the compression marker fall back to legacy plain base64). A top-level `version` field (`SAVE_VERSION`, now `5`) drives migrations: `v2` added the genealogy `population` pool and replaced per-house `families` with `households`; `v3` added `clock` state; `v4` added the per-workplace `business`; `v5` added the per-person `eventHistory` table. Older saves still load (empty pool/clock/business/history). The id-based model lets the cyclic relationship/ownership graph survive a JSON round-trip.
- **Genealogy, clock, businesses & events:** the whole `population` pool (`PopulationState`), the `Household` records, the `clock` (elapsed ms), each work building's generated `business`, and the per-person `eventHistory` (a side-table keyed by pool `personId`) are serialized; ids are stable, so households, cross-household genealogy, the current date/time, businesses, and event history restore intact.
- **Provider abstraction:** `SaveProvider` (`save`/`load`/`list`/`delete` over the payload string) with `LocalStorageProvider` today; swapping providers is a single change in `SaveManager`'s constructor.
- **`SaveManager`** (`game/save/SaveManager.ts`) builds the snapshot from `Field`/`City`/`Population` and restores it. Only roads & buildings are serialized (soil is the implicit grass default); loads apply over a fresh field via `Field.loadStructure`/`loadPerson`/`loadVehicle`, which redraw through the normal `tileSpawned`/`personSpawned`/`vehicleSpawned` events but **never** emit `houseBuilt` (so loading doesn't redraw households). Restore is two-pass: create everything, then relink the graph (relationships, home, household, ownership). In-flight travel is reset to idle on load.
- **Flow & events:** the HUD triggers saves via the `saveGameRequest` event (toolbar button / `Ctrl+S`) and renders toasts from `gameSaved`/`gameLoaded`/`saveFailed`/`loadFailed`. The HUD emits `hudReady` once its listeners are registered; `GameManager` applies a queued load (title-screen load or `config.debug.autoLoad`) only then, so toasts are never missed. Auto-load (`json/config.json` → `debug.autoLoad.{enabled,save}`) skips the splash and boots straight into the embedded save.

### 4.12 Clock & calendar (`game/Clock.ts`, `util/time.ts`)

- **Scale & calendar:** **1 in-game day = 1 real hour** (`MS_PER_IN_GAME_DAY`). The calendar is a regular **30-day month / 12-month year = 360 days/year** (`DAYS_PER_YEAR`), counting from **Year 1**. Time math lives in pure functions in `util/time.ts` (`timestampFromElapsed`, `absoluteDayFromElapsed`, `formatTimestamp`), unit-tested without Phaser.
- **Single source of truth:** `Clock` (`game/Clock.ts`) accumulates elapsed real time (`advance` is the only mutator) and derives everything. `GameManager` owns it (`game.clock`), advances it from the `update` event, and emits `timeChanged` (once per in-game minute) and `newDay` (per rollover), each carrying the current `tick`. Other systems read the clock; they don't re-derive time.
- **Genealogy contract:** `getCurrentTick()` is the absolute in-game day index — the canonical **genealogy tick** — and `getTicksPerYear()` equals `DAYS_PER_YEAR`, which must match `json/population.json`'s `ticksPerYear`. `SocialLife` holds a shared `Clock` (set by `GameManager`) so `getAge()` derives from `birthTick` live; `City`'s household draw and the family-tree window read `clock.getCurrentTick()`.
- **Jobs:** `JobPosition` carries `shiftStart`/`shiftEnd` (minutes since midnight); seeded `Workplace` jobs default to 09:00–17:00. The `newDay` signal drives the live simulation (§4.8, §4.13); shift times are what the commute (006) will hook into.

### 4.13 Procedural simulation framework (businesses + life events)

The data-driven framework that generates content and drives dynamic behaviour from JSON manifests. Design and rationale: `docs/tasks/013-procedural-simulation-framework_DONE.md`. **It is two engines over a shared substrate, not one recursive tree.**

- **Substrate (pure, scene-free).** `util/curve.ts` — declarative scalar `Curve`s (`const/linear/sqrt/log/logistic/step`) used both for Engine A size-scaling and Engine B probability gradients. `util/predicate.ts` — a JSON `Predicate` AST (`all/any/not`, attr comparisons, `hasEvent` with recency/count, `role/where`) evaluated against a `SimulationContext` (`types/Simulation.ts`: `getAttr`/`hasEvent`/`role`). Both are fully unit-tested with fixtures.
- **Engine A — business blueprints.** `json/businesses.json` declares lines of work; each job's position count is a `Curve` over the business **size**. `game/BusinessGen.ts` `generateBusiness(blueprint, jobs, name, size)` (pure) expands those curves into `JobPosition`s. `City.setupBusiness()` runs on `workplaceBuilt`, deterministically (seed = world seed ^ anchor key) picking a blueprint, drawing a size, naming it (faker), and assigning a `BusinessInstance` to the `Workplace`. `json/jobs.json` is the job/skill reference table; `json/materials.json` is a design-for stub. Economic fields (salary, prices, P&L) are present but **not yet simulated**.
- **Engine B — life events.** `json/events.json` is a flat manifest of events: `roles` (the implicit `subject` plus co-participants bound by indexed relation `partnerOf:subject` or candidate `where` search), a per-year `probability` with `Curve` factors, and a closed, typed `effects` vocabulary (`setDeath/marry/divorce/birth/setAttr/acquireSlot/releaseSlot/adjustMoney/emit`). `game/EventCompiler.ts` `compileEvents()` derives — NPM-style, from each event's own requirements + effects — a `dependsOn`/`excludes`/`topoOrder`/`indexKeys` graph plus validation warnings; **mutual exclusivity is derived, never authored** (e.g. death sets `alive=false`, so it excludes every event requiring `alive=true`). `game/EventEngine.ts` runs the per-day resolver over **materialized people only**: per agent it walks the topo order, checks eligibility, rolls the per-day hazard (per-year ÷ `ticksPerYear`), applies effects (mutating the pool + a per-person attribute overlay), records history, and queues signals. Deterministic per world seed + tick.
- **Employment (task 015).** Hiring is realized through the framework's resource-pivot pattern: the `get_job` event's `acquireSlot` and `layoff`'s `releaseSlot` perform real `Workplace.hire`/`layoff` via a `game/JobMarket` adapter passed into `EventEngine.simulateDay` (built per-day by `City.handleNewDay`). The engine stays scene-free — it consults the `JobMarket` interface (`types/LifeEvent.ts`) to derive `employed` (from a real `WorkLife.job`) and `canBeHired` (a reachable open, skill-matched slot exists), so `get_job` only rolls when a hire is possible and a failed acquisition aborts the event. The market scores candidates by skill fit minus home↔workplace distance (deterministic, no RNG). Skills come from `util/skills.ts` (task 014).
- **Cadence & ownership.** Engine B runs on `newDay` from `City.handleNewDay` (§4.8); the coarse off-map pool sim (`Population.simulate`) **excludes materialized people**, so death/marriage/birth for on-map people are owned solely by Engine B. Marriage-over-time (task 010) and orphan re-housing (task 011) are realized as event effects/handlers, not separate systems.
- **Flexibility line.** Adding events/businesses/jobs/curves/gradients is **pure data** (files only); adding a new primitive effect kind or Context attribute is a **code change**. No scripting in manifests (keeps the compiler, determinism, and saves sound).

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
- **Marking a task done:** when a task's work is completed/merged, **rename its file to append `_DONE` before the `.md` extension** (e.g. `005-clock-and-calendar-system_DONE.md`), update its link in `docs/tasks/README.md`, and fix any other references to the old filename (other task files, `CLAUDE.md`, source-comment links). This keeps the backlog's completion state visible at a glance. Always do this as part of finishing a task.

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
