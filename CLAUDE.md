# TownBox

TownBox is a 2D, top-down city builder prototype built on the **Phaser 4** game engine with a **React 18** powered GUI, written in **TypeScript** and bundled with **Parcel**. It is an on-and-off personal project being refactored from a collection of isolated experiments into an actual game with a real gameplay loop.

This document is the canonical, high-level description of the project for AI agents and human contributors. It describes what exists today (verified against the source), how the pieces fit together, and the working agreements ("codebase directives") that every contributor must follow.

---

## 1. Current state (what actually works today)

What began as a handful of disconnected experiments is now a **connected simulation**: the population, household, life-event, employment, and economy systems drive each other through a real per-tick/per-month loop (see §4.13; hourly ticks since task 040). Some pieces remain partial or unwired (called out below and in `docs/tasks/`) — e.g. business **product output** into the supply chain beyond materials, business **shrink-via-layoffs**, and the offline **history-asset pipeline** (task 055, renumbered from 038) that will reframe the new-game bootstrap — but the core "people live, work, earn, struggle, and move" loop runs end-to-end. The current major arc is **simulation enrichment** (architecture + discovery baseline in `docs/tasks/038-simulation-enrichment-architecture_DONE.md`, tasks 039–054): hourly ticks (24/day) and the live/bootstrap **execution boundary** landed with 040 (same engines and data in both modes; only materialization waits differ), object archetypes & per-person **Possessions** with 041, event **triggers** with 042, the data-driven **Action system** with 043, Action **Consequences** & object transformations with 044, authored **job shifts & work-action declarations** with 045, the per-person **Brain** with 046, the **Job Orchestrator** with 047, and the per-event revision (honest Poisson hazards, limits, gradients, the automated shift fallback) with 048 — completing the enrichment arc's framework, integration, and migration layers; and the content backfills completed it — objects (050: 1,517 archetypes), actions (051/053: 255 actions + full per-job work repertoires), events (052: a 698-event manifest generated from the 049 planning lists), and object-action relationships (053: 28 transformation entries — cooking/repair/consumption/production chains), documented by the 054 pass (`docs/simulation-flows.md` + the generated, checked-diff-gated `docs/simulation-relationships.md`; task 068 adds the generated `docs/event-classification.md` — every event's disposition: vital/wired/texture/reserved — regenerated with `npm run docs:events`). The arc is done through 054; 055 (the offline history asset) now captures the enriched sim.

