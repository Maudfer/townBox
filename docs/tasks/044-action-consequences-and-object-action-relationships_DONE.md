# [Core] Action Consequences (bounded DSL) & `object-action-relationships.json`

- **Type:** Core system / Simulation + Data
- **Labels:** `framework`, `actions`, `objects`, `consequences`, `data`, `enrichment-arc`
- **Depends on:** [041](041-objects-and-possessions_DONE.md) (instances), [043](043-actions-core_DONE.md) (action engine & bindings)
- **Blocks:** [045](045-job-shifts-and-work-actions.md)/[047](047-job-orchestrator.md) (work outputs), [051](051-actions-data-backfill.md)/[053](053-object-action-relationships-backfill.md) (content)

## Goal

Make Actions *do* things: a **bounded, declarative Consequence DSL** (no arbitrary code in JSON — the [013](013-procedural-simulation-framework_DONE.md) flexibility line holds) and the **`object-action-relationships.json`** schema for multi-input object transformations ([038 §7.4–7.6](038-simulation-enrichment-architecture_DONE.md)).

## Requirements

### Consequence DSL
Closed vocabulary, mirroring how event `effects` are a closed `EffectType` set (`types/LifeEvent.ts:32`). Minimum operations:
- **Object instances:** add, remove, move, consume, transform, transfer (with quantity handling for stackables).
- **Object state:** set/adjust instance attributes.
- **Approved mutations** on the person, a target person, a business, a building, or a world location (each op individually whitelisted and typed — e.g. `adjustMoney` routes through the existing `MoneyLedger`, never raw writes).
- **Trigger manual Events**; **schedule automated Events** (through 042's engine paths, with causation).
- **Bind outputs to named variables** (`$out.cake`) consumable by later sequence steps (043 bindings).
- **Declare ownership of outputs:** person | employer | business | world | targetPerson — this is the mechanism that replaces "jobs confiscate products" (a factory item is created as `employer`-owned into business inventory; a personal lunch as `person`-owned into Possessions; a borrowed tool stays business-owned but person-carried).
- Adding a new consequence op kind is a deliberate code change with tests; adding uses of existing ops is pure data.

### Atomicity
- Consequences of one action/step apply **atomically where possible**: pre-validate inputs (required instances exist, targets valid); on failure the Action fails or becomes `blocked` **without partially applying unrelated consequences**. Document the precise boundary (per-step transaction; cross-step rollback is out of scope).

### `object-action-relationships.json`
Multi-input/multi-output transformations (not a 1:1 table). Per entry:
- `actionId`; **inputs**: `[{ archetype or archetype+state, quantity, disposition: consumed | retained | transformed | required }]`; **outputs**: `[{ archetype, quantity, state }]`; **parameter bindings** (which action param supplies which input, `$parent.food` etc.); **output ownership/container** targets; optional **contextual requirements** (e.g. an oven instance at the location, a kitchen venue).
- Supports the canonical example: "Add X to Y" (add cream to baked dough) — multiple inputs, one consumed, one transformed, one output — without hyper-specific one-off actions.
- Registered in the 039 registry with **both-direction validation**: an entry can't reference a missing action/archetype; an action declared as transforming must have a relationship entry; sequence outputs referenced by `$previous.output` must be producible.
- Keep v1 deliberately limited but expressive enough for multi-input transformations; no conditional logic inside entries.

### Sequence integration
- The bake-a-cake chain must work end-to-end as data: mix (consume flour+egg+water → raw dough in Possessions) → bake (transform raw dough → baked dough, requires oven-at-location) → add cream → add topping → cake. Parent completion exposes the cake via binding — and does **not** mint a second one.

## Non-goals

Recipes as a first-class schema (a recipe is an action sequence + relationships in v1). Economy/pricing of produced objects. Brain deciding *when* to cook (046).

## Testing

- DSL unit tests per op (including ownership targets and stack quantity math); atomicity: missing input blocks with zero partial application.
- Relationship validator fixtures: missing action, missing archetype, unbindable parameter, quantity ≤ 0.
- The full cake sequence as an engine test: inventory before/after, single final instance, correct provenance/causation chain in the logs.
- Determinism preserved (no RNG in consequence application itself).
