# [Planning] File-based procedural simulation framework — blueprints + life events

- **Type:** Planning / Architecture proposal
- **Labels:** `planning`, `simulation`, `architecture`, `framework`, `no-code-required`

> Status: **approved (maintainer, 2026-06-28).** Implementation proceeds on a single branch
> (`task/procedural-simulation-framework`) covering all phases (§12) as one large, deliberate PR, per
> maintainer direction. The phased breakdown is the build order, not separate per-phase task files.

## Summary

Establish a **file-based, deterministic, procedural framework** that drives the simulation's
generated content and dynamic behaviour from JSON manifests, inspired by Orteil's *Nested* (probabilistic
composition) and Dwarf Fortress (emergent life events). The framework must settle **before** we build
businesses (007), the commute loop (006), marriage-over-time (010), and re-housing (011), because those
features otherwise calcify into ad-hoc, hard-to-extend code.

The deliverable is this written design plus a phased implementation breakdown. **No production code is
required for this task.**

The central decision (resolved with the maintainer, §1): this is **not one recursive Nested tree**. It is
a **shared declarative substrate** (a curve/predicate/context mini-language) consumed by **two engines** —
a *generative blueprint engine* (Engine A: businesses) and an *event-resolution engine* (Engine B: life
events) — with **jobs/skills/materials as flat reference tables** both engines read. Family/ancestry
*generation* stays bespoke (the existing `Population`); ongoing *life events* (death, marriage, births
over time) are subsumed into Engine B.

## 0. Verified current state (exploration pass)

Confirmed against the source on `main`:

- **Work model.** `types/Work.ts` defines `JobPosition` (`title`, `salary`, `requirements:
  JobRequirement[]`, `shiftStart`, `shiftEnd`) and a `JobRequirements` enum with **only**
  `ConstructionSkill`. `WorkLife` (`game/WorkLife.ts`) gives every person a single `ConstructionSkill`.
- **Workplace.** `Workplace.ts:36-46` hard-codes 10 identical `Constructor` jobs in its constructor;
  `hire()` matches a job whose `requirements` are all in the candidate's skills; `layoff()` returns it.
- **No `workplaceBuilt` event.** `Field.build()` emits `houseBuilt` only; `types/Events.ts`
  (`EventPayloads`) has no workplace/business signal. Work buildings get no business/jobs today.
- **Live sim.** `simulatePopulation()` / `simulateYear()` (`game/Population.ts:30-112`) runs **yearly**,
  with **hardcoded** Gompertz mortality (`annualMortality`) and fertility (married fertile couples).
  Driven by `City.handleNewDay` (`City.ts:122-158`) on the `newDay` event, which then reconciles deaths
  (removes a dead materialized resident from field/house/household). Tunables in `json/lifeSimulation.json`.
- **Determinism substrate.** `util/random.ts` `SeededRandom` (mulberry32) offers
  `next/nextInt/chance/pick/fork/getState/setState` and `hashStringToSeed`. Every existing generator is
  pure-of-(seed, params); RNG stream state is serialized (`PopulationState.drawSeed`).
- **Clock contract.** `Clock.getCurrentTick()` = absolute in-game day index = the genealogy tick;
  `getTicksPerYear()` = `DAYS_PER_YEAR` (360). 1 in-game day = 1 real hour.
- **Manifest convention.** Game data lives in `src/json/` (`assets`, `config`, `input`, `population`,
  `householdDraw`, `lifeSimulation`). Each manifest is imported directly and typed by a `*Params`
  interface in `types/` (e.g. `PopulationParams`, `SimulationParams`). `tsconfig`/`jest` path aliases
  (`json/*`, `util/*`, `types/*`, `game/*`).
- **Save.** `SAVE_VERSION` is `3`; the snapshot serializes structures, the genealogy pool, households,
  people/vehicles, clock. Deflate (`pako`) + base64. A `version` field drives migrations.

## 1. Maintainer decisions (settled in design dialogue)

These are in force for the rest of this document.

1. **Framework shape → two engines over a shared substrate** (not a single recursive Nested engine).
2. **Engine B subsumes life events** → death, marriage, and births-over-time become events; the
   *duplicated hardcoded* mortality/fertility logic is retired for materialized people; tasks 010
   (marriage) and 011 (re-housing) become event effects/handlers, not separate sim systems.
