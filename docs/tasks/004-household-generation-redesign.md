# [Planning] Redesign family generation → household + cross-household genealogy

- **Type:** Planning / Architecture proposal
- **Labels:** `planning`, `simulation`, `architecture`, `no-code-required`

## Summary

This is a **planning/proposal task** (not an implementation task). Produce a concrete architectural
proposal to **replace the current family-tree generation system with a household generation system**
that supports **family trees spanning multiple households** while keeping each household's
composition **coherent with the people's simulated histories**.

The desired feel is **hard simulation, à la Dwarf Fortress — not procedural hand-waving**. People
should have real histories, and their placement into households should follow from those histories.
For example: looking into a house, you find a child living with their adult brother — and checking
their parents reveals the parents are deceased. (Implementing **death** is part of enabling this
example; the proposed architecture must allow it.)

The deliverable is a written proposal (added to this task file or a linked design doc) plus, if
useful, a follow-up implementation task breakdown. **No production code is required for this task.**

## Background / current state (must be verified during exploration)

- **Trigger:** `City.setupHousehold()` runs on the `houseBuilt` event, creates a `Family(house)`,
  and calls `family.autoGenerate(Game)`.
- **`Family.ts`** generates members with a recursive, **credit-based** algorithm:
  `autoGenerate()` picks a random member count, creates a first adult, then
  `generateBaseRelationships()` → `generateSpouse()` / `generateChildren()` recurse, followed by
  `assignExtendedRelationships()` which derives siblings, grandparents, uncles/aunts, and
  nieces/nephews. It is conditional-heavy and hard to test.
- **`SocialLife.ts`** stores a `RelationshipMap` (`types/Social.ts`) with single-valued
  (father/mother/spouse) and array-valued (children/siblings/etc.) relationships, plus the person's
  `home` (`House`) and identity (name/age/gender). Names come from `@faker-js/faker` (`fakerPT_BR`).
- **Limitations to address:** the current system is complex and conditional-heavy, hard to test,
  and still **cannot represent simple real-life arrangements** like roommates, or a child living
  with an aunt because the parents died. Relationships are confined **within a single household**;
  there is no genealogy that crosses households (e.g. an elderly couple whose grown child now heads
  their own separate household with their own spouse and children).
- There is currently **no concept of time/age progression or death**.

## Goals (of the proposal)

The proposal must address, at minimum:

1. **Two-fold architecture (or a justified alternative).** Evaluate the maintainer's suggested
   approach: at **new-save creation**, generate a large pool of **thousands of intertwined family
   trees / a population genealogy**; then during gameplay, **draw from that pool** to populate
   individual households as houses are placed, preserving cross-household coherence. Propose this or
   a better-justified alternative, with trade-offs (memory, save size, determinism, performance).
2. **Cross-household family trees.** A single genealogical tree must be able to span multiple
   households; placing a house pulls a coherent slice of the existing population rather than
   inventing an isolated island.
3. **Households ≠ families.** Model a household as a *living arrangement* (who lives together and
   why) distinct from blood/marriage relations. Must naturally represent: nuclear families,
   roommates, a child living with an adult sibling or an aunt, single occupants, multi-generational
   homes, etc.
4. **History-driven coherence.** Each person should carry enough simulated history (birth, parents,
   key life events, death) that their household placement is explainable by that history.
5. **Death (enabling).** Specify how death is represented so scenarios like "lives with sibling
   because parents are deceased" are expressible. (Death mechanics/aging-over-time can be a separate
   implementation task, but the data model must support it.)
6. **Testability.** The new design must be substantially more unit-testable than the current
   recursive generator — favor pure, deterministic, seedable functions over deeply conditional
   stateful recursion.
7. **Integration points.** Specify how the new system interacts with: the `houseBuilt` flow and
   `City`, the `Person`/`SocialLife` model and `types/Social.ts`, the save/load system
   (see `003-save-load-system.md` — genealogy must be serializable; the pool likely lives in the
   save), and the future clock system (see `005-clock-and-calendar-system.md`).
8. **Migration.** Describe how to retire `Family.autoGenerate()`'s recursive logic and what changes
   to `Family.ts` / `SocialLife.ts` / `types/Social.ts` are implied.

Explicitly **non-goals / constraints:**

- **Do not go fully procedural.** Prefer the hard-simulation approach (persistent histories) over
  generating relationships on the fly with no backing history.

## Deliverables

- A written architecture proposal covering all points above, with the chosen model, data
  structures, generation algorithm (pool creation + household draw), and serialization implications.
