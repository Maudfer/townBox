# [Content] Objects data backfill (1,200+ archetypes)

- **Type:** Content / Data
- **Labels:** `content`, `objects`, `data`, `enrichment-arc`
- **Depends on:** [041](041-objects-and-possessions_DONE.md) (schema + validators), [049](049-content-planning-lists_DONE.md) (the name lists)

## Goal

Fill `objects.json` with **at least 1,200 object archetypes** people can own, hold, or encounter, from [`docs/planning/objects-master-list.md`](../planning/objects-master-list.md), with properties filled **contextually per object** — real dimensions/weights in normalized units (cm / grams), honest flags (`carryable`, `pocketable`, `stackable`, `consumable`, `equippable`, `placeable`), sensible `defaultContainerBehavior`, categories, and tags.

## Requirements

- Curate, don't transcribe: dedupe against the 041 starter set, drop un-modelable names, keep the planning list's category balance (foods, tools, toys, clothing, stationery, kitchenware, electronics, furniture, …).
- Plausible metadata (a pencil ≈ 7 g pocketable; a couch heavy/fixed/placeable; an apple consumable). Spot-checks in review, sanity assertions in tests (e.g. nothing `pocketable` above a weight threshold, `pocketable ⇒ carryable`, no zero dimensions).
- Container archetypes (backpack, purse, toolbox, bowl, jar, …) get meaningful `defaultContainerBehavior` (capacity semantics per 041).
- The 039/041 validators pass; add distribution guards to the semantic validator or a content test (≥ 1,200 entries; every category non-empty; a healthy pocketable/carryable share so wandering/pocketing actions have material to work with).
- Consider generating the JSON via a reviewed script from the planning table (deterministic, committed under `scripts/` or run-once and discarded — author's choice; the JSON is the deliverable).
- Performance check: load + validation time for the enlarged file stays acceptable (registry validation is load-time in dev).

## Non-goals

Object-action relationships ([053](053-object-action-relationships-backfill.md)). Placing instances in the world beyond what tests need (world seeding of venue objects can ride along if trivial, else propose a follow-up).

## Testing

- `validateAll()` green; the distribution/sanity content tests above; save round-trip with a large instance sample; load-time measurement noted in the PR.