3. **Economy → design-for, build later.** Schemas carry economic fields (salaries, prices, balances,
   P&L) and effects are shaped for money flows, but the money/bankruptcy/eviction loop is a later phase.
4. **Detailed events run on materialized people only.** The unplaced/off-map pool is **out of scope** and
   will be replaced wholesale later (a future pre-game "fast-forward N centuries on a loading screen"
   pass that simulates everyone in detail). The only touch to the current coarse sim is one guard so
   materialized people are not killed twice (§9).
5. **Materialization boundary → accept the cold start.** A freshly materialized person has no event
   history; predicates that require past events simply don't fire until they occur. The long-term fix is
   decision 4's pre-game detailed pass.
6. **Conflict resolution → a capability/dependency system (NPM-like), not pairwise compatibility** (§5).
7. **Closed, typed vocabulary** for effects/attributes; unlimited *composition* of that vocabulary in
   files. Adding events/businesses/jobs/curves = data; adding a new *primitive* effect kind = code (§7).
8. **Probability authored per-year**, converted to a per-day hazard by the engine via the clock's
   `ticksPerYear` (§6).
9. **Cooldowns are not a separate concept** — expressed as `not hasEvent(X, withinDays: N)` over the
   stored history timestamp (§5).

## 2. Architecture — three layers

```
┌─ SUBSTRATE (the framework keystone) — pure, no Phaser/React, fully unit-testable ──────────────┐
│  • Curve      evaluate(curve, x) -> number     (scaling modes AND probability gradients)        │
│  • Predicate  evaluate(pred, ctx) -> boolean   (event eligibility AND conditional composition)   │
│  • Context    a flat attribute + history + roles view of an agent & world                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲                                    ▲                                  ▲
        │ consumes                           │ consumes                         │ reads
┌───────┴─────────────┐        ┌─────────────┴───────────────┐      ┌───────────┴──────────────┐
│ ENGINE A            │        │ ENGINE B                    │      │ REFERENCE TABLES         │
│ Generative          │        │ Event resolution            │      │ jobs.json                │
│ blueprints          │        │ (life events)               │      │ skills (strings)         │
│ businesses.json     │        │ events.json                 │      │ materials.json (stub)    │
│ → instance at       │        │ → state mutations + signals │      │ flat lookups both        │
│   placement / on    │        │   per day (materialized)    │      │ engines reference        │
│   size change       │        │                             │      │                          │
└─────────────────────┘        └─────────────────────────────┘      └──────────────────────────┘
```

The substrate is the load-bearing piece: get `Curve` + `Predicate` + `Context` right and both engines are
mostly declarative data on top — which is what makes "control the whole game from files" real.

## 3. The substrate

### 3.1 Curve — one type, used for scaling *and* probability gradients

```ts
// util/curve.ts (new) — pure
type Curve =
  | { mode: "const";    value: number }
  | { mode: "linear";   base: number; perUnit: number; min?: number; max?: number }
  | { mode: "sqrt";     base: number; coeff: number;  min?: number; max?: number }
  | { mode: "log";      base: number; coeff: number;  min?: number; max?: number }
  | { mode: "logistic"; floor: number; ceiling: number; midpoint: number; steepness: number }
  | { mode: "step";     points: { at: number; value: number }[] };

function evaluateCurve(curve: Curve, x: number): number; // clamp to [0,1] when used as a probability
```

`logistic` gives "scales fast early, hard ceiling" (supermarket clerks); `sqrt` gives "grows slowly, low
ceiling" (janitors); `step` gives banded gradients (pregnancy likelihood by age). The *same* type expresses
Engine A position counts/salaries and Engine B probability factors.

### 3.2 Predicate — a JSON AST over the Context

```ts
// util/predicate.ts (new) — pure
type Predicate =
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { attr: string; op: "=="|"!="|"<"|"<="|">"|">="|"in"; value: Value }
  | { hasEvent: string; role?: string; withinDays?: number; minCount?: number }
  | { role: string; where: Predicate };  // condition on a bound co-participant

function evaluatePredicate(pred: Predicate, ctx: Context): boolean;
```

### 3.3 Context — the contract both engines bind against

A **closed, declared** attribute schema (decision 7). A starter set (extended only by code):