- A proposed phased **implementation task breakdown** (candidate follow-up tickets), e.g. data model
  + pool generation, household draw on placement, death/aging, family-tree UI updates.
- Open questions / decisions requiring maintainer input, surfaced explicitly.

## Acceptance criteria

- Proposal is reviewed and approved by the maintainer before any implementation task is opened.
- The proposal demonstrably supports the "child living with adult sibling because parents are
  deceased" and "roommates" scenarios.

## Notes

- Keep the genealogy pool deterministic/seedable so saves are reproducible and testable.
- Consider how the existing D3 family-tree window (`hud/windows/HouseDetails.tsx`,
  `hud/d3/familyTree.ts`, `Family.getFamilyTree()`) would render trees that now cross households.

---

# Proposal — Population genealogy + household draw

> Status: **proposal, awaiting maintainer approval.** No production code in this PR. The implementation
> task breakdown (§9) and open questions (§10) are candidates only — per CLAUDE.md §5.4 the follow-up
> task files are not created until this proposal is approved.

## 0. Verified current state (exploration pass)

Confirmed against the source on branch `task/household-generation-redesign`:

- **Trigger / ownership.** `City` registers `houseBuilt → setupHousehold` in its constructor
  (`City.ts:20`). `setupHousehold(house)` builds `new Family(house)`, `await family.autoGenerate(Game)`,
  bumps `population`, and calls `house.setFamily(family)` (`City.ts:40-51`).
- **Generation.** `Family.autoGenerate()` picks `1..8` members, creates a first adult, then recurses
  through `generateSpouse` / `generateChildren` (`generateBaseRelationships`), then
  `assignExtendedRelationships()` derives siblings/grandparents/uncles/aunts/nieces/nephews in five
  passes (`Family.ts:64-291`). All randomness is `Math.random()`; `familyId` uses
  `new Date().getTime()` (`Family.ts:35`) — **not seedable / not deterministic**.
- **Scene coupling.** `Family.createPerson()` calls `gameManager.emitSingle("personSpawnRequest", …)`
  (`Family.ts:43`), so generation **spawns a live Phaser `Person` per member**. The generator cannot
  run in a `testEnvironment: node` Jest test without a scene — this is the core testability blocker.
- **Relationship storage.** `SocialLife` owns a `RelationshipMap` (`types/Social.ts:30-46`) with
  single-valued (`father`/`mother`/`spouse`) and array-valued (`child`/`sibling`/…) edges, plus
  `home: House | null`, `firstName`, `familyName`, `age`, `gender` (`SocialLife.ts`). Extended kinship
  is **materialized and stored redundantly** rather than derived.
- **No time/age/death.** Confirmed there is no clock, date, aging, or death anywhere (consistent with
  `005-clock-and-calendar-system.md` §Background). `age` is a static integer set at creation.
- **Save/load is already merged (drift vs. task text).** `003-save-load-system.md` is **done**
  (commit `a860250`). The shipped model (`types/Save.ts`, `SaveManager.ts`) serializes only
  *materialized* entities: `PersonSnapshot` carries identity + a `RelationshipSnapshot` of id→id edges;
  `FamilySnapshot` carries `familyId`/`familyName`/`householdId`/`memberIds`. There is **no population
  pool** in the snapshot today. Any new genealogy must extend `WorldSnapshot`.
- **D3 tree.** `Family.getFamilyTree()` (`Family.ts:327`) and `Person.getFamilyTree()`
  (`Person.ts:374`) walk the in-memory `RelationshipMap` into `{nodes, links}`; `HouseDetails.tsx`
  renders one `Family`'s members. Nodes are name-only (`{ name }`); there is no notion of
  alive/deceased or cross-household membership in the render data.

## 1. Recommended architecture (answers Goal 1)

Adopt the maintainer's **two-fold** approach, refined into three concerns with a clean data/sim
boundary. The guiding principle: **the genealogy is the source of truth; the simulation field only ever
holds a materialized subset of it.**

```
                 ┌─────────────────────────────────────────────┐
   new save  →   │  (A) Population / Genealogy  (pure data)     │
   (seed)        │  thousands of Person records across N        │
                 │  generations: birth, parents, partnerships,  │
                 │  death. Mostly-dead ancestors + living pool. │
                 └───────────────┬─────────────────────────────┘
                                 │  draw (seeded, on houseBuilt)
                                 ▼
                 ┌─────────────────────────────────────────────┐
   house placed →│  (B) Household                               │
                 │  a *living arrangement*: which living people │
                 │  co-reside in this House and why.            │
                 └───────────────┬─────────────────────────────┘
                                 │  materialize
                                 ▼
                 ┌─────────────────────────────────────────────┐
   gameplay   →  │  (C) Materialized layer (Phaser)            │
                 │  game/Person instances for residents of      │
                 │  placed households; sprites, travel, depth.  │
                 └─────────────────────────────────────────────┘
```

