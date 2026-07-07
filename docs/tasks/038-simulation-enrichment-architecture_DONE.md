# [Planning] Simulation enrichment & the execution boundary — architecture proposal + discovery baseline

- **Type:** Planning / Architecture (like [013](013-procedural-simulation-framework_DONE.md), this file *is* the deliverable)
- **Labels:** `planning`, `architecture`, `simulation`, `framework`
- **Depends on:** 013 (procedural framework), 036 (history bootstrap)
- **Feeds:** tasks **039–054** (the enrichment arc) and the renumbered **[055 — offline history-asset pipeline](055-history-asset-pipeline.md)**
- **Status note:** the discovery + proposal work described here was performed in the PR that introduced this backlog; the implementation lives in 039–054.

---

## 0. Why this exists

The decision to move the new-game bootstrap to **offline generation** ([055](055-history-asset-pipeline.md), formerly 038) removed the loading-time performance ceiling on simulation fidelity. The trade-off of that decision is that every game pulls from a **static pre-simulated pool** — so the pool had better be *rich*. This initiative makes the simulation dramatically richer (hourly ticks, objects & possessions, an Action system, a per-person Brain, job activity) **before** the offline pipeline is built, so the asset that pipeline produces captures all of it.

The non-negotiable architectural constraint: **live simulation and bootstrap simulation are the exact same system.** Same event engine, same action engine, same data definitions, same requirement queries, same logs, same consequence engine. The *only* difference is a formal **simulation execution boundary**: actions that need a person to be physically somewhere request a **location transition** through a world/materialization adapter. In `live` mode that request may hold the person in a commuting/waiting state until the visual layer confirms arrival; in `bootstrap` mode the same request resolves immediately through a non-visual world adapter and emits the same arrival/lifecycle records. Game logic must never branch on `if bootstrap`.

---

## 1. Discovery baseline (verified against source, 2026-07)

The claims below were treated as verification requirements, not assumptions. Each was checked against the code. **Where the pre-planning assumptions differ from reality, the difference is flagged with ⚠️.**

### 1.1 Engine unification — VERIFIED (unified, with a manifest filter)

- Live (`City.handleNewDay` → `EventEngine.simulateDay`, `City.ts:382`) and bootstrap (`HistoryBootstrap.bootstrapHistory` → `simulateDay`, `HistoryBootstrap.ts:68`) use the **same `EventEngine` class** and the **same `json/events.json`** manifest.
- Difference 1 — **manifest filter:** `bootstrapManifest()` (`HistoryBootstrap.ts:49–58`) drops every event with a non-subject role bound by a candidate `where` search (i.e. `marriage`), because O(agents) role search over the whole pool was too slow per-load. The boundary work must make this a *fidelity knob*, not a fork.
- Difference 2 — **adapters:** live passes `{ jobMarket, housing, skills, ledger }` (`City.ts:376–382`); bootstrap passes `{}` — so employment/housing/skill/money events silently never fire during bootstrap. This is exactly the scattered-capability asymmetry the execution boundary formalizes.
- `simulateDay(state, agentIds, tick, ticksPerYear, adapters = {}, daysPerStep = 1)` (`EventEngine.ts:383`). `daysPerStep` coarsens cadence with hazard-correct probability (`1 − (1 − annual)^(days/ticksPerYear)`, `EventEngine.ts:240`).

### 1.2 Tick cadence — VERIFIED (once per in-game day per person)

- `GameManager` emits `newDay` once per day rollover (`GameManager.ts:257–259`) and `timeChanged` once per in-game **minute** (`GameManager.ts:261–263`). There is **no hour-level tick anywhere**.
- `City.handleNewDay` (`City.ts:343–407`) order: index materialized people → coarse pool sim (`Population.simulate`) → monthly economy → `simulateDay` → death reconciliation → newborn materialization → orphan re-housing → drain signals (`partnershipFormed` → cohabitation, `movedOut` → move-out) → feed announcements.
- Determinism today: per-day RNG forked from world seed + tick (`EventEngine.ts:392`), agents processed in sorted id order (`EventEngine.ts:399`), events per agent in compiler topo order. Good foundation for the shared contract.
- ⚠️ **The per-person "event log" is not a log.** `EventHistory = Record<eventId, { count, lastTick }>` (`types/LifeEvent.ts:72`) — an *aggregate*, not an append-only sequence. There are no per-entry timestamps beyond `lastTick`, no sequence numbers, no role bindings, no causation. The inspector's "life-event log" is reconstructed from aggregates. **The shared-contract requirement (unambiguous timestamp + deterministic seq + causation chain per entry) requires replacing this with a real append-only log** (see §3.3). This is the single largest divergence from the pre-planning assumptions.