- **Agent state:** `alive`, `age`, `gender`, `marital` (`single|partnered|married|widowed|divorced`),
  `pregnant`, `employed`, `jobTitle`, `salary`, `money`, `homeless`, `skills: string[]`.
- **World:** `year`, `dayOfYear`, `season`.
- **History accessor:** `hasEvent(id, {withinDays, minCount})` → reads the per-person history table (§5.3).
- **Roles accessor:** bound co-participants (`subject` is implicit; others bound per event, §5.4).

Manifests may only name attributes the Context exposes; this decouples files from engine internals.

## 4. Engine A — business blueprints

A blueprint describes *how to generate* a business of a given **size** (seeded). Every quantity is a Curve
over size, so one entry covers a corner shop and a hypermarket:

```jsonc
// json/businesses.json
"supermarket": {
  "friendlyName": "Super Market",
  "size":   { "min": 1, "max": 10, "weight": { "mode": "logistic", "floor": 0, "ceiling": 1, "midpoint": 3, "steepness": 0.5 } },
  "jobs": {
    "checkout_clerk": { "count": { "mode": "logistic", "floor": 1, "ceiling": 24, "midpoint": 5, "steepness": 0.6 } },
    "restocker":      { "count": { "mode": "linear",   "base": 1, "perUnit": 1.2, "max": 18 } },
    "janitor":        { "count": { "mode": "sqrt",     "base": 1, "coeff": 0.9,  "max": 4 } },
    "manager":        { "count": { "mode": "step", "points": [{ "at": 1, "value": 1 }, { "at": 6, "value": 2 }] } }
  },
  "materialsPerMonth": { "groceries_wholesale": { "qty": { "mode": "linear", "base": 50, "perUnit": 40 } } },
  "products":  {},                                   // deferred; slot reserved
  "economics": { "priceMarkup": 1.35, "fixedCostsPerMonth": { "mode": "linear", "base": 800, "perUnit": 600 } } // design-for
}
```

```ts
function generateBusiness(blueprint, size: number, rng: SeededRandom): BusinessInstance; // pure → testable
```

- **Size is a stored, mutable attribute** on the business (decision 3/§1): seeded at placement; when it
  changes (only once the economy lands) Engine A re-derives positions. Nothing mutates size yet.
- This replaces the hardcoded 10 `Constructor` jobs in `Workplace.ts`. Test: assert position counts at
  size 1 vs 10 expand per the curve.

## 5. Engine B — life events (the capability/dependency system)

### 5.1 Events reference *capabilities*, never each other

Like NPM packages, an event declares only **its own** `requires` and (inferred) `provides` against a named
capability space; it never names another event for compatibility. The capability space is the agent's
**state + history**:

- **`requires`**: a Predicate (positive: `alive`, `marital == single`, `hasEvent("had_sex", withinDays: 280)`;
  negative: `not pregnant`, `not hasEvent("death")`).
- **`provides`**: capabilities produced when the event fires — **inferred from its typed effects** plus the
  implicit `history[self]` write. `death` provides `alive=false`; `marriage` provides `marital=married` +
  `history[married]`; `had_sex` provides `history[had_sex]`.

`hasEvent(X)` is just a capability the `X` event provides — history flags and state mutations share one
namespace, one mechanism.

**Mutual exclusivity is derived, never authored.** No event says "death excludes marriage." Death provides
`alive=false`; marriage requires `alive=true`; therefore *death excludes marriage* is **computed** at load
(§5.2). Authoring stays O(E): each event describes only itself.

### 5.2 Load-time compiler → `EventGraph`

The manifest (dozens–low-hundreds of events) compiles **once at load** into runtime indices — the NPM
"build the tree + detect conflicts" step:

```ts
function compileEvents(manifest): EventGraph; // pure → unit-testable against fixtures

interface EventGraph {
  providers: Map<Capability, { producedBy: EventId[]; negatedBy: EventId[] }>;
  dependsOn: Map<EventId, EventId[]>;   // B depends on A if A provides a cap B positively requires
  excludes:  Map<EventId, Set<EventId>>;// DERIVED: A excludes B if A provides state falsifying B.requires
  topoOrder: EventId[];                  // topological over positive deps (same-day chains resolve in order)
  indexKeys: Map<EventId, Discriminant[]>;// cheap buckets: alive/ageBand/gender/marital/employed
}
```