- **(A) Population** is plain, serializable data with **no Phaser/React imports** and **no live
  objects** — pure records keyed by stable id. Generated once at new-save creation by a deterministic,
  seeded forward simulation over several generations (see §4). Most produced individuals are *dead
  ancestors* who give the living population a real backstory; a slice is *alive and unplaced*.
- **(B) Household** binds a coherent group of **currently-living** pool people to a placed `House`,
  with an explicit *reason* for co-residence (nuclear family, single occupant, sibling guardianship,
  roommates, …). Households are the living-arrangement layer and are **distinct from bloodline**.
- **(C) Materialized** `game/Person` objects are created only for residents of placed households (and,
  later, for commuters/visitors). They are thin views onto a pool record (`personId`), not the owner
  of the genealogy.

### Why this over the alternatives (trade-offs)

| Approach | Memory / save size | Determinism | Cross-household trees | Verdict |
|---|---|---|---|---|
| **Pre-generated pool (recommended)** | Higher: thousands of records live in the save. Mitigable (compact records, optional compression). | Strong: one seed → whole ancestry; draws are a seeded stream. | Native: a house draws a *slice* of an existing tree. | **Chosen.** |
| Generate-on-placement only (today, scaled up) | Low | Weak unless every call is seeded; still island-per-house | Impossible without retrofitting links between islands | Rejected — can't span households, the task's core requirement. |
| Lazy/just-in-time genealogy (synthesize ancestors only when inspected) | Lowest | Hard to keep coherent under edits | Fragile | Rejected — drifts from "hard simulation, real histories." |

The pool's cost is memory/save size; we pay it to get coherence, determinism, and cross-household
genealogy "for free." §10 raises the size budget as an open question.

## 2. Cross-household family trees (answers Goal 2)

Because every living person is a node in **one** big parent/partnership graph (A), a house placement
pulls a **connected slice** of that graph rather than inventing an island. An elderly couple in house
#1 and their grown child's nuclear family in house #7 are the *same tree*; the child's `parents` ids
resolve to the couple regardless of which households are placed. "Placing a house pulls a coherent
slice of the existing population" is satisfied structurally — there is only ever one population.

## 3. Households ≠ families; the data model (answers Goals 3, 4, 5)

### 3.1 Genealogy person record (pure data)

Store only **primary, factual edges**; derive everything else (§3.3).

```ts
// types/Genealogy.ts (new) — no Phaser/React imports
type PersonId = string;

interface GenPerson {
  id: PersonId;
  firstName: string;
  familyName: string;        // birth surname; partnerships don't mutate the record
  gender: Gender;            // reuse types/Social.ts Genders
  birthTick: number;         // in-game tick (see §6, clock). At new-save: synthetic ticks in the past.
  deathTick: number | null;  // null = alive. Enables Goal 5 with zero new machinery.
  fatherId: PersonId | null;
  motherId: PersonId | null;
  partnerships: Partnership[]; // marriage/cohabitation episodes, ordered
}

interface Partnership {
  partnerId: PersonId;
  startTick: number;
  endTick: number | null;    // null = ongoing; set on divorce or death
}
```

`age` is **no longer stored**; it is `derive(currentTick - birthTick)` so the same record ages as the
clock advances (Goal 4, and forward-compatible with `005`). Until the clock ships, a fixed
`currentTick = 0` epoch yields stable ages and the model still works.

### 3.2 Household record (living arrangement)

```ts
// types/Household.ts (new)
type HouseholdId = string;

interface Household {
  id: HouseholdId;
  houseKey: string;          // House anchor "row-col" (matches Save.ts addressing)
  memberIds: PersonId[];     // currently-living residents
  arrangement: HouseholdArrangement; // 'nuclear' | 'single' | 'siblings'
                                     // | 'guardianship' | 'roommates' | 'multigen'
  headId: PersonId;          // primary reference person used for the draw
}
```

A household references **living** pool people; it does not own them and does not duplicate kinship.
This is what makes the required scenarios first-class:

- **"Child living with adult sibling because parents are deceased"** — draw a living minor whose
  `fatherId`/`motherId` both resolve to records with non-null `deathTick`, plus a living adult sibling
  (shares a parent). `arrangement = 'guardianship'`. The UI can *explain* it: the parents exist in the
  tree, flagged deceased.
- **"Roommates"** — a household whose members share **no** parent/partner edges; `arrangement =
  'roommates'`. Impossible to express in today's `RelationshipMap`, trivial here.

### 3.3 Derived kinship (replaces `assignExtendedRelationships`)

Sibling, grandparent, uncle/aunt, niece/nephew, **cousin**, and spouse-of-relative are **pure
functions over the parent graph**, computed on demand — not stored:

```ts
// util/kinship.ts (new) — pure, no side effects
siblingsOf(pool, id): PersonId[]      // share ≥1 parent, exclude self
grandparentsOf(pool, id): PersonId[]  // parents-of-parents
unclesAuntsOf(pool, id): PersonId[]   // siblings-of-parents
nephewsNiecesOf(pool, id): PersonId[] // children-of-siblings
ancestorsOf / descendantsOf(pool, id, depth)
relationshipLabel(pool, a, b): Relationship | null  // for the D3 link label
```

This deletes the five stateful passes in `Family.assignExtendedRelationships()` (`Family.ts:172-291`)
and the redundant array storage in `SocialLife`, and makes kinship **directly unit-testable** with a
fixture pool (no scene, no RNG).

## 4. Generation algorithm (answers Goals 1, 6)

### 4.1 Seedable RNG

Add a small deterministic PRNG (e.g. `mulberry32`) in `util/` (`util/random.ts`), seeded from a
per-save `worldSeed` stored in the snapshot. **No `Math.random()`, `Phaser.Math.RND`, or
`new Date()`** in generation. Every random draw flows through an explicit RNG instance passed as an
argument, so tests pin behavior by seed.

### 4.2 Pool creation (new save) — pure forward simulation

```
generatePopulation(seed, params) -> PopulationState   // pure: same seed ⇒ identical pool
  1. Seed founders: F couples G generations in the past (synthetic birthTicks).
  2. For each generation g in 1..G:
       for each fertile couple alive in g:
         sample child count; create GenPerson children (parents set);
         pair some adults into Partnerships (respect age gaps, no close kin);
       assign deathTick to a fraction by lifespan distribution (older gens mostly dead).
  3. Stop at the present epoch (tick 0). Result: mostly-dead ancestors + a living, unplaced cohort.
```

The output is a flat `Record<PersonId, GenPerson>` plus indices (by alive, by family). Because it is a
pure function of `(seed, params)`, a test asserts exact counts, that every child's parents predate it,
that no partnership joins close kin, and that re-running the same seed is byte-identical.

### 4.3 Household draw (on `houseBuilt`) — seeded, deterministic

```
drawHousehold(pool, drawState, house, rng) -> Household
  1. Pick a living, unplaced "head" (weighted: prefer adults; optionally cluster relatives nearby).
  2. Assemble co-residents by arrangement, sampled from sensible weights:
       - nuclear: head + living spouse + their living minor/young children
       - single: head only
       - guardianship: living minor + living adult sibling/uncle/aunt (parents deceased)
       - roommates: head + unrelated living adults
       - multigen: nuclear + a living grandparent
     Respect House capacity (MAX_RESIDENTS = 8, House.ts:9).
  3. Mark drawn people placed (advance drawState cursor) so a later house can't reuse them.
  4. If the living/unplaced pool is exhausted → generate an "immigrant" mini-family from rng
     (keeps determinism; see Open Question §10).
```

The draw is pure given `(pool, drawState, house, rng)`. Placement *order* is player-driven, so the
draw RNG is a stream advanced per placement and persisted in the save (so reload reproduces it).

## 5. Testability (answers Goal 6)

The redesign is built for `testEnvironment: node` unit tests with **zero Phaser**:

- `util/random.ts` — seed → fixed sequence.
- `util/kinship.ts` — fixture pool → exact sibling/uncle/cousin/grandparent sets; the
  "parents-deceased" predicate.
- `generatePopulation(seed)` — deterministic counts, acyclic parent graph, age-gap invariants,
  reproducibility across runs.
- `drawHousehold(...)` — each `arrangement` yields a valid living group within capacity; the
  guardianship and roommates scenarios are asserted directly (satisfies the task's acceptance
  criteria); no person is placed twice.