- **Tile-based world.** A 384×384 grid of fine tiles (16×16 px each). You can paint **roads**, **soil/grass**, **houses**, and generic **work** buildings onto the grid with the mouse. Roads auto-tile based on their neighbors. Each structure occupies a **3×3 footprint** of tiles (the legacy single 48 px tile, now subdivided), centered on the hovered tile. **Roads snap to a fixed 3×3 supertile grid** (every 3rd tile) so they always connect correctly; **buildings keep finer placement but must sit flush against a road side** (they soft-snap to the nearest road side and can't overlap roads or other buildings — invalid spots preview in red).
- **Tall buildings.** Some building sprites are visually taller than their footprint (e.g. `1x1x2`). The sprite is bottom-anchored so it extends upward, but its footprint is a 3×3 block of tiles. A depth (z-order) system makes people and cars correctly render **in front of** a tall building when they are below it, and **behind** it when they are above it.
- **Population & households.** A new save generates a deterministic **population pool**: thousands of `GenPerson` records across generations (mostly deceased ancestors plus a living cohort) carrying parents, partnerships, and birth/death ticks. Placing a **house** draws a coherent **household** — a *living arrangement* (nuclear family, single occupant, adult siblings, multigenerational, a minor living with a guardian because the parents are deceased, or unrelated roommates) — from that pool and materializes its living members into `Person`s. Family trees span households because everyone shares one genealogy. Kinship and age are derived from the pool, not stored — and **age tracks the in-game clock** (people get older as time passes). The pool is also **simulated live**: each in-game year, age-based mortality and births advance the population, and residents who die are removed from their house and the map. On a **new game**, a **history bootstrap** (036) fast-forwards the detailed event engine over the living pool's recent past (in a Web Worker, behind a loading screen) so drawn people arrive with **real event histories** (had_sex/pregnancy/illness/…) instead of the empty-history cold start — the depth is a configurable perf knob (`json/bootstrap.json`).
- **Clock & calendar.** In-game time advances from the frame loop: **1 in-game day = 1 real hour**, on a regular 30-day-month / 12-month-year (360-day) calendar counting from **Year 1**. A `Clock` is the single source of time; the HUD shows a live date/time widget (with the weekday), `timeChanged`/`newTick`/`newDay` events fan out on the bus, jobs carry shift start/end times, and the clock state is saved. **The canonical simulation tick is the in-game hour** (task 040; 24 ticks/day, `TICKS_PER_YEAR` = 8640 = the genealogy `ticksPerYear`), so the pool, ages, event logs, and recency windows all live on one hour-tick axis. The week is 7 days (day 0 = Monday) with a first-class **weekend** (task 057: `isWeekendDay`/`isWeekendTick`, `Timestamp.dayOfWeek`, `Clock.getDayOfWeek()`/`isWeekend()`); weekends gate **school**, while jobs keep their own authored `daysOfWeek` off-days (056 decision).
- **School (task 058).** Children aged **7–17** attend school on weekdays. Schools are ordinary `school`-blueprint businesses; the student side is a **`SchoolAssignment`** (personId-keyed, serialized — save v9) managed by `SchoolRegistry`: a deterministic daily **sweep** enrolls unassigned children into the nearest school with a free seat (capacity = a `Curve` over business size, `json/schools.json`), releases the aged-out (invoking `graduated_school`), and re-enrolls students of closed schools (bankruptcy/bulldoze release them). A **`schoolObligationHook`** in the Brain proposes the continuous `attend_school` action (first real `obligation`-category action) at the assigned building while school is in session (08:00–14:00 mon–fri); it self-completes via `completeWhen` at the end hour, firing **`completed_school_day`** (`once: perDay`, plus an automated `afterEvent` fallback), which the **SkillProgression service** (task 063, running in the shared tick spine) converts into proficiency: every basic skill gains `schoolDailyGain` = 60 / the person's own eligible-weekday count between their 7th and 18th birthdays — perfect attendance lands **exactly 60.0 at 18**, missed days simply end lower, and school-sourced progression caps at 60. Children with no valid assignment or no seat follow normal free-time behavior (no silent auto-schooling). **Minors commute on foot** (no car; `Person.processTravel` walks them straight to the destination); adults keep the car commute. A schools validator cross-checks the schedule against `attend_school`'s `completeWhen` and the school-day events so data can't drift apart.
- **Businesses.** Placing a **work** building generates a **business** from a JSON **blueprint** (Engine A of the procedural framework, §4.13): a line of work drawn from ~18 blueprints across 9 demand categories (groceries, dining, healthcare, education, construction, retail, leisure, services, hospitality — supermarket, hospital, school, restaurant, bakery, café, pharmacy, clinic, clothing/electronics/hardware stores, bank, salon, auto repair, gym, cinema, hotel, …), a generated name, a drawn **size**, and a set of **job positions** whose counts scale with size via declarative **curves** (e.g. a supermarket's clerks scale faster and higher than its janitors). Jobs (~33) are a JSON reference table whose `requiredSkills` reference the **skill manifest** (059–062: 335 skills — 15 basic + 320 specific abilities with a dependency DAG) and whose **rank ladders** (task 064: per-rank proficiency requirements, progression declarations, and the explicit `entryTrainingGrant` — the *temporary College shortcut*) drive hiring: `JobMarket` matches the highest rank a candidate strictly meets, else the entry rank via its grant (applied atomically ONLY inside a successful hire — evaluation can farm nothing; a fresh 18-year-old with school basics at 60 can reach every job's entry rank, a CI-enforced reachability rule). The person's assignment records `rankId` + work-day counters (save v11); each completed work day (the per-day-limited `stopped_working` close) awards `100/3650 × multiplier` to the rank's declared `progresses` skills — once per day, never per child action — and every `evaluateEveryWorkDays` (default 30) days in rank a deterministic **promotion** evaluation advances qualified people up the ladder (rank flips, counters reset, the manual `got_promoted` event fires with a `promoted` feed signal). Every job carries a full authored ladder (task 066: 3–4 ranks — e.g. Trainee Doctor → Resident → Attending → Senior Physician) with ascending primary thresholds (10/25/50/70), half-rate 'extra' skills that unlock the next rung, and a **self-climbing rule** (CI-enforced): every rung's requirements are progressed by an earlier rank, school basics, or the entry grant — no ladder can silently stall. Flagship jobs (doctor, teacher) carry rank-specific work-action weighting consumed by the Job Orchestrator. All kept internally consistent by the data validators. Generation is deterministic per world seed + building location.
- **Life events.** A data-driven **event engine** (Engine B, §4.13) runs detailed life events (death, marriage, divorce, sex, pregnancy/birth, **illness/injury/recovery** via a `health` attribute, **education** that grants real skills, **retirement**, friendships/arguments, …) over **materialized** people each in-game **hour** (task 040). The manifest holds **698 events** (task 052): the ~18 vital/demographic events that carry real effects, plus ~680 effect-free **story-texture** events generated from the 049 planning lists (24 categories — milestones, achievements, mishaps, social moments, …) with category-tuned rates, age gates, cooldown/once-ever limits, and daytime factors; texture events emit no signals, so they enrich the person log without flooding the city feed. Each event carries a UI `label`/`category` (shown in the inspector log and feed). Events are flat JSON records with eligibility predicates, **triggers** (task 042: `probabilistic` rolls, `manual` invocation by other systems via `EventEngine.invoke`, `automated` schedule rules — afterEvent delays and atHour sweeps through a persisted queue) with optional **occurrence limits** (once ever/perDay, cooldown windows), and effects; a load-time compiler derives their dependency/exclusivity graph (NPM-style). Every commit lands in an **append-only per-person log** shared with the Action system (040/043: one globally monotonic `seq` across events AND actions), carrying a trigger source and a **causation id**, which the inspector renders directly. Deaths despawn residents and **re-house** orphaned minors with a living relative; births materialize a newborn into the mother's house. Materialized households also **re-form over time**: newlyweds **move in together** (023) and grown children **move out** into a vacant home to start their own household (024). The off-map genealogy pool keeps its coarse yearly demographic sim, excluding materialized people (whom the event engine now owns).
- **Placement tags (task 069).** Objects and buildings share a many-to-many **placement-tag** system — a third tag axis (separate from the activity `tags`): 1,494 archetypes carry `placement` tags + `generation` metadata (kind/weight/max/unique/ownership) sourced from the 049 planning lists; every business blueprint and the house carry context tags (`json/placement.json` is the 54-tag controlled vocabulary — 31 `building`-scoped, the rest `deferred` for the future venue model). Tags mean "this environmental context exists here" — rooms are never simulated. Closed-loop validated: no dead tags, no deferred tags on buildings, no building-scope tags on nothing. **Buildings are filled at placement (task 070)**: `game/ObjectGeneration.ts` runs once per building (deterministic per worldSeed + anchor + occupancy generation; save v12 marks it so loads never regenerate, with a one-time load sweep for older saves) — guaranteed essentials first (every kitchen gets its stove/oven/refrigerator via `minPerBuilding`), then weighted draws to the `json/objectGeneration.json` cap (40). Ownership resolves by host (business stock vs house fixtures; pocketable loose items are free-to-take `none`). Teardown is symmetric: bulldoze/bankruptcy clears the location's objects (carried ones survive) and orphans business-owned stock to `world`; a re-occupied lot (037) fills fresh. Live-mode object locations are now per-building — a resident's home resolves to their house's key for object queries (`WorldAdapter.objectLocationOf`), fixing the shared-'home' pool wart.
- **People.** `Person`s have a `SocialLife` (relationships, home, name, age, gender) and a `WorkLife` (a job + employer reference); their **skills** are proficiency-bearing records (0–100, with provenance) in the central `SkillBook` (tasks 059–062), keyed by pool `personId`. They carry **Possessions** (task 041): Object Instances of JSON-defined archetypes (`json/objects.json`) held in a central `Inventory` keyed by pool `personId` — ownership and physical containment are independent axes, containers nest (pencil-in-backpack), stackables merge, and the person inspector lists what everyone carries. People can walk on sidewalks, cross roads, and be marked as "indoors" (hidden) when inside a building.
- **Vehicles.** Test cars can be spawned on the street and will pick **random** building destinations and drive there, following proper lanes.
- **Pathfinding.** A shared A* pathfinder routes both people and cars over the road network. Roads expose **waypoints** — *curb* points (for pedestrians) and *lane* points (for vehicles) — so people walk sidewalks/crosswalks and cars stay in their lane.
- **Daily commute (006 → 046).** Employed residents commute home↔work around their shifts: the Brain's obligation hook starts the job's continuous work Action at the person's workplace, the Action's location requirement requests a transition through the execution boundary, and `LiveWorld` drives the car commute (`TravelStep`: exit-house → walk-to-car → drive → walk-to-building → enter), the handle resolving on arrival. `City.handleCommute` now only pumps pending transitions each in-game minute. Commute cars are flagged "controlled" so the placeholder random-destination wandering doesn't hijack them.
- **React HUD.** A windowing system (drag/resize via `react-rnd`) plus a wired **toolbar** (tool buttons emit `toolSelected`, synced with the F1–F6 keys, active tool highlighted), a persistent **clock** (click it to open the **city overview** dashboard) and **city event feed**, and inspector windows. The **Select tool** opens an inspector for whatever is clicked — a person, a workplace (business/positions/employees), or a house (family tree + clickable resident list). **Bulldozing** an occupied building tears it down coherently (evict residents / close the business) rather than stranding them.
- **Title screen.** A `TitleScene` splash with "Start Game" and "Load Game" buttons that transition to the main scene (Load Game restores the most recent save).
- **Save / load.** The entire game state (tiles/roads/buildings, the genealogy **population pool**, **households**, people & relationships, vehicles, city) can be saved and restored. Saves are an id-based JSON snapshot, deflated (`pako`) and base64-encoded, stored via a pluggable `SaveProvider` (`LocalStorageProvider` today). Triggered by the toolbar save button, `Ctrl+S`, or the title-screen Load option, with React toasts for feedback; a debug auto-load can boot a build straight into an embedded save.

- **Money (task 017).** A serializable `Economy` holds per-person and per-business **balances** with a single ledger primitive (`transfer`), seeded at household/business placement (`json/economy.json`) and saved. The event engine reads it as the `money` Context attribute and moves money via the `adjustMoney` effect (through a `MoneyLedger` adapter). A monthly economic tick (`City.processMonthlyEconomy`, gated by `Economy.lastEconomyMonth`) runs **wages** (018), **cost of living** (019: households accrue `arrears` when they can't pay), and **demand-driven business P&L** (020 + 033a): households generate per-category demand (`json/demand.json`), businesses **compete** for it by capacity (`staffing × throughputPerEmployee`), and `revenue = unitsSold × price`, minus materials/fixed/payroll, applied to the balance; a sustainedly-profitable, fully-staffed business **grows**, while a business whose balance stays below the debt floor for too many consecutive months goes **bankrupt and closes** (021: staff laid off → re-enter the job market, the building vacated/desaturated, debt written off); after a vacancy cooldown a dead lot **attracts a new (different) business** in whatever category now has unmet demand (037), so closures heal instead of accumulating. So an oversupplied category, an understaffed business, or thin margins lose money and ultimately fail. On the household side, a household in arrears too long is **evicted** (022): each member is first offered a place with a **solvent relative**, and anyone with no taker becomes **homeless** (kept materialized but hidden, in a registry) until recovered funds + a vacant home let them **move back in**. The blueprint roster + jobs/skills tables were broadly expanded (033b + 034) into ~18 businesses across 9 categories; seed numbers are a reasonable starting point, with finer balance tuning ongoing. Businesses also form a shallow **B2B supply chain** (035): the input materials a shop's sales consume become demand on local **producers** (farm → food, factory → building/hardware/electronics, warehouse → retail/office goods), who compete by capacity to supply that material demand and earn B2B revenue for it. Still missing: business **shrink-via-layoffs**.

What does **not** exist yet: business **shrink-via-layoffs**, and a Playwright **integration** suite (task 008; the unit suite + coverage-gated GitHub Actions CI already exist). (Bankruptcy→closure, household eviction→homelessness, and the B2B supply chain all exist now; the economy's bad-numbers cascade runs end-to-end.)

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
- `npm test` — runs Jest (fast unit suite).
- `npm run test:coverage` — Jest with the coverage threshold gate (`game/` + `util/`).
- `npm run validate-data` — runs the data-schema registry's validators against every `src/json/*` file (task 039; also part of `npm test` and asserted at game boot).
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm run docs:sim` — regenerates `docs/simulation-relationships.md` from the manifests (task 054; a checked-diff test in `npm test` fails when it's stale).
- **CI:** `.github/workflows/ci.yml` runs the type check, coverage-gated unit suite, and production build on every PR to `main` and push to `main` (meant to be required status checks).

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
      HistoryBootstrap.ts # New-game pre-sim: runs Engine B over the living pool's recent past (task 036)
      bootstrap.worker.ts # Web Worker running the history bootstrap off the main thread (+ bootstrapWorkerFactory.ts)
      HouseholdDraw.ts    # Draws a coherent living household from the pool (+ immigrant fallback)
      BusinessGen.ts      # Engine A: pure generateBusiness() — expands blueprint job curves by size
      EventCompiler.ts    # Engine B: compileEvents() -> dependency/exclusion/topo graph (NPM-like)
      EventEngine.ts      # Engine B: per-tick life-event runtime over materialized people (+ history)
      ActionEngine.ts     # The Action system (task 043): discrete/continuous lifecycle, pools & sequences
      Consequences.ts     # Bounded consequence DSL + OAR executor, two-phase atomic (task 044)
      Brain.ts            # Stateless decision layer: hooks -> intents -> ActionEngine (task 046)
      JobOrchestrator.ts  # Job-context action source: rotation + on-duty discrete pool (task 047)
      LifeLog.ts          # ONE append-only per-person log both engines share (global seq + causation)
      TickRunner.ts       # The shared 9-phase per-tick lifecycle both execution modes run (task 040)
      BootstrapWorld.ts   # Non-visual WorldAdapter: bootstrap-mode transitions resolve immediately (040)
      LiveWorld.ts        # Map-backed WorldAdapter: transitions drive the commute, resolve on arrival (040)
      JobMarket.ts        # Employment adapter: skill+distance hiring/firing for get_job/layoff events
      HousingMarket.ts    # Housing adapter: move-out eligibility (canMoveOut) for the move_out event
      SkillRegistry.ts    # Skill adapter: education events grant real proficiency (acquireSkill -> SkillBook)
      SkillBook.ts        # Central skill store (059-062): proficiency records, dependency gating, grants,
                          # atomic training closures, age-appropriate initialization
      SchoolRegistry.ts   # School assignments: persistent personId-keyed store + deterministic sweep (058)
      SchoolOrchestrator.ts # The school-obligation Brain hook: attend_school intents for enrolled children (058)
      SkillProgression.ts # Completed-day -> proficiency + promotion service (063 school days, 065 work days)
      Economy.ts          # Money balances (person + business) + the ledger primitive (transfer)
      Inventory.ts        # Object instances & Possessions: creation/stacking, containers, ownership (041)
      Clock.ts            # Single source of in-game time; advances from "update", derives the calendar
      SocialLife.ts       # Per-person relationships, home, identity
      WorkLife.ts         # Per-person job + skills
      City.ts             # Wires houseBuilt->household, workplaceBuilt->business, newTick->event sim + rehousing
      DebugTools.ts       # Optional debug overlays (curbs, lanes, tile depth)
      data/registry.ts    # Data-schema registry: registration model + validateRegistrations/assertValid (039)
      data/checks.ts      # Shape-check helpers shared by validators
      data/substrate.ts   # Structural validators for the Curve + Predicate manifest grammars
      data/validators/    # Per-family validators: events, economyContent, params, ui
      data/schemas.ts     # Canonical registration list + validateAllData()/assertValidData()
      save/migrations.ts         # Snapshot migrations (v7 day-ticks -> v8 hour-ticks + log synthesis)
      save/SaveProvider.ts       # Storage backend interface (base64 payload)
      save/LocalStorageProvider.ts # localStorage-backed SaveProvider
      save/SaveManager.ts        # Serialize/deserialize the whole world; deflate (pako) + base64 + provider
    hud/                  # React GUI
      Hud.tsx             # Window manager; HouseSelected windows, save/load toasts, Ctrl+S, hudReady
      BootstrapLoader.tsx # New-game loading overlay while the history bootstrap runs (task 036)
      Toolbar.tsx         # Toolbar: tool buttons emit toolSelected (synced with F1-F6), active-tool highlight
      Toasts.tsx          # Transient save/load toast notifications
      Clock.tsx           # Persistent date/time widget (reads the timeChanged event)
      Feed.tsx            # Persistent city event feed (reads the cityEvent event)
      Window.tsx          # Generic draggable/resizable window (react-rnd)
      d3/familyTree.ts    # D3 force-directed family tree renderer
      windows/CityDetails.tsx       # City overview dashboard (population/economy/businesses); opened via the clock
      windows/HouseDetails.tsx      # Household family tree + clickable resident list
      windows/PersonDetails.tsx     # Person inspector: identity, work, relationships, life-event log
      windows/WorkplaceDetails.tsx  # Business inspector: positions (filled/open) + employees
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
    objects.json          # 1,500+ object archetypes: dimensions/weight, flags, containers, activity tags,
                          # placement tags + generation metadata (041/050/069)
    placement.json        # The controlled placement-tag vocabulary (54 tags, building/deferred scopes) (069)
    residences.json       # Residential context-tag sets (the house's rooms-as-tags) (069)
    actions.json          # 259 actions (043/051/068): free-time/social/work repertoires + generic object verbs
    object-action-relationships.json # 28 multi-input object transformations per action (044/053)
    jobs.json             # Job reference table: title, salary, required skills, design-for strain/admiration
    materials.json        # Material reference table (stub; design-for prices)
    events.json           # Engine B life-event manifest: 705 events incl. parameterized generics (048/052/058/068)
    skills.json           # Skill manifest (059-061): 335 skills, basics + specific abilities, dependency DAG
    skillInit.json        # Initialization tunables (062): milestones ladder, adult baseline, assortment bands
    schools.json          # School day schedule, enrollment ages, capacity curve (task 058)
    economy.json          # Economy tunables (starting balances, cost of living, growth cadence)
    demand.json           # Demand model: per-category per-capita demand, throughput, unit price (task 033)
  types/                  # Shared TypeScript types (Assets, Cursor, Events, Grid, Movement, Position, Save,
                          # Social, Genealogy, Household, Time, Travel, Work, FamilyTree, HUD, Neighbor, Phaser,
                          # Simulation (Context), Business, LifeEvent, School)
  util/                   # Math.ts, tools.ts, base64.ts, random.ts, kinship.ts, compress.ts, familyGraph.ts,
                          # time.ts (calendar + weekday/weekend, 057), curve.ts (scaling/gradient curves),
                          # predicate.ts (eligibility AST), school.ts (schedule math + school-gain math, 058/063),
                          # skillGraph.ts (skill dependency DAG compiler, 059),
                          # simulationDocs.ts (054: generates docs/simulation-relationships.md)
test/
  personTravel.test.ts    # Person travel state-machine test
  tileFootprint.test.ts   # 3x3 footprint, depth, pathfinding, placement tests
  saveLoad.test.ts        # Save/load round-trip + base64 tests
  curve.test.ts / predicate.test.ts            # Substrate (curves + predicates)
  businessGen.test.ts / businessSetup.test.ts  # Engine A generation + placement wiring
  eventCompiler.test.ts / eventEngine.test.ts  # Engine B compiler + per-tick runtime
  eventLog.test.ts / executionBoundary.test.ts # Append-only log + the live/bootstrap boundary (040)
  saveMigrations.test.ts                       # v7 -> v8 tick scaling + log synthesis
  cityLifeEvents.test.ts / rehousing.test.ts   # Birth materialization + orphan re-housing
  dataValidation.test.ts                       # Data-schema registry: shipped files pass + invalid fixtures (039)
```

---

## 4. Architecture & key concepts

### 4.1 Boot sequence

1. `index.html` loads `main.tsx`.
2. `main.tsx` constructs a `GameManager`, which builds the Phaser `Game` with `TitleScene` and `MainScene`, plus a `Field` and `City` once the scene initializes.
3. When the scene emits `sceneInitialized`, `GameManager` creates the `Field` and `City`; on a **new game** it generates the population pool and then **awaits the history bootstrap** (036 — `runBootstrap`, off the main thread in `bootstrap.worker.ts`) before emitting `gameInitialized` (a load skips the bootstrap). 
4. `main.tsx` renders a `BootstrapLoader` overlay during the bootstrap and mounts the React `<HUD>` once `gameInitialized` fires.

### 4.2 Event bus

`GameManager` implements a small custom event system — **not** Phaser's emitter:

- `on(event, { callback, context })` — register a handler.
- `off(event)` — remove all handlers for an event.
- `emit(event, payload)` — async, fans out to all handlers (`Promise.all`).
- `emitSingle(event, payload)` — async, expects exactly **one** handler and returns its result (used when a caller needs a return value, e.g. spawning a person and getting the instance back).

All event names and payload types are declared in `types/Events.ts` (`EventPayloads`). Current events include: `sceneInitialized`, `gameInitialized`, `update`, `tileClicked`, `personSpawnRequest`, `vehicleSpawnRequest`, `houseBuilt`, `workplaceBuilt`, `tileSpawned`, `personSpawned`, `vehicleSpawned`, `roadBuilt`, `windowDragStart`, `windowDragStop`, `HouseSelected`, `hudReady`, `saveGameRequest`, `gameSaved`, `saveFailed`, `gameLoaded`, `loadFailed`, `timeChanged`, `newTick`, `newDay`.

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
- `updateDestination()` (on both Person and Vehicle) picks a **random** building from `Field.destinations` when idle — placeholder wandering that now applies **only to debug-spawned test entities** (task 016 retired it for residents, whose movement is owned by the simulation: households, births, and the daily commute). `Field.update` also skips it for **controlled** (commute) cars.

### 4.7 Travel state machine & commute (`Person`)

`types/Travel.ts` defines `TravelStep`: `Idle → ExitingBuilding → WalkingToCar → EnteringCar → Driving → ExitingCar → WalkingToDestination → Arrived`. `Person.processTravel()` advances the machine and is now driven end-to-end by the commute (task 006): `City.startCommute` spawns/assigns the car and calls `Person.setDestination(building)`; `Arrived` records the `currentBuilding` (home/workplace, for the scheduler) and despawns the car via `Field.removeVehicle`. `City.handleCommute` (on `timeChanged`) dispatches employed, idle residents against their job's `shiftStart`/`shiftEnd` and `WorkLife.getWorkplace()` (the employer reference set on hire by `JobMarket`, restored on load).

### 4.8 Households & social model

- **Population pool (source of truth).** `Population` (`game/Population.ts`) holds a serializable `PopulationState` (`types/Genealogy.ts`): a flat table of `GenPerson` records — identity, gender, `birthTick`/`deathTick`, parents, and partnerships — spanning many generations (mostly deceased ancestors plus a living cohort). It is generated deterministically at new-save time by the pure `generatePopulation(seed, params)` (seeded via `util/random.ts`; params in `json/population.json`) and serialized into the save. Kinship (siblings, grandparents, uncles/aunts, nieces/nephews, cousins) and age are **derived on demand** by pure functions in `util/kinship.ts`, never stored.
- **Households (living arrangements).** A `Household` (`types/Household.ts`) is a *living arrangement* distinct from bloodline. `HouseholdDraw.selectHousehold()` (`game/HouseholdDraw.ts`) draws a coherent living group from the pool by arrangement (nuclear, single, siblings, multigenerational, guardianship, roommates), only ever selecting living, unplaced people, respecting house capacity, never reusing anyone, and generating an immigrant family when the unplaced-living pool is exhausted. The draw is deterministic (a persisted RNG stream); params live in `json/householdDraw.json`.
- `City.setupHousehold()` runs on `houseBuilt`: it calls `Population.drawHousehold()`, **materializes** each drawn living person into a `Person` bound to the house (via `personSpawnRequest`), mirrors the pool's kinship onto the materialized residents (so the family-tree window renders), records the `Household` on the house, and adds the residents to the city population.
- **Time, aging & the live simulation.** Age derives from `birthTick` against the live `Clock` (`SocialLife.getAge()`), so people age as in-game time passes; the household draw uses `clock.getCurrentTick()` so composition matches the date. `City.handleNewDay()` runs each `newDay` for day-cadence upkeep — the **coarse** off-map pool sim (`Population.simulate()` → `simulatePopulation()`, age-based mortality + couple fertility, yearly, **excluding materialized people**) and the monthly economy gate — while `City.handleTick()` runs each `newTick` (hourly, through the shared `TickRunner`, task 040) driving the **event engine** (Engine B) over materialized people, whose `died`/`born` results drive reconciliation — a dead resident is removed from the field (`Field.removePerson`), their house, and the `Household.memberIds` (head reassigned), orphaned minors are **re-housed** with a living relative, and newborns are materialized into the mother's house. Event **signals** drive living-arrangement churn too: `partnershipFormed` triggers newlywed **cohabitation** (`City.resolveCohabitation`, 023) and `movedOut` an adult child's **move-out** into a vacant home (`City.resolveMoveOut`, 024) — all sharing one relocation helper (`relocateMember` / `removeFromHome` / `vacateIfEmpty`). The monthly economic tick also **evicts** households in arrears too long (`City.runEvictions`, 022): members are offered a solvent relative's home (`findRelativeHouse`), and any with no taker become **homeless** — kept materialized but hidden, in a `City.homelessHouseholds` registry that `runRecovery` drains back into a vacant house once their funds recover. Materialized people carry their pool `personId` (`SocialLife`) so events match back. Both sims are deterministic (each tick/year forks an RNG from the world seed). Coarse tunables in `json/lifeSimulation.json`; event definitions in `json/events.json`.
- `SocialLife` stores a `RelationshipMap` (some relationships single-valued, some arrays), the person's `home`, and identity, populated on the materialized residents. `WorkLife` stores the job + employer reference. **Skills** live in the central `SkillBook` (059–062): proficiency records (0 < p ≤ 100, provenance-tagged, dependency-gated against the manifest DAG) keyed by pool `personId`. People are **initialized once** on entering detailed simulation (`SkillBook.initialize`, seeded `worldSeed ^ personId`): newborns nothing; ages 1–6 a partial milestone ladder (`json/skillInit.json`, advanced live on birthdays by `City.runSkillMilestones`); ages 7–17 synthesized full-attendance school proficiency; adults every basic at 60 (the *educated baseline* — the band above 60 is career/talent territory: a working musician ~80 music, a famous one ~95) plus a deterministic assortment of specific abilities biased toward employable (job-core) skills. Education events grant proficiency **with prerequisites** through the `SkillRegistry` adapter (`acquireSkill` effect, optional `proficiency` floor).
- Relationship enums and maps live in `types/Social.ts`; genealogy/household types in `types/Genealogy.ts` / `types/Household.ts`; jobs/skills in `types/Work.ts`.

### 4.9 React HUD

- **Selection & windows (task 026/027).** The **Select tool is the universal inspector**: `MainScene` routes a Select click to `Field.selectAt(pixel)`, which hit-tests visible people first (`findPersonAt`) then the structure, emitting `PersonSelected` / `HouseSelected` / `WorkplaceSelected`. `Hud.tsx` (the window manager) opens the matching window: `HouseDetails` (the household family tree via `hud/d3/familyTree.ts`, derived from the genealogy pool in `util/familyGraph.ts` — spans households, deceased ancestors dimmed/†), and `PersonDetails` (`hud/windows/`), which shows identity/age/job/skills/relationships and the person's **life-event log** (read from `EventEngine.getHistory()`, dated via `util/time.ts` `formatDay`). and `WorkplaceDetails` (business name/line/size, a filled/open **positions** table via `util/positions.ts` `summarizePositions`, and the employee list). A persistent **city overview** dashboard (`CityDetails`, task 031) opens from the clock widget (`CitySelected` → `City.getCityStats()`), summarising population/households, employment, businesses/vacancies, the economy, and session vital tallies. House and city windows are singletons; person windows dedupe by identity (several may be open). Map hit-testing only finds **visible** (outdoor) people, but the `HouseDetails` resident list and `WorkplaceDetails` employee list are clickable (they `emit("PersonSelected", …)`), so **any** person — including indoor residents — is inspectable. `WorkplaceDetails` also shows the business's live **balance** and last month's **P&L** (economy, 017–020).
- **City event feed (task 029).** `hud/Feed.tsx` is a persistent, collapsible bottom-left panel that streams notable happenings (births/deaths/marriages/hires/layoffs/illness) as they occur. `City.handleNewDay` translates the day's deaths/births and Engine B signals into `cityEvent` bus events in one place (mapping via `util/notifications.ts`); entries are dated with `formatDay` and clicking one (when it has a subject) opens that person's inspector.
- `Window.tsx` wraps `react-rnd` and emits `windowDragStart`/`windowDragStop` so the Phaser cursor can be suppressed while interacting with UI.
- The simulation core (`game/`) must remain free of React imports. The HUD talks to the game **only through the `GameManager` event bus**, never by reaching into game internals directly.

### 4.10 Input (`json/input.json` + `MainScene`)

- `F1..F6` select tools (soil, road, house, work, select, bulldoze); `Esc` selects the Select tool.
- `G` toggles the grid overlay. `P` (spawn a wandering test person) / `V` (spawn a test car) are **debug-only**, gated behind `json/config.json` `debug.spawnKeys` (off by default) — in normal play all people/cars come from the simulation (households, newborns, commuters). See task 016.
- `W/A/S/D` pan the camera; `Q/E` zoom.
- `Ctrl+S` saves the game (handled in the React HUD, which suppresses the browser save dialog).

### 4.11 Save / load (`game/save/`)

- **Format:** an id-based normalized `WorldSnapshot` (`types/Save.ts`) — people/vehicles get stable ids, structures/houses are referenced by their anchor key — serialized to JSON, deflated with `pako` and base64-encoded (`util/compress.ts`; payloads without the compression marker fall back to legacy plain base64). A top-level `version` field (`SAVE_VERSION`, now `11`) drives migrations: `v2` added the genealogy `population` pool and replaced per-house `families` with `households`; `v3` added `clock` state; `v4` added the per-workplace `business`; `v5` added the per-person `eventHistory` table; `v6` added the `economy` (money balances); `v7` added `homelessHouseholds` (evicted households with no home, task 022); `v8` moved every persisted tick to the hour axis and added the append-only event log + object instances (tasks 040/041); `v9` added school assignments (task 058); `v10` moved skills into the central `skillBook` section (059–062) — pre-v10 people are re-initialized deterministically and their legacy boolean skills applied via the mapping in `save/legacySkills.ts`; `v11` added job ranks (064) — existing employees default to their job's entry rank. Older saves still load (empty pool/clock/business/history/balances/homeless/assignments). The id-based model lets the cyclic relationship/ownership graph survive a JSON round-trip.
- **Genealogy, clock, businesses & events:** the whole `population` pool (`PopulationState`), the `Household` records, the `clock` (elapsed ms), each work building's generated `business`, and the per-person `eventHistory` (a side-table keyed by pool `personId`) are serialized; ids are stable, so households, cross-household genealogy, the current date/time, businesses, and event history restore intact.
- **Provider abstraction:** `SaveProvider` (`save`/`load`/`list`/`delete` over the payload string) with `LocalStorageProvider` today; swapping providers is a single change in `SaveManager`'s constructor.
- **`SaveManager`** (`game/save/SaveManager.ts`) builds the snapshot from `Field`/`City`/`Population` and restores it. Only roads & buildings are serialized (soil is the implicit grass default); loads apply over a fresh field via `Field.loadStructure`/`loadPerson`/`loadVehicle`, which redraw through the normal `tileSpawned`/`personSpawned`/`vehicleSpawned` events but **never** emit `houseBuilt` (so loading doesn't redraw households). Restore is two-pass: create everything, then relink the graph (relationships, home, household, ownership). In-flight travel is reset to idle on load.
- **Flow & events:** the HUD triggers saves via the `saveGameRequest` event (toolbar button / `Ctrl+S`) and renders toasts from `gameSaved`/`gameLoaded`/`saveFailed`/`loadFailed`. The HUD emits `hudReady` once its listeners are registered; `GameManager` applies a queued load (title-screen load or `config.debug.autoLoad`) only then, so toasts are never missed. Auto-load (`json/config.json` → `debug.autoLoad.{enabled,save}`) skips the splash and boots straight into the embedded save.

### 4.12 Clock & calendar (`game/Clock.ts`, `util/time.ts`)

- **Scale & calendar:** **1 in-game day = 1 real hour** (`MS_PER_IN_GAME_DAY`). The calendar is a regular **30-day month / 12-month year = 360 days/year** (`DAYS_PER_YEAR`), counting from **Year 1**. Time math lives in pure functions in `util/time.ts` (`timestampFromElapsed`, `absoluteDayFromElapsed`, `formatTimestamp`), unit-tested without Phaser.
- **Single source of truth:** `Clock` (`game/Clock.ts`) accumulates elapsed real time (`advance` is the only mutator) and derives everything. `GameManager` owns it (`game.clock`), advances it from the `update` event, and emits `timeChanged` (once per in-game minute), `newTick` (once per in-game hour — the canonical simulation tick), and `newDay` (per day rollover), each carrying the current hour tick. Other systems read the clock; they don't re-derive time.
- **Genealogy contract:** `getCurrentTick()` is the absolute in-game **hour** index — the canonical **simulation/genealogy tick** (task 040) — and `getTicksPerYear()` equals `TICKS_PER_YEAR` (8640), which must match `json/population.json`'s `ticksPerYear` (enforced by the 039 validators). `SAVE_VERSION` 8 migrates older day-tick saves (`game/save/migrations.ts`). `SocialLife` holds a shared `Clock` (set by `GameManager`) so `getAge()` derives from `birthTick` live; `City`'s household draw and the family-tree window read `clock.getCurrentTick()`.
- **Weekdays & weekends (task 057):** the week is the 7-day cycle over absolute days (day 0 = Monday, negative-tick-safe for bootstrap history). `util/time.ts` exposes `dayOfWeekOfDay`/`dayOfWeekOfTick`, `WEEKEND_DAYS` (`[5, 6]` = sat/sun), `isWeekendDay`/`isWeekendTick`; `Timestamp` carries `dayOfWeek` and `Clock` exposes `getDayOfWeek()`/`isWeekend()`. Weekends gate **school** (058, via `util/school.ts` `isSchoolDay` — the composition point for future holidays/vacations); jobs are unaffected (they author their own `daysOfWeek`).
- **Jobs:** every job **authors** `shiftStart`/`shiftEnd` (minutes since midnight; `end < start` crosses midnight and belongs to its START day) and `daysOfWeek` (a 7-day cycle over absolute days, day 0 = Monday — deliberately unaligned with the 30-day month), plus its **work-action repertoire** (task 045; consumed by the Job Orchestrator, 047). `util/shifts.ts` is the one source of on-duty truth (`isOnShiftAt`/`isOnShiftAtTick`/`minutesUntilShiftStart`); the commute scheduler consumes it, so people genuinely have off days. The `newTick` signal drives the live simulation (§4.8, §4.13) and `newDay` the day-cadence upkeep.
- **School (task 058):** `json/schools.json` declares the school day (08:00–14:00 mon–fri), the 7–17 enrollment band, and a capacity `Curve` over school-business size. `SchoolRegistry` (persistent, personId-keyed, save v9) holds assignments; `City.runSchoolSweeps` (day cadence) enrolls/releases deterministically (nearest school with a free seat, JobMarket-style scoring) and invokes `started_school`/`graduated_school`; `City.schoolFactsOf` resolves a VALID assignment into `SchoolFacts` for the Brain's `schoolObligationHook`, which proposes `attend_school` (self-completing at the end hour → `completed_school_day`, `once: perDay` + automated fallback — task 063's progression seam). Minors commute on foot.

### 4.13 Procedural simulation framework (businesses + life events)

The data-driven framework that generates content and drives dynamic behaviour from JSON manifests. Design and rationale: `docs/tasks/013-procedural-simulation-framework_DONE.md`. **It is two engines over a shared substrate, not one recursive tree.** The enrichment-arc interlocks — how Actions, Events, Objects and the Brain drive each other — are documented in `docs/simulation-flows.md` (lifecycle flows) and the **generated** `docs/simulation-relationships.md` (task 054: derived from the manifests by `util/simulationDocs.ts`, gated by a checked-diff test, regenerated with `npm run docs:sim` — update it in the same PR whenever `actions.json`/`events.json`/`object-action-relationships.json` change).

- **Substrate (pure, scene-free).** `util/curve.ts` — declarative scalar `Curve`s (`const/linear/sqrt/log/logistic/step`) used both for Engine A size-scaling and Engine B probability gradients. `util/predicate.ts` — a JSON `Predicate` AST (`all/any/not`, attr comparisons, `hasEvent` with recency/count, `role/where`) evaluated against a `SimulationContext` (`types/Simulation.ts`: `getAttr`/`hasEvent`/`role`). Both are fully unit-tested with fixtures.
- **Engine A — business blueprints.** `json/businesses.json` declares lines of work; each job's position count is a `Curve` over the business **size**. `game/BusinessGen.ts` `generateBusiness(blueprint, jobs, name, size)` (pure) expands those curves into `JobPosition`s. `City.setupBusiness()` runs on `workplaceBuilt`, deterministically (seed = world seed ^ anchor key) picking a blueprint, drawing a size, naming it (faker), and assigning a `BusinessInstance` to the `Workplace`. `json/jobs.json` is the job/skill reference table; `json/materials.json` lists input materials (label + base price). A blueprint's `materialsPerUnit` are the inputs it buys per unit of output, and its `products` (task 035) are the materials it **produces** for other businesses — `City.runBusinessEconomics` resolves that B2B material demand (consumer sales × recipe) among producer blueprints (farm/factory/warehouse) by the same `resolveDemand`, keyed by material. Salaries/prices/P&L are fully simulated by the economy (017–022, 033, 035).
- **Engine B — life events.** `json/events.json` is a flat manifest of events: `roles` (the implicit `subject` plus co-participants bound by indexed relation `partnerOf:subject` or candidate `where` search), `triggers` (042/048: `probabilistic` — a per-year **rate** (Poisson-converted per tick, honest at any stride) with `Curve` factors; `manual` — invokable by Actions/Brain/systems through `EventEngine.invoke` with typed rejections and caller-pinned role bindings; `automated` — schedule rules materialized as a persisted queue: `afterEvent` delays chaining causation to the source commit, `atHour` daily sweeps), an optional occurrence `limit`, and a closed, typed `effects` vocabulary (`setDeath/marry/divorce/birth/setAttr/acquireSlot/releaseSlot/adjustMoney/acquireSkill/emit`), and an optional presentation `label`/`category` the compiler/runtime ignore. The Context attribute set (`alive/age/gender/marital/employed/canBeHired/canMoveOut/money/health/retired/…`) is closed too — a new attribute (e.g. `health`, `retired`) is a code change in `agentAttr` + the compiler's base list, while new events are pure data. `game/EventCompiler.ts` `compileEvents()` derives — NPM-style, from each event's own requirements + effects — a `dependsOn`/`excludes`/`topoOrder`/`indexKeys`/`subjectGates` graph plus validation warnings; **mutual exclusivity is derived, never authored** (e.g. death sets `alive=false`, so it excludes every event requiring `alive=true`). `game/EventEngine.ts` runs the per-tick resolver over **materialized people only**: per agent it walks a precompiled plan in topo order, rolls the per-tick hazard (per-year ÷ `ticksPerYear`), checks eligibility **after** a successful roll, resolves co-participant roles last (040 — this is what makes candidate searches affordable pool-wide), applies effects (mutating the pool + a per-person attribute overlay), commits to the append-only log (global `seq` + causation; signals chain to the committing entry), and queues signals. The **eligibility index** (the compiler's `subjectGates`, activated after 052 flagged it as the scale lever): each agent's five discriminants (`alive/gender/marital/employed/age`) are snapshotted once per tick (rebuilt after that agent's commits), each event's gates — the hard conjunctive discriminant comparisons of its subject predicate, necessary-never-sufficient — screen rolls before any expensive work, and the hazard is cached per tick for events whose factors derive from the tick alone (`hourOfDay`; the overwhelming majority). Because the walk consumes exactly **one RNG draw per probabilistic event per agent** regardless of plausibility, the index is **bit-identical** to an unindexed run (enforced by `test/eventEligibility.test.ts`, which also pins the tick budget: ~99ms → ~4ms per tick at 300 agents × the 698-event manifest — the headroom task 055's offline generator relies on). Deterministic per world seed + tick.
- **Employment (task 015).** Hiring is realized through the framework's resource-pivot pattern: the `get_job` event's `acquireSlot` and `layoff`'s `releaseSlot` perform real `Workplace.hire`/`layoff` via a `game/JobMarket` adapter passed inside the `ExecutionContext.markets` of `EventEngine.simulateTick` (built per-tick by `City.handleTick`). The engine stays scene-free — it consults the `JobMarket` interface (`types/LifeEvent.ts`) to derive `employed` (from a real `WorkLife.job`) and `canBeHired` (a reachable open, skill-matched slot exists), so `get_job` only rolls when a hire is possible and a failed acquisition aborts the event. The market scores candidates by skill fit minus home↔workplace distance (deterministic, no RNG). Skills come from `util/skills.ts` (task 014).
- **Actions (task 043).** `json/actions.json` declares what people *do*: `discrete` actions commit instantly ("Grabbed a pencil"); `continuous` actions materialize instances with a real lifecycle (`pending → waiting_for_materialization → running → completed/interrupted/blocked/failed`) — a required `location` requests a transition through the execution boundary, and *"Started working" fires when the Action starts, never when commuting begins*. Continuous actions orchestrate **children**: probabilistic `pool`s (per-tick chances, cooldowns, `maxTotal`, per-child requirements, same-tick interleaving — no identical child twice in a row unless it's the only one eligible) and ordered `sequence`s (one step per tick, `$parent.<param>`/`$previous.output` bindings, `blockParent`/`skipStep`/`failParent` policies). Actions and events share ONE requirement system — the predicate grammar v2 (`hasAction`, `carries`, `objectAtLocation`, with `archetypeParam` object queries resolving against the evaluating action's parameters, task 067) — and one `LifeLog`. Lifecycle transitions fire the declared manual Events via `EventEngine.invoke` (`triggerSource: 'action'`, causation = the lifecycle entry); a lifecycle link's object form maps a typed **event payload** from the action's params (`{ event, params: { object: '$params.object' } }`, task 067) — events declare a scalar `parameters` spec, invalid payloads are typed rejections, committed payloads land in the log entry and ride the event's signals into the feed builders (parameterized generic events like `object_acquired(object)` instead of one id per object; probabilistic commits carry no payload and the eligibility-index bit-identical invariant is untouched). Selection metadata (weights/modifiers/cooldowns) is validated now and consumed by Brain (046). `game/ActionEngine.ts` runs in `TickRunner` phases 1–2 in both execution modes. **Consequences (044)** make commits mutate the world through a bounded DSL (`game/Consequences.ts`: create/consume/move/transfer objects, hand an object to the action's `target` person with ownership untouched (`moveObjectToPerson` — lending/returning, wired on `lent_an_object`/`returned_borrowed_object`), set state, adjust money via the ledger, trigger/schedule events) plus `json/object-action-relationships.json` — multi-input transformations (consumed/retained/transformed/required dispositions, contextual requirements like oven-at-location, output ownership incl. `employer` for work products). Application is two-phase atomic (plan validates everything against pre-state; failures are typed with zero mutations), created instances carry the commit seq as `provenance`, and the bake-a-cake chain (`flour+eggs → dough → baked → +cream → one cake, identity preserved`) is the covered reference case. The 053 backfill fills the table (28 entries): home-cooking recipe alternatives (first satisfiable wins), lunch packing, meal consumption (consumables deplete then refuse typed), state-gated tool-mediated repair (broken keepsake + retained toolbox), cleaning-with-supplies, gift wrapping, and per-job **production recipes** whose employer-owned outputs land in the business inventory (bakery bread/cakes, workshop crates/planks, shipping parcels) — with supply-acquisition shopping actions making every chain reachable in normal play, and a reachability test guaranteeing no dead entries. Task 071 grounds activities in the generated environment (070): cooking requires a stove/oven at the location plus carried ingredients, showering a bathroom fixture, cleaning supplies, gardening garden context — with a **static reachability suite** (`test/contextReachability.test.ts`) proving every object requirement is satisfiable in some generatable building, a conjuring audit (every `createObject` is on the documented serendipity/purchase-fallback keep-list — purchases convert to real stock once the venue model lands), and a free-time variety guard (selection never collapses in a generated house).
- **Brain (task 046).** `game/Brain.ts` is the per-person decision layer — deliberately **stateless**: `status` (a small enum: idle/sleeping/commuting/working/performing_action/waiting_for_materialization) derives from the active action instance, anti-repetition from the action history, so nothing new serializes and the same Brain runs in both execution modes. **Hooks** (deterministic registration order; onTick + onEventCommitted implemented, other kinds registered for 047+) inspect context and return **intents** (`{actionId, params, locationOverride, sourceHook, priority, necessity, mayInterrupt, causationId}`); arbitration is necessity → priority → hook order → actionId, and execution only ever goes through the Action engine. Built-ins: the **Job Orchestrator hook** (047 — the job-context action source: on shift it *rotates* the job's continuous work repertoire by weight and starts it at the person's own workplace; on duty it rolls the job's **discrete work pool** per tick with cooldowns + same-tick interleaving, flavor chaining to the running work action; off shift it requests completion — employer-owned outputs land in the business inventory, `Inventory.instancesOwnedBy`, shown in the workplace inspector), **wokeUp** (sleep completes into the manual `woke_up` event → obligation or free-time), **inventoryOpportunity** (pocketables at the person's location), and the **idle fallback**. **Free-time selection**: hard-gate filter → weight × predicate-gated modifiers → deterministic weighted pick per (seed, tick, person) — variety comes from the data, never Brain code branches.
- **Cadence & ownership.** Engine B runs on `newTick` from `City.handleTick` (§4.8), through the shared `TickRunner` under the **execution boundary** (`types/Execution.ts`: `ExecutionContext` = mode + `WorldAdapter` + markets; live = `LiveWorld` with real commutes and arrival-resolved transitions, bootstrap = `BootstrapWorld` with immediate resolution — same lifecycle records, never `if bootstrap` branches); the coarse off-map pool sim (`Population.simulate`) **excludes materialized people**, so death/marriage/birth for on-map people are owned solely by Engine B. Marriage-over-time (task 010) and orphan re-housing (task 011) are realized as event effects/handlers, not separate systems. Likewise newlywed **cohabitation** (023) and adult **move-out** (024) are signal-driven `City` handlers; move-out is a `move_out` event gated by a `HousingMarket` adapter (`game/HousingMarket.ts`) exposing `canMoveOut` (an adult non-head with a vacant home available), mirroring `JobMarket`/`canBeHired`. Education events grant real proficiency through the `SkillRegistry` adapter (`game/SkillRegistry.ts`, the `acquireSkill` effect → `SkillBook.grantWithPrerequisites`), so a `nursing_school`/`trade_school` graduate gains the specific abilities (and their prerequisites) that make better jobs reachable (tasks 032/059).
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
- **Marking a task done:** when a task's work is completed/merged, **rename its file to append `_DONE` before the `.md` extension** (e.g. `005-clock-and-calendar-system_DONE.md`), update its link **and set its `Status` to `✅ Done`** in the `docs/tasks/README.md` table, and fix any other references to the old filename (other task files, `CLAUDE.md`, source-comment links). This keeps the backlog's completion state visible at a glance, both in the file tree and when reading the README. Always do this as part of finishing a task.

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
- **Every file-based data schema must register in the data-schema registry** (`game/data/schemas.ts`, task 039) — a structural validator, plus a semantic/cross-reference validator when the file references other files — **in the same PR that introduces or extends the schema**, with representative *invalid* fixtures in `test/dataValidation.test.ts`. Data loading fails loudly (boot assert + CI gate); never let invalid entries be silently skipped.
- Respect the existing **coordinate** (`tileToPixelPosition` / `pixelToTilePosition`) and **depth** conventions; any change to the tile or layering model must keep both internally consistent.
- Prefer extending the existing `Tile`/`Building` class hierarchy over parallel ad-hoc structures.

### 5.6 Scope & dependencies

- Make only the changes the task requires. Avoid opportunistic refactors, speculative abstractions, and unrelated "improvements" inside a task PR — propose them as follow-up tasks instead.
- Be conservative about adding dependencies. Prefer the libraries already in use; justify any new dependency in the PR.
- Do not commit secrets. Keep build artifacts (`dist/`, `bin/`) and `node_modules/` out of commits.

### 5.7 Documentation

- Keep this `CLAUDE.md` accurate. When a task changes architecture, data flow, or directives, update the relevant section in the **same PR**.
- Do not create extra markdown design docs unless the task asks for them; the task file plus `CLAUDE.md` are the sources of truth.
