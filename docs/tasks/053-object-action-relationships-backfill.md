# [Content] `object-action-relationships.json` backfill

- **Type:** Content / Data
- **Labels:** `content`, `objects`, `actions`, `data`, `enrichment-arc`
- **Depends on:** [044](044-action-consequences-and-object-action-relationships.md) (schema), [050](050-objects-data-backfill.md) (archetypes), [051](051-actions-data-backfill.md) (actions — may land jointly, see 051)

## Goal

Fill `object-action-relationships.json` with the valid object transformations that make sequence-based continuous Actions and object-manipulating discrete Actions real: cooking/baking chains, repair, packing, gifting-compatible categories, consuming, assembling, cleaning-with-supplies, and the work-Action production recipes 047 routes into business inventory.

## Requirements

- Cover every 051 action that declares object inputs/outputs (the 044 validator enforces both directions — this task is done when it's green at meaningful scale).
- Multi-input transformations exercised broadly, not just the cake fixture: several food chains (dough→bread, ingredients→meal), tool-mediated transforms (broken item + toolbox → repaired item, tool retained), consumption entries for consumables, container packing entries (pack a backpack), and per-job production recipes (bakery produces breads/cakes into employer inventory; factory produces goods) with correct input dispositions (`consumed | retained | transformed | required`) and contextual requirements (oven-at-location, kitchen venue).
- Quantities and states are plausible and validated (no zero/negative quantities; output states exist in the archetype's declared state space if 041 constrains one).
- Keep entries declarative and v1-limited per 044 — where a transformation genuinely needs conditional logic, simplify the design or propose a schema extension separately.

## Non-goals

Economy integration of produced goods (the `materials.json` reconciliation remains future work). New DSL ops.

## Testing

- `validateAll()` green; coverage assertion (every object-declaring action has entries).
- Engine tests for a representative sample of chains (inventory before/after, provenance).
- Long-run smoke with 051: object populations stay sane (no runaway duplication; consumables deplete; business inventories accumulate only employer-owned outputs).