### 1.3 Materialization-dependent behavior — VERIFIED (partially materialization-coupled, never arrival-gated)

- ⚠️ **Nothing in the simulation waits for physical arrival today** — not even `get_job`. Hiring is instantaneous inside the event: `JobMarket.hire` scores candidates by `8·skillFit − 1·distance` (`JobMarket.ts:85–95`) where distance is a *scoring factor read from map positions*, not a travel requirement. The commute (`City.handleCommute` on `timeChanged`, `City.ts:1291–1315`; `Person.TravelStep` machine) is **fully separate from the event engine** — a visual afterthought keyed on shift windows. So the "going to a business to get a job" coupling assumed in planning does not exist as a *wait*; what exists is map-*position*-dependent scoring plus a disconnected visual commute. The boundary work therefore *introduces* waiting-for-arrival as a first-class simulation state (it has never existed), rather than refactoring an existing one.
- Engine → world signals: effects `emit` push `{ signal, personId, tick }` into `DayResult.signals`; `City` drains them by name. ⚠️ **No causation/source metadata exists** on signals or history.
- There is **no inventory/possessions/objects concept anywhere** in the codebase (only money balances, skills, job, home, relationships).

### 1.4 Jobs & shifts — VERIFIED

- `JobPosition = { title, salary, requirements, shiftStart, shiftEnd }` (minutes since midnight, `types/Work.ts:31–37`); defaults 09:00–17:00 (`types/Work.ts:28–29`). **No day-of-week, no cross-midnight handling, no "working" state** — shift boundaries only steer the visual commute.

### 1.5 Clock — VERIFIED

- `Clock.getCurrentTick()` = absolute **day** index; `MS_PER_IN_GAME_DAY = 3,600,000`; `ticksPerYear = DAYS_PER_YEAR = 360`, contractually mirrored in `json/population.json`. All genealogy ticks (`birthTick`/`deathTick`), history `lastTick`, and event recency (`withinDays`) are in **days**. Moving to hourly ticks touches this contract everywhere (see §4).

### 1.6 File-based schemas, loaders, validation, query syntax — INVENTORIED

See §2 below (full inventory). Headline findings:

- All data files are direct `import x from 'json/…'` — parsed by the bundler, typed by TypeScript casts, **no runtime structural validation**.
- Cross-file consistency is enforced only for **jobs ↔ skills ↔ businesses ↔ materials ↔ demand** — and only by one Jest test (`test/contentConsistency.test.ts`), not at load time. A violation fails CI, but a runtime with bad data proceeds silently.
- `compileEvents()` produces **warnings** (unknown event prerequisites, unknown state attributes, dependency cycles) that are non-fatal at load; `test/eventCompiler.test.ts:11` asserts zero warnings on the shipped manifest, making *those classes* of error CI-fatal. But a **typo'd effect kind is silently inert** (`applyEffect`'s switch exhausts and returns `true` — the event even records to history with no effect applied), and an `acquireSkill` naming a nonexistent skill silently no-ops. The compiler never validates effect kinds, skill ids, or signal names.
- The requirement/query syntax is the `Predicate` AST (`util/predicate.ts:9–47`): `all/any/not`, attribute comparisons (`== != < <= > >= in`), `hasEvent` (with `withinDays`/`minCount` — negated windowed `hasEvent` is today's only cooldown mechanism), `role`-scoped sub-predicates — a solid, reusable core that Actions will share (§7.2). But it is **not versioned**, the attribute vocabulary is open (`getAttr` accepts any string; `agentAttr` special-cases 13 attributes and falls through to the overlay) and duplicated in the compiler's `baseAttributes` list (`EventCompiler.ts:22`).
- Current content scale: **15 events**, **33 jobs**, **21 blueprints**, **13 materials**, **16 skills**, **12 demand categories**. ⚠️ `jobs.json` currently specifies **no shift times at all** — every job silently uses the 09:00–17:00 defaults from `types/Work.ts:28–29` (relevant to task 045's backfill).

---

## 2. Data-file inventory (loaders, validation, failure behavior)

| File | Consumed by | Type cast | Validation today | Invalid-data behavior |
|---|---|---|---|---|
| `events.json` (15 events) | `EventEngine.ts:26` (`DEFAULT_EVENT_MANIFEST`) | `EventManifest` (`types/LifeEvent.ts:68`) | `compileEvents()` warnings (unknown event prereq / unknown attr / cycles), made CI-fatal by `eventCompiler.test.ts:11` (zero-warnings assert) | Typo'd effect kind or unknown skill/signal: **silently inert at runtime**, uncaught anywhere |
| `businesses.json` (21 blueprints) | `City.ts:31` → `BusinessGen` | `BusinessBlueprintTable` (`types/Business.ts:42`) | `contentConsistency.test.ts:45–73`: jobs/category/materials refs exist, products consumed | Test-time only; runtime trusts the cast |
| `jobs.json` (33 jobs) | `City.ts:32` → `BusinessGen`/`Workplace` | `JobTable` (`types/Business.ts:23`) | `contentConsistency.test.ts:22–36`: skills valid + weighted | Test-time only. No shift times authored — all default 09:00–17:00 |
| `skills.json` (16 skills) | `util/skills.ts:4` | `SkillAssignmentParams` (`types/Work.ts:53`) | `contentConsistency.test.ts:39–43`: weight keys are valid enum values | Test-time only |
| `materials.json` (13) | `City.ts:34` (price lookup) | inline record | `contentConsistency` (referenced-and-consumed) | Test-time only |
| `demand.json` (12 categories) | `City.ts:35` economy tick | `DemandTable` (`types/Demand.ts:12`) | `contentConsistency` (every category served) | Test-time only |
| `economy.json` | `Economy.ts:4` | `EconomyParams` (`types/Economy.ts:15`) | none | Silent |
| `population.json`, `lifeSimulation.json`, `householdDraw.json` | `Population.ts`, `HouseholdDraw.ts`, `City.ts` | param shapes (`types/Genealogy.ts`, `types/Household.ts`) | none (`ticksPerYear` = 360 implicitly assumed in lock-step with the Clock) | Silent |
| `bootstrap.json` | `HistoryBootstrap.ts:7` | `BootstrapParams` | runtime gate (`enabled && years > 0 && tpy > 0`) | Silent skip |
| `assets.json`, `config.json`, `input.json`, `toolAssets.json` | scene/HUD | `AssetManifest` / untyped | none | Silent / Phaser load error |

**Conclusion:** validation is ad-hoc, test-only, and inconsistent. Task **039** builds the central schema registry (parser + structural validator + semantic/cross-reference validator + schema version per file), a CI gate that runs all validators, invalid-fixture tests, and loud dev-time load failure. Every new schema this initiative adds (`objects.json`, `actions.json`, `object-action-relationships.json`, extended `events.json`/`jobs.json`) registers on day one.

---

## 3. The shared simulation contract

### 3.1 One lifecycle, two modes

Every tick, in both modes, the simulation runs the same ordered phases:

1. **Advance** running continuous Actions.
2. **Resolve** sequence steps and pool child Actions due this tick.
3. **Resolve** scheduled/automated Event triggers due this tick.
4. **Evaluate** probabilistic Event eligibility (against phase-start state).
5. **Commit** occurred Events; append to the Person's Event log.
6. **Dispatch** committed-Event lifecycle notifications to Brain hooks and other systems.
7. **Resolve** Brain and job-orchestrator Action intents.
8. **Start / interrupt / complete / wait** Actions through the shared Action engine.
9. **Persist** logs, inventory/world changes, and deferred materialization requests.

The exact order may be refined during implementation (task 040) but must remain deterministic and identical across modes. State-visibility rule: requirements in a phase are evaluated against state as of that phase's start; commits become visible to later phases of the same tick; *within* a phase, agents are processed in sorted-id order and earlier agents' committed mutations are visible to later ones (this codifies today's engine behavior).

### 3.2 Determinism & ordering

- Per-tick RNG forked from world seed + tick (as today); every subsystem that rolls (events, brain selection, pool children, orchestrator) forks a named sub-stream so adding one system doesn't perturb another's rolls.
- A **global monotonic sequence number** is assigned to every committed record (Event log entries, Action log entries, transfers) in commit order within the tick. Same-tick records are therefore totally ordered and reproducible in both modes.
- Every record carries a **causation id** — the seq of the record/intent/trigger that produced it (an Action's "Started working" event points at the Action instance; a Brain intent points at the hook trigger; a probabilistic event's causation is the tick roll itself).

### 3.3 The log rework (prerequisite discovered in §1.2)

`EventHistory` aggregates are replaced by an **append-only per-person log**: `{ seq, tick, kind: 'event' | 'action', defId, roleBindings/params snapshot, triggerSource, causationId, outcome/lifecycle }`. The `{count, lastTick}` aggregate is retained as a **derived index** (it is what makes `hasEvent` O(1); rebuild it from the log on load). Save format bumps (`SAVE_VERSION` 8): migration synthesizes minimal log entries from old aggregates (count × `lastTick`-dated entries is lossy; migrate as one entry per event id carrying the old count — documented, acceptable). Task 040 owns the contract; 042/043 populate it.

### 3.4 The execution boundary (world/materialization adapter)

A single `ExecutionContext` is threaded through both engines:

```ts
type SimulationMode = 'live' | 'bootstrap';
interface ExecutionContext {
  mode: SimulationMode;                  // for logging/metrics ONLY — never for logic branches
  world: WorldAdapter;                   // location, presence, transitions, world objects
  markets: { jobMarket, housing, skills, ledger };  // today's adapters, folded in
}
interface WorldAdapter {
  locationOf(personId): LogicalLocation;
  requestTransition(personId, target: LogicalLocation, cause: CausationId): TransitionHandle;
  peopleAt(location): PersonId[];
  objectsAt(location): ObjectInstanceId[];
  // … queries grow as Actions/Brain need them; all read-only except requestTransition
}
```

- **Live:** `requestTransition` starts the commute machinery (task 006's `TravelStep`) and returns a pending handle; the Action that requested it enters `waiting_for_materialization`; the visual layer's arrival flips the handle, fires `onLocationArrived`, and the Action proceeds. The same lifecycle records are written.
- **Bootstrap:** the non-visual adapter resolves the handle **immediately** (same tick), updates the person's logical location, and emits the *same* arrival/lifecycle records.
- **Logical locations.** Both modes share a `LogicalLocation` model (`home`, `workplace(businessId)`, `venue(kind)`, `outside`, …). Live backs it with real map buildings; bootstrap backs it with an abstract world model. ⚠️ Scope note: for the bootstrap world to run *"all aspects of the live sim except waiting"*, it eventually needs logical businesses/venues (so people can hold jobs and visit places off-map). Task 040 defines the adapter contract and ships a minimal bootstrap world (homes + abstract venues); fleshing the offline world out to full economy parity is explicitly part of the reworked [055](055-history-asset-pipeline.md).
- The existing `bootstrapManifest()` event filter and the empty-adapters asymmetry (§1.1) are **retired**: both modes run the full manifest with a full `ExecutionContext`; any remaining fidelity knobs (e.g. bounded candidate search) become explicit config, not silent filters.

---

## 4. 24 ticks per day

The canonical simulation tick becomes the **in-game hour**.

- **Tick redefinition (decision):** `Clock.getCurrentTick()` returns the absolute *hour* index; `ticksPerYear = 8640` (24 × 360). We do **not** run a dual day-tick/hour-tick scheme — one tick unit everywhere, with `day = floor(tick / 24)` helpers in `util/time.ts`. Rationale: dual units is exactly the kind of scattered branching the boundary forbids.
- **Save migration (v8):** multiply every persisted tick (`birthTick`, `deathTick`, history ticks, `lastSimulatedYear` bookkeeping) by 24. `json/population.json` `ticksPerYear` updates in lock-step. Ages, kinship, recency all derive correctly afterwards.
- **Probability conversion:** authored probabilities are per-**year**; the engine already converts hazard-correctly per step (`1 − (1 − annual)^(steps/ticksPerYear)`). With `ticksPerYear = 8640` the same formula yields per-hour rolls that preserve yearly likelihood **automatically** — the `hourly = 1 − (1 − daily)^(1/24)` conversion is only needed for any config authored in per-day terms. ⚠️ Discovery: nothing is authored per-day today, so the bulk migration is mechanical; but **every event with `withinDays` recency windows, gradients over ticks, or `daysPerStep` interplay must be individually reviewed** (task 048), since `withinDays` counts are in ticks.
- **Occurrence limits & cooldowns:** the event schema gains declarative scopes — `once: 'ever' | 'perDay' | 'perJob' | 'perRelationship' | { withinTicks: n }` — enforced by the engine against the log index, so "Started working" isn't eligible every hour (task 042).
- **Cost note:** hourly evaluation is 24× the daily engine work. Mitigations: the eligibility pre-index (`indexKeys`) already skips most agents cheaply; sleeping people short-circuit most event classes; `daysPerStep` generalizes to `ticksPerStep` for the offline generator's draft runs. Perf is measured in 040 before content scales.

---

## 5. Objects & Possessions

New schema **`objects.json`** (registered in the 039 registry): object **archetypes**, not runtime objects.

- **Archetype:** `{ id, label, category, size { w,d,h in cm }, weightGrams, flags { carryable, pocketable, stackable, consumable, equippable, placeable }, defaultContainerBehavior, tags }`. Normalized units. Metadata is enriched even where unused yet.
- **Object Instance (runtime):** `{ instanceId, archetypeId, quantity (stackables), state/attributes, owner, container, createdAt tick + provenance (causation id of the creating action/event) }`. Serialized in the save (v8) and in the history asset.
- **Ownership vs. containment are separate axes.** Owner: person | business | building | world | none. Container: a person's `Possessions`, another object instance (backpack, bowl), a building/room, or the world. **Property vs. Possession:** Possessions = what a person actively carries (cellphone, gum, pencil, backpack). A car or house is *owned* but never in Possessions; furniture exists inside buildings but is not carried (gray areas deliberately deferred).
- **Container system from day one** (a pencil inside a backpack; dough inside a bowl), even if v1 UI exposes a flat list — prevents a second incompatible inventory model later.
- Task 041 implements the model; task 050 backfills 1,200+ archetypes from the planning lists (`docs/planning/`).

---

## 6. Event triggers & causation

Events gain a **`triggers`** property; the validator errors on an event with no trigger at all (task 039/042).

- **`probabilistic`** — the current model; existing probability/gradient config moves under it (per-tick evaluation, §4). Anything that is really global event config (label/category) stays top-level.
- **`manual`** — programmatically invokable through the Event engine by Actions, Brains, job systems, other code. "Manual" ≠ player-manual.
- **`automated`** — deterministic scheduled rules ("in 8 ticks", "at 08:00", "every Monday", "after delay"), represented as **scheduled work in the simulation timeline** (a persisted schedule queue drained in phase 3), never invisible direct mutations.
- An event may declare several trigger types (e.g. `stopped_working`: manual from the Work Action's completion + automated shift-end fallback).
- **Every invocation records `{ triggerSource, causationId }`** in the log, so the inspector can show *why* something happened (probability roll, Action, Brain hook, schedule, job system).

---

## 7. Actions

New schema **`actions.json`** + engine (`ActionEngine`), the biggest new subsystem. Actions are what people *do* (sleep, cook, commute, work, take a shower); Events are what *happened* (logged life facts). Actions can trigger Events (Work Action start → manual `started_working`); other code can too.

### 7.1 Types & lifecycle

- **`discrete`** — granular, log-worthy, instantaneous ("Cut onion", "Grabbed pencil"); consequences resolve on invocation.
- **`continuous`** — status-like, multi-tick ("Cooking", "Working out"), lifecycle: `pending → waiting_for_materialization → running → completed | interrupted | blocked | failed`. Ends by Brain interruption, obligation override, completion condition, or sequence end.
- Every Action log entry: instance id, definition id, person id, parameters snapshot, start/end ticks, outcome, parent instance id, causation id (§3.2/3.3).

### 7.2 Shared requirements

One requirement system for Events *and* Actions: the existing `Predicate` AST, extended (versioned, JSON-safe — task 043 inventories and extends rather than forking): past-Event *and* past-Action log queries with parameterized time ranges, Person location, the Brain `status`, attributes, possessions/objects-at-location checks, and (future) stat thresholds. Example: *pocket an object* requires an instance at the person's location whose archetype is `pocketable`.

### 7.3 Parameters

Typed, required/optional params (`food: recipe`, `target: Person`); the type system distinguishes **archetype refs from instance refs** ("cake" the recipe vs. "this raw dough in my Possessions"). Named bindings across the action graph: `$parent.food`, `$previous.output`, `$action.target` — validated by the registry (existence + type compatibility).

### 7.4 Consequences (bounded DSL, task 044)

Declarative, closed vocabulary — no scripting in JSON (the 013 flexibility line holds): add/remove/move/consume/transform/transfer instances; change object state; approved mutations on person/target/business/building/location; trigger manual Events; schedule automated Events; bind outputs to named variables; declare output ownership (person/employer/business/world/target). Applied atomically per action step — missing inputs block/fail the Action without partial application.

### 7.5 Children (continuous only)

- **`pool`** — weighted discrete children with base weight, per-tick chance, max occurrences/tick, cooldowns, per-child requirements, immediate-repeat rules. Same-tick occurrences are **interleaved** (default: no identical child twice consecutively within a tick unless it's the only eligible one) — that is the extent of sub-tick simulation.
- **`sequence`** — ordered steps with child→parent/step→step bindings (bake: mix → dough instance → bake → baked dough → add cream → cake). Parent completion may validate/transfer/expose the final child output but must **not duplicate** it.

### 7.6 `object-action-relationships.json` (task 044)

Multi-input transformations, not a 1:1 table: `{ actionId, inputs: [{ archetypeOrState, quantity, disposition: consumed|retained|transformed|required }], outputs: [{ archetype, quantity, state }], parameterBindings, outputOwnership/container, contextRequirements (e.g. oven at location) }`. Declarative and intentionally limited in v1.

---

## 8. Brain

New per-person component `Brain.ts` (sibling of `SocialLife`/`WorkLife`), task 046.

- **State:** `status` enum (`idle | sleeping | commuting | working | performing_action | waiting_for_materialization`) — never an arbitrary action name; the activity itself is `activeActionInstanceId`. Plus an intent queue and hook registrations.
- **Division of labor:** Brain *decides* (candidate selection + prioritization); the Action engine *executes* (requirements, consequences, advancement, logs). Jobs *propose* (via the Orchestrator, §9). No duplicated execution logic.
- **Decision model:** data-driven, not special-case branches. Action definitions carry base selection weight, selection **modifiers** (context multipliers over age, location, nearby people, possessions, recent history, relationships, time of day), cooldowns/anti-repetition, preferred contexts, and a broad behavior category (obligation/leisure/social/recovery). Requirements are hard gates; modifiers create variety. Selection = filter → score → deterministic weighted random (seeded per person+tick). Two `idle` people with different lives should diverge naturally; future personality stats slot in as more modifiers without core changes.
- **Hooks:** explicit, deterministic extension points — `onTick`, `onEventCommitted`, `onActionStarted/Completed/Interrupted`, `onLocationArrived`, `onShiftStarted/Ended`. A hook never mutates or writes logs; it returns **Action intents** `{ actionId, params, sourceHook, priority, mayInterrupt, necessity (optional|required|emergency), causationId }`. Conflicts resolve by priority, then stable hook order. First hooks: **Woke up** (obligation check → commute via the boundary → Work/School Action → else free-time selection), shift-start/end, arrival, action-completed, social-opportunity, inventory-opportunity, idle fallback.
- Free-time continuous Actions (wandering, visiting relatives, playing at a playground, spending time at home, …) and social Actions (talk/greet/give object/borrow/argue/teach/…) are pure data on this machinery — see the worked examples in the initiating brief and the planning lists under `docs/planning/`.

---

## 9. Jobs & the Job Orchestrator

- **Schema (task 045):** every job declares shift start/end, **days of week**, cross-midnight allowance; jobs link to workplace/business and physical location; jobs declare their **continuous and discrete work Actions** with parameterized frequency.
- **Job Orchestrator (task 047):** a context-specific *Action source*, counterpart to Brain but never a second state machine — Brain remains the single owner of a person's active Action. The Orchestrator knows who's on shift, publishes high-priority work intents to Brains, defines eligible work Actions + frequencies, randomly proposes discrete work Actions per tick (same pooling/interleaving/cooldown rules as child pools), waits on the Brain/Action engine, tracks workplace outputs & business inventory, and triggers job Events through the Event engine.
- **Output ownership replaces "confiscation":** factory output → business inventory (`employer`); a personal lunch on break → Possessions; a borrowed tool → business-owned, person-carried.

---

## 10. Skills (deferred)

Skills need a rework but are out of scope. Wiring here: Action requirements/modifiers *may reference* existing skills (`WorkLife`, `util/skills.ts`); education events keep granting skills via `SkillRegistry`; work Actions may later grant skill XP. A dedicated skills-rework task will follow this arc — documented, not designed, here.

---

## 11. Task breakdown & ordering

Framework before content: the schema registry, hourly lifecycle, materialization boundary, and Action lifecycle land **before** the large data backfills, so we never author 1,000+ records against unstable schemas.

| # | Task | Layer |
|---|------|-------|
| [039](039-data-schema-registry-and-validators_DONE.md) | Data-schema registry, validators, CI gate | Foundation |
| [040](040-hourly-ticks-and-execution-boundary_DONE.md) | Hourly ticks, shared tick lifecycle, execution context & world adapter, log rework | Foundation |
| [041](041-objects-and-possessions_DONE.md) | Object archetypes, instances, containers, Possessions | Core system |
| [042](042-event-triggers-and-causation.md) | Event `triggers` (manual/probabilistic/automated) + causation logging | Core system |
| [043](043-actions-core.md) | Action definitions, params, shared requirements, lifecycle, pools & sequences (no consequences) | Core system |
| [044](044-action-consequences-and-object-action-relationships.md) | Consequence DSL + `object-action-relationships.json` | Core system |
| [045](045-job-shifts-and-work-actions.md) | Job shift schedules + work-Action declarations | Integration |
| [046](046-brain-and-hooks.md) | Brain, intents, hooks, Woke-up / shift / arrival / idle behavior | Integration |
| [047](047-job-orchestrator.md) | Job Orchestrator | Integration |
| [048](048-events-revision-hourly-migration.md) | Revise & migrate every existing event (triggers, hourly probabilities, action links) | Migration |
| [049](049-content-planning-lists_DONE.md) | Pre-initiative content planning lists (`docs/planning/`) | Content prep |
| [050](050-objects-data-backfill.md) | 1,200+ object archetypes | Content |
| [051](051-actions-data-backfill.md) | Actions backfill (general + per-job) | Content |
| [052](052-events-data-backfill.md) | 500 probabilistic + 500 manual events | Content |
| [053](053-object-action-relationships-backfill.md) | Object-action transformation backfill | Content |
| [054](054-action-event-relationship-docs.md) | Action↔Event relationship documentation artifact | Docs |
| [055](055-history-asset-pipeline.md) | Offline history-asset pipeline (renumbered from 038; now consumes the full boundary-compliant sim) | Strategic |

Dependency spine: 039 → 040 → {041, 042} → 043 → 044 → {045, 046} → 047 → 048 → content (050–053, fed by 049) → 054 → 055.

---

## 12. Compatibility & risk register

- **Save version 8** in 040/041: tick ×24 migration, log rework, possessions/instances. One coordinated bump, not three.
- **Coarse off-map pool sim** (`Population.simulate`) keeps its yearly cadence (now `tick % 8640`); it is untouched by this arc and retired later by 055's one-fidelity path.
- **Economy monthly tick** unaffected except tick-unit math.
- **Perf watch-items:** hourly engine cost (§4), Brain candidate scoring over all materialized people per tick, orchestrator pools. Each lands with a measured budget before content backfill scales the data.
- **The commute seam** (`City.handleCommute` on `timeChanged`) is *absorbed*, not deleted: shift-driven commutes become Brain/Orchestrator intents that request transitions through the boundary; the `TravelStep` machine stays as the live adapter's implementation detail.
