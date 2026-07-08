# [Feature] Deterministic contextual object generation

- **Type:** Feature / Simulation
- **Labels:** `objects`, `buildings`, `save`, `progression-arc`
- **Depends on:** [069](069-object-placement-tags.md) (tags + generation metadata)
- **Blocks:** [071](071-building-context-action-requirements.md) (requirements consume generated objects), [055](055-history-asset-pipeline.md) (logical buildings need the same fill)

## Goal

Buildings and businesses are **populated with plausible Object Instances at generation time** — a house gets
kitchen tools, bathroom items, and living-room fixtures; a clinic gets exam-room equipment and medical storage —
deterministically, bounded, and immediately consumable by action requirements and consequences. Objects stop
being consequence-only artifacts and become environmental context.

## Background (verified)

**Nothing seeds buildings today** — the only production `createInstance` callers are in `Consequences.ts`;
`GameManager`'s "world seeding" comment is aspirational. The substrate is ready: `Inventory.createInstance`
accepts arbitrary owner (`building`/`business`/`person`/`world`) + container (`{kind:'location', key}`),
instance ids are deterministic (`o<n>` counter), `instancesAtLocation`/`objectsAt` feed `objectAtLocation`
predicates, and the inventory serializes (v8 `objects` section). Note: the *consequence DSL* can't target a
named building's container — irrelevant here, the generator calls `Inventory` directly. Businesses already
carry deterministic per-anchor seeds (`worldSeed ^ anchorKey`, the `setupBusiness` pattern).

## Requirements

### The generator

- A pure-ish `generateBuildingObjects(buildingKind/blueprint, anchorKey, worldSeed, inventory, tick)` invoked
  from the existing placement flows (`City.setupHousehold` on `houseBuilt`, `City.setupBusiness` on
  `workplaceBuilt`) and callable for 055's logical buildings (no map dependency — location is
  `building:<key>`). Algorithm per the vision: resolve the building's tags (blueprint/residence file +
  overrides) → intersect with archetype `placement` → weighted, seeded draw (fork
  `worldSeed → hash(anchorKey) → salt`; sort candidates by archetype id before drawing) honoring per-object
  `min/maxPerBuilding`, `uniquePerBuilding`, and weights → `createInstance` with `ownershipDefault` resolved
  (`building` → `{kind:'building', key}`, `business` → `{kind:'business', key}`, `household`/`none` per
  metadata) and container `{kind:'location', key}`.
- **Bounds & sanity:** a per-building total cap (config) on top of per-object maxes — no absurd duplicates, no
  thousand-item houses. A generation config file (registered schema) holds the knobs (caps, global density
  multiplier) rather than magic numbers.
- **Once, then owned by the save:** generation happens at placement (and once per pre-existing building via a
  migration/backfill sweep on load of older saves — decide: generate for existing buildings at migration with
  the same determinism, so long-running saves aren't empty). Never regenerated on load (instances live in the
  snapshot; `SAVE_VERSION` bump only if the migration sweep needs a marker).
- **Teardown symmetry (loose end patched):** define object disposal on building destruction — bulldoze (025)
  and bankruptcy closure (021): location-contained instances at that building are removed (fixtures and stock
  die with the context) *except* instances physically carried by people (unaffected — containment axis already
  separates them); business-owned instances elsewhere transfer to `world` or are removed (pick, document,
  test). Re-occupancy (037) regenerates for the new business (fresh seed component so a bakery isn't born with
  the dead pharmacy's shelves).
- **Save-size budget:** measure snapshot growth on a representative town (e.g. 20 buildings) and record the
  number in this task on completion; the cap config is the lever if it's uncomfortable.

### Consumption proof (kept minimal here, 071 is the full pass)

- At least one end-to-end proof in this task: a generated house satisfies an existing `objectAtLocation`
  requirement (e.g. the oven-context bake step works in a freshly generated kitchen without any
  consequence-created oven).
- HUD: `WorkplaceDetails` already lists business-owned stock; add the equivalent location-contents view (or
  extend the house inspector) so generated context is inspectable.

## Non-goals

Action-requirement backfill (071). Restocking/consumption economy loops (shops depleting and reordering —
future; note it). Per-room placement. Player-facing object interaction UI.

## Testing

- Determinism: same seed + anchor ⇒ identical instance sets (ids, archetypes, quantities) across two runs,
  across save/load, and across live/bootstrap invocation paths.
- Constraints: min/max/unique/cap respected across many seeds (property test); tag intersection is the only
  candidate source (an object with no matching placement never appears).
- Teardown: bulldoze/bankruptcy removes location instances but never carried ones; re-occupancy regenerates
  fresh and different-where-expected.
- Migration sweep fills pre-existing buildings exactly once.
- The consumption proof above; existing consequence/OAR suites green.