Validation (NPM-style): an event requiring a capability nothing provides and no initial state supplies →
"unmet requirement" surfaced **at load, not runtime**; positive-dependency cycles → flagged. Build is
`O(E²)` over a small static E → negligible.

### 5.3 Per-person event history (the space-for-time trade)

A compact per-person record, stored in a **side-table keyed by `personId`** (keeps `GenPerson` pure;
survives de/re-materialization; serialized in the snapshot):

```ts
type EventHistory = Record<EventId, { count: number; lastTick: number }>;
// hasEvent(id, withinDays?, minCount?) is O(1)
```

### 5.4 Roles (multi-agent events) resolve through indices, never global scans

The single most important Big-O discipline. `subject` is implicit (the person being ticked); other roles
bind through an **indexed relation**, not an all-pairs search:

- `bind: "partnerOf:subject"` → O(1) partnership edge.
- `bind: "coResidentOf:subject"` → household membership.
- `where: { ... }` candidate searches must be backed by the eligibility index or a spatial bucket
  (e.g. a `victim` role for "run someone over" → nearby tile bucket), never the whole population.

### 5.5 Probability authoring (per-year → per-day)

```jsonc
"probability": {
  "perYear": 0.9,                                  // intuitive annual rate (or a Curve over a driver)
  "factors": [ { "driver": "subject.age", "curve": { "mode": "step", "points": [ ... ] } },
               { "driver": "subject.money", "curve": { "mode": "logistic", "floor": 0.2, "ceiling": 1, ... } } ]
}
```

Engine converts to a per-day probability using the clock's `ticksPerYear`:
`pDay = 1 - (1 - pAnnualEffective)^(1 / ticksPerYear)`, where `pAnnualEffective = clamp01(perYear × Π factor_i)`.

### 5.6 Worked example — pregnancy

```jsonc
// json/events.json
"pregnancy": {
  "roles": {
    "subject": { "where": { "all": [ { "attr": "gender", "op": "==", "value": "female" },
                                     { "attr": "alive",  "op": "==", "value": true },
                                     { "attr": "age", "op": ">=", "value": 16 },
                                     { "hasEvent": "had_sex", "withinDays": 280 },
                                     { "not": { "hasEvent": "pregnancy", "withinDays": 300 } } ] } },
    "father":  { "bind": "partnerOf:subject" }
  },
  "probability": { "perYear": 0.6,
                   "factors": [ { "driver": "subject.age", "curve": { "mode": "step", "points": [
                       { "at": 16, "value": 0.4 }, { "at": 24, "value": 1.0 },
                       { "at": 35, "value": 0.5 }, { "at": 45, "value": 0.05 } ] } } ] },
  "effects": [ { "type": "birth", "mother": "subject", "father": "father" },
               { "type": "emit", "signal": "rehousingMaybe", "target": "subject" } ]
}
```

Cooldown is the `not hasEvent("pregnancy", withinDays: 300)` requirement (decision 9). `requires "alive"`
makes death's `alive=false` automatically exclude pregnancy.

### 5.7 Runtime — per (materialized person, day)

1. **Eligibility index** (bucketed by cheap discriminants) → a *small* candidate list, not all events.
2. Walk candidates in **topological order**; apply effects incrementally so a same-day provider is visible
   to its dependents and a fired event's `excludes` set drops out automatically on re-check (its
   requirements now fail — no special-casing). **Two mutually-exclusive events can never both fire in a
   day, by construction.**
3. Each surviving candidate rolls `pDay`; on success apply effects → mutate state, write history, enqueue
   signals.

Runtime cost ≈ `O(M × avg-eligible-events)` where **M = materialized population** (placed households —
hundreds to low-thousands even in a big city), *not* the ~15k pool.

### 5.8 Effects — a closed, typed vocabulary (enables inference + determinism)

Each effect declares which capabilities it touches, so `provides` is inferred (decision 1/§5.1). Starter set
(extended only by code):