Contrast with today: `Family.autoGenerate` needs a `GameManager` + scene (`emitSingle`) and is
nondeterministic, so it has effectively no unit coverage. `test/personTravel.test.ts` and
`test/saveLoad.test.ts` show the project already unit-tests pure logic — these slot in alongside.

## 6. Integration points (answers Goal 7)

- **`houseBuilt` / `City`.** `City.setupHousehold` stops generating from scratch. It calls
  `population.drawHousehold(house)`, then **materializes** the returned living members into `game/Person`
  instances (the `personSpawnRequest` emit currently inside `Family.createPerson` moves here, to a
  thin `materializeHousehold` step). `population` is owned by `City` (or a new `Population` system held
  by `GameManager` alongside `field`/`city`), created at new-save time.
- **`Person` / `SocialLife` / `types/Social.ts`.** `SocialLife` holds a `personId` into the pool and
  becomes a **view**: `getAge()` derives from `birthTick` + clock; `getInfo()`/relationship queries
  delegate to `util/kinship` over the pool. The stored `RelationshipMap` (`types/Social.ts:30-46`) is
  retired; `Relationships`/`Genders` enums stay (used as derivation output + link labels).
- **Save/load (003, already merged).** Extend `WorldSnapshot` (`types/Save.ts:68`) with `worldSeed`,
  the serialized `PopulationState` (flat `GenPerson[]`), `Household[]`, and the draw cursor. Bump
  `SAVE_VERSION` (currently `1`, `Save.ts:6`) and add a migration: a v1 save has no pool, so on load
  synthesize a minimal pool from existing materialized people (their stored `relationships`) so old
  saves still open. `PersonSnapshot` shrinks to `{id→personId, x, y, direction, indoors, vehicleId}`;
  identity/age/relationships come from the pool, removing the per-person `RelationshipSnapshot`
  duplication. `FamilySnapshot` is replaced/augmented by the `Household` table.
- **Clock (005, not yet built).** `birthTick`/`deathTick` are expressed in the clock's tick/timestamp
  units. Until `005` lands, use a fixed epoch (tick 0); when it lands, ages advance and `deathTick`
  becomes the hook for the aging/death task (§9 Phase D). The pure time-math `005` proposes pairs
  directly with `age = f(currentTick - birthTick)`.
- **Jobs (007).** Skills can be assigned during pool generation (per `007` Notes), so a drawn resident
  already has plausible skills for hiring.

## 7. The D3 family-tree window with cross-household trees

`Family.getFamilyTree()` / `Person.getFamilyTree()` are reimplemented as a pure walk over the pool's
parent/partnership graph starting from a household's residents, out to a configurable depth (so it now
naturally includes people in **other** households and **deceased** ancestors). `types/FamilyTree.ts`
`Node` gains flags so the renderer can style them:

```ts
interface Node { name: string; alive: boolean; householdId: HouseholdId | null; isSubject?: boolean; }
```

`familyTree.ts` (`hud/d3/`) styles deceased nodes (e.g. dimmed/outlined) and other-household nodes
distinctly; `HouseDetails.tsx` keeps rendering from the subject house but now shows the broader tree.
This makes the "parents are deceased" backstory **visible** in the existing window — directly
demonstrating the acceptance criteria.

## 8. Migration (answers Goal 8)

1. Introduce `types/Genealogy.ts`, `types/Household.ts`, `util/random.ts`, `util/kinship.ts`, and a
   `Population` system — **additively**, no behavior change yet (Phase A).
2. Switch `City.setupHousehold` to draw + materialize; **delete** `Family.autoGenerate`,
   `generateBaseRelationships`, `generateSpouse`, `generateChildren`, `generateNumberOfChildren`,
   `inverseRelationship`, and `assignExtendedRelationships` (`Family.ts`). `Family` either becomes a
   bloodline view or is folded into `Household` (Open Question §10).
3. Reduce `SocialLife` to identity + `personId` view; drop the stored `RelationshipMap`. Update
   `Person.getOverview`/`getFamilyTree` and `Family.getFamilyTree` to derive from the pool.
4. Extend the save model + migration (§6); update `test/saveLoad.test.ts`.
5. Update `CLAUDE.md` §4.8 (households & social model) and the save section in the **same PR** as the
   code change, per §5.7.

## 9. Proposed phased implementation breakdown (candidate follow-up tickets)

Each is independently mergeable and unit-tested. *Not created until this proposal is approved (§5.4).*

