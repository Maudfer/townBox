# [Core] Objects & Person Possessions

- **Type:** Core system / Simulation + Data
- **Labels:** `framework`, `objects`, `inventory`, `data`, `enrichment-arc`
- **Depends on:** [039](039-data-schema-registry-and-validators_DONE.md) (schema registration), [040](040-hourly-ticks-and-execution-boundary_DONE.md) (save v8 coordination, log/causation for provenance)
- **Blocks:** [044](044-action-consequences-and-object-action-relationships_DONE.md) (consequences move instances), [050](050-objects-data-backfill.md) (content)

## Goal

Introduce the object system of [038 §5](038-simulation-enrichment-architecture_DONE.md): a new **`objects.json`** schema of object **archetypes**, runtime **Object Instances**, an **inventory/container** model, world ownership/location, and a `Possessions` container on every Person.

## Background (verified)

There is **no inventory/objects concept anywhere** in the codebase today — people carry only money balances (`Economy`), skills (`WorkLife`), a job, a home, and relationships (038 §1.3). This is a green-field system; the design constraints below exist to avoid painting later tasks into a corner.

## Requirements

### Schema — `objects.json` (archetypes, not runtime objects)
- Per archetype: `id`, `label`, `category`, dimensions (`{ w, d, h }` in **cm**), `weightGrams` (normalized units everywhere), flags `carryable`, `pocketable`, `stackable`, `consumable`, `equippable`, `placeable`, a `defaultContainerBehavior` (whether/what it can contain — a backpack contains, a bowl contains, an apple doesn't), and free-form `tags` for selection modifiers later.
- Enrich metadata even where unused yet — the flags above are the *minimum* distinctions.
- Registered in the 039 registry: structural validation (units, flags, enums; e.g. `pocketable → carryable`) + semantic validation (unique ids, known categories).
- Ship a **small starter set** (a few dozen archetypes across categories) so the system is exercised; the 1,200+ backfill is task [050](050-objects-data-backfill.md).

### Runtime — Object Instances
- `{ instanceId, archetypeId, quantity (stackables only), state/attributes, owner, container, createdAtTick, provenance (causationId of the creating action/event) }`.
- **Ownership and containment are independent axes.** Owner: `person | business | building | world | none`. Container: a person's Possessions, another instance (pencil-in-backpack, dough-in-bowl), a building/room, or a world location. Cycles must be rejected.
- **Property vs. Possession:** Possessions hold only what a person actively carries (cellphone, gum packs, pencil, backpack). Cars and houses are *owned* but never contained in Possessions; furniture lives inside buildings and is `placeable` but not carried. Gray areas (big furniture) deliberately stay out of Possessions in v1.
- Stackables merge by archetype + compatible state; instance identity is preserved for non-stackables.

### Person integration
- `Person` gains `Possessions` (a container of instance ids) alongside `SocialLife`/`WorkLife` — serialized, save-v8-coordinated with 040 (one version bump for the arc's foundation, not several).
- Carrying-capacity hooks (weight/size sums) computed from archetype metadata — enforcement can be lenient in v1 but the query must exist (needed by "Pocketed a small object" requirements).
- World-side registries: instances at a building/location, queryable through the 040 `WorldAdapter` (`objectsAt`) in both live and bootstrap modes.

### Queries & requirements
- Predicate-reachable checks (for 043's shared requirements): person has instance of archetype/tag/flag; instance available at current location; instance unowned / owned-by. Keep the evaluation O(small) via per-container indexes.

## Non-goals

- No rendering of objects on the map. No shop pricing/economy integration (economy keeps its category-demand model; reconciling objects with `materials.json` is future work — note the relationship in code comments). No theft/borrowing rules (an Action-level concern, 043/051).

## Testing

- Archetype validation fixtures (valid + invalid). Instance lifecycle: create/transfer/contain/consume; container cycles rejected; stack merge/split; ownership vs. containment independence.
- Save round-trip: instances, containment trees, Possessions survive; provenance/causation preserved.
- Determinism: instance-id allocation is seeded/sequential (no `Math.random`), stable across runs.