`setDeath` · `marry(role)` · `divorce` · `birth(mother, father)` · `setAttr(attr, value|Curve)` ·
`acquireSlot(resource)` · `releaseSlot(resource)` · `adjustMoney(target, Curve)` *(design-for)* ·
`emit(signal, target, payload)`. History writes are implicit. `emit` hands off to materialized-world
reconciliation (the generalized successor to today's death reconciliation in `City.handleNewDay`).

### 5.9 Resources tie Engine A to Engine B

Capabilities include **finite resources**, which is how capacity exclusivity and the A↔B seam fall out for
free: Engine A mints slots (a supermarket emits *N* `checkout_clerk` positions); Engine B events trade them
(`get_hired` *requires* an open matching slot in range and *provides* `employed`, consuming one slot;
`layoff` releases it). Two people can't take the same last slot in one day because acquisition mutates the
shared pivot before the second is re-checked. Hiring/firing (007/006) become events over a shared resource —
no pairwise rules, same resolver.

## 6. Reference tables

- **`json/jobs.json`** — each job: `title`, base `salary` (number or Curve), required `skills: string[]`,
  and design-for attributes consumed by event gradients (`physicalStrain`, `mentalStrain`,
  `socialAdmiration`, …). Skills stay strings (decision in dialogue); expand the `JobRequirements` enum
  (`types/Work.ts`) to cover seeded jobs and let `WorkLife` carry a varied skill set.
- **`json/materials.json`** — stub now (names + design-for prices); consumed once the economy lands.

## 7. Flexibility model (the file/code line)

To keep the resolver analyzable, deterministic, and save-safe, the primitives are a **closed typed
vocabulary** (effect kinds, attribute schema, curve/predicate ASTs). Then:

- **Pure data (files):** new events, businesses, jobs, curves, gradients, requirements — the 95% case.
- **Code change:** a new *primitive* effect kind or Context attribute — rare.

Arbitrary scripting in manifests is explicitly rejected: it would break the load-time resolver,
determinism, and save reproducibility.

## 8. Determinism & cadence

| When | What runs | Over whom | Notes |
|---|---|---|---|
| New save | ancestry generation (**bespoke, unchanged**) | — | `generatePopulation` |
| Load | `compileEvents()` → `EventGraph` | — | pure, cached |
| `houseBuilt` | household draw (**bespoke**) + materialize | one household | existing `City.setupHousehold` |
| `workplaceBuilt` (**new**) / size change | Engine A instantiation | one business | replaces hardcoded jobs |
| `newDay` | **Engine B** full resolver | **materialized people only** | hot loop, indexed |
| year rollover | coarse demographic sim (**ignored / to be replaced**) | unplaced pool only (§9) | untouched |

Per-engine RNG streams follow the existing `SeededRandom` `getState/setState` pattern (cf.
`PopulationState.drawSeed`) so the whole framework is reproducible per save.

## 9. Integration touchpoints

- **`types/Events.ts`:** add `workplaceBuilt`, plus effect-handoff signals (`rehousingNeeded`,
  `partnershipFormed`, `personDied`, …) declared before wiring (CLAUDE.md §4.2).
- **Coarse sim guard (the only touch):** exclude `PopulationState.placedIds` from yearly death in
  `simulatePopulation` so materialized people die only via Engine B (decision 4). Obsoleted when the coarse
  pool is replaced.
- **`City`:** `handleNewDay` grows from "reconcile deaths" into "run Engine B over materialized people,
  then drain the effect/signal queue" (death despawn, rehousing, marriage merge). `setupHousehold` is
  unchanged; a sibling `setupBusiness` handles `workplaceBuilt`.
- **`Workplace.ts`:** hardcoded jobs replaced by a generated `BusinessInstance` (name + line of work +
  open/filled positions as resource slots).
- **Save:** bump `SAVE_VERSION` to `4`; serialize business instances (blueprint key + size + slot state),
  the per-person `EventHistory` table, and design-for money balances. Migration: a v3 save loads with empty
  history and re-derivable businesses.

## 10. Relationship to existing backlog tasks

- **007 (business generation)** → becomes Engine A + reference tables + `workplaceBuilt` wiring (phases
  013b). Largely **superseded/absorbed**; keep as a stub pointing here.
- **006 (commute loop)** → consumes employment that Engine A/B assign; unchanged in scope, unblocked by
  this.
- **010 (marriage over time)** → becomes a `marriage` event + handler (phase 013e). **Absorbed.**
- **011 (re-housing)** → becomes a `rehousing` effect/signal handler (phase 013e). **Absorbed.**

(Updating/retiring 006/007/010/011 text is a follow-up once this proposal is approved — not done here.)

## 11. Testability

Everything load-bearing is pure and scene-free:

- `util/curve.ts`, `util/predicate.ts` — fixture inputs → exact outputs.
- `generateBusiness()` — position counts expand by curve at sizes 1..N; deterministic by seed.
- `compileEvents()` — providers/dependsOn/**excludes**/topoOrder from fixture manifests; unmet-requirement
  and cycle detection; the death-excludes-pregnancy derivation asserted directly.
- Event runtime — eligibility indexing; topo-order same-day chain (had_sex → pregnancy); exclusivity (a
  person selected for death never also marries that day); resource contention (one slot, two candidates,
  one hire); reproducibility by seed.

## 12. Proposed phased implementation breakdown (candidate follow-up tickets)

Each independently mergeable and unit-tested. *Not created until this proposal is approved (CLAUDE.md §5.4).*

- **013a — Substrate.** `util/curve.ts`, `util/predicate.ts`, the `Context` contract type
  (`types/Simulation.ts`). Pure, fully unit-tested. No gameplay change.
- **013b — Reference tables + Engine A.** `json/jobs.json`, `json/businesses.json`,
  `json/materials.json` (stub); expand skills/`WorkLife`; `generateBusiness()`; `workplaceBuilt` event +
  `City.setupBusiness`; replace `Workplace` hardcoded jobs; business size as stored mutable attr; serialize
  businesses (save bump). Mints the open job slots only — **no hiring here**; hiring/layoff are events in
  013d (decision §13.4). (Reshapes task 007.)
- **013c — Event compiler.** `json/events.json` schema + `compileEvents()` → `EventGraph` + validation.
  Pure, unit-tested against fixtures. No runtime wiring yet.
- **013d — Event runtime.** Per-day resolver over materialized people: eligibility indices, topo-order
  resolution, per-year→per-day probability, typed effects, signal queue; per-person `EventHistory`
  side-table + serialization. Wire into `newDay`/`City`. Subsume **death** for materialized people + the
  `placedIds` coarse-sim guard. Hiring/layoff as resource-trading events.
- **013e — Migrate marriage & births; rehousing handler.** `marriage`, `pregnancy`/`birth` events;
  re-housing effect/signal handler. Absorbs tasks 010 and 011.
- **013f — Economy (later).** Activate design-for fields: money balances, business P&L, prices,
  bankruptcy → eviction effects. Out of scope to build now; fields reserved throughout.

## 13. Resolved decisions (maintainer)

These were the remaining open questions; all resolved with the maintainer and now in force.

1. **Initial-state capability sourcing → enumerate base Context attributes as implicit providers.** The
   compiler seeds its provider set with the base agent state (`alive`, `gender`, `age`, `marital`, …) so a
   `requires` satisfied by initial state is never flagged as an "unmet requirement"; only capabilities that
   no event *and* no initial state can supply are flagged.
2. **Birth → materialize the newborn immediately.** When a materialized household has a baby, the `birth`
   effect both appends a `GenPerson` to the pool **and** drives a `personSpawnRequest` so the newborn is
   on-map at once, keeping the household coherent (no lazy materialization).
3. **Tick grain → `newDay` only.** Engine B's resolver runs once per in-game day on `newDay`, not on the
   per-minute `timeChanged`. Adequate for the event grain modelled.
4. **Hiring → modelled as an event from the start.** No throwaway placement-time hiring pass; hiring/layoff
   are resource-trading events (§5.9) from 013d. 013b only *mints* the job slots on `workplaceBuilt`; the
   events fill them.

## 14. Acceptance criteria

- Proposal reviewed and approved by the maintainer before any implementation task is opened.
- The design demonstrably supports: the supermarket scaling example (clerks vs. janitors via distinct
  curves/ceilings), the pregnancy event with role binding + age gradient + history prerequisite + cooldown,
  derived death-excludes-pregnancy exclusivity, and the resource-slot hiring contention case.
- The framework is deterministic/seedable and the substrate + compiler are pure (scene-free) and testable.
</content>
</invoke>