- **004a — Genealogy data model + seeded RNG + pure kinship.** `types/Genealogy.ts`,
  `types/Household.ts`, `util/random.ts`, `util/kinship.ts`. Pure, fully unit-tested. No gameplay
  change.
- **004b — Population pool generation at new-save.** `generatePopulation(seed, params)` + the
  `Population` system; serialize the pool into `WorldSnapshot` (bump `SAVE_VERSION` + v1 migration).
- **004c — Household draw on placement.** Replace `Family.autoGenerate` with `drawHousehold` +
  materialization in `City.setupHousehold`; retire the recursive generator and the stored
  `RelationshipMap`. Asserts the guardianship + roommates scenarios.
- **004d — Aging & death (depends on `005` clock).** `deathTick` enforcement, aging from `birthTick`,
  ongoing pool simulation (births/deaths during play), emergent re-housing.
- **004e — Cross-household family-tree UI.** `types/FamilyTree.ts` node flags; deceased/other-household
  styling in `hud/d3/familyTree.ts` + `HouseDetails.tsx`.

## 10. Open questions / decisions for the maintainer

1. **Pool size budget.** How many founders / generations / target *living* population? This drives
   memory and save size (thousands of records, base64 in `localStorage` today). Do we want
   compression in the `SaveProvider`, or a cap (e.g. ~5–10k records)?
2. **Static ancestry vs. living simulation.** At new save, generate a *static* ancestry and only draw
   from it? Or have the pool **keep simulating** births/deaths/marriages during gameplay (truer to
   "hard simulation, à la Dwarf Fortress")? Affects `004d` scope.
3. **Pool exhaustion.** When unplaced living people run out, generate "immigrant" families on the fly
   (recommended, keeps determinism) — acceptable?
4. **`Family` vs `Household`.** Keep `Family` as a distinct bloodline concept alongside `Household`, or
   fold it entirely into `Household` + derived kinship? (Recommendation: fold it in; "family" becomes
   a query over the graph, not a stored object.)
5. **Determinism vs. player order.** The draw stream depends on house-placement order, so two players
   placing houses differently get different households from the *same* world seed. Acceptable (it is
   still reproducible per save)?
6. **`age` removal.** Confirm replacing stored `age` with `birthTick`-derived age is acceptable before
   the clock (`005`) exists (interim fixed epoch).

## 11. Decisions (maintainer, 2026-06-24)

The open questions are resolved as follows; the proposal above is to be read with these in force.

1. **Pool size budget → ~10k+ records with compression.** Target a rich, multi-generation population
   (~10k+ individuals across living + deceased). The `SaveProvider` gains **compression** (e.g.
   gzip/deflate of the JSON before base64) so the snapshot stays manageable in `localStorage`.
   `004b` owns the compression step; coordinate with the merged save model in `types/Save.ts`.
2. **Static vs. living → living simulation from the start.** The pool **keeps simulating** births,
   deaths, and marriages during gameplay, not just at new-save. This is the truest hard-simulation
   model. **Consequence:** the live simulation is driven by in-game time, so `004d` (aging/death over
   time) is **core, not optional**, and is **gated on the clock (`005`)**. Implementation therefore
   sequences the **clock-independent foundation first** (data model, seeded RNG, pure kinship, pool
   generation with synthetic past ticks) and wires the live tick-driven simulation once `005` lands.
3. **`Family` → folded into `Household` + derived kinship.** The `Family` object is retired; "family"
   is a pure query over the parent graph (`util/kinship`). `Household` is the only stored
   living-arrangement concept. `Family.getFamilyTree`/`FamilySnapshot` are replaced by derived
   equivalents (§7, §8).
4. **Pool exhaustion → generate immigrants on demand.** When the unplaced-living pool is exhausted,
   deterministically spawn an immigrant mini-family from the seeded RNG stream; placement never blocks.
5. **Determinism vs. player order (Q5) → accepted.** Draws depend on placement order; the world stays
   reproducible per save (the draw RNG stream is serialized). No further action.
6. **`age` removal (Q6) → accepted.** Stored `age` is replaced by `birthTick`-derived age; an interim
   fixed epoch (tick 0) is used until the clock (`005`) exists.

### Implementation note (this branch)

Per maintainer direction, implementation proceeds on this same branch
(`task/household-generation-redesign`) rather than separate per-phase branches. Work starts with the
**clock-independent foundation (004a: `types/Genealogy.ts`, `types/Household.ts`, `util/random.ts`,
`util/kinship.ts`, fully unit-tested)** and builds outward; the live tick-driven simulation (Q2)
follows once the clock (`005`) is available.
