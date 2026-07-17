# [Foundation] Venue grounding — `venue:*` resolves to real placed buildings

- **Type:** Foundation (world adapter + data)
- **Labels:** `simulation`, `venues`, `execution-boundary`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 107.
  The foundation every physical-grounding task below depends on.

## Goal

`LiveWorld.targetBuilding` returned `null` for `{kind:'venue'}` — venue actions ran logically but nobody
walked anywhere in live play, the single biggest gap. Ground venues to real placed buildings.

## What shipped

1. **The map (`json/venues.json`):** venue kind → the blueprint keys that host it (`bar → [bar]`,
   `supermarket → [supermarket]`, `shop → [supermarket, clothing_store, …]`, …). Registered + validated both
   ways (every venue kind an action targets is mapped; every mapped blueprint exists).
2. **Live resolution (`LiveWorld.hasVenue` + venue targeting):** a venue resolves to the nearest placed,
   occupied business whose blueprint hosts it (deterministic tie-break); no host → the transition cancels and
   the instance blocks (typed, zero mutations). Bootstrap/logical worlds keep the abstract shared-venue
   semantics — the seam holds, no mode branches.
3. **Selection guard:** free-time selection skips venue actions with no live host
   (`Brain.getFreeTimeCandidates` carries `venueKind`; `world.hasVenue` gates), so people don't thrash
   proposing unreachable trips.

This unblocks 111 (hospital), 113 (the market — purchases at a real shop), and every "people go somewhere"
task.
