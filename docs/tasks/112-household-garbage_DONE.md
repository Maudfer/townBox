# [Feature] Household garbage — produce, take out, collect, dispose

- **Type:** Feature (data + one DSL op)
- **Labels:** `simulation`, `services`, `objects`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 112.
- **Depends on:** [101](101-garbage-service_DONE.md).

## Goal

The 101 litter loop covered the street; add the household half — garbage produced at home, taken to the
curb, collected off the street, with visible pile-up when there's no depot.

## What shipped

1. **Production:** the `cooking_meal` and `cleaning_house` child pools gain a low-chance `filled_the_trash_bag`
   discrete that creates a real, unowned `bag_of_garbage` (new archetype, action-created only) at the home.
2. **Taking it out:** `took_out_the_trash` (the 051 texture discrete, upgraded) requires a bag and MOVES it
   to the curb — the one bounded-DSL addition this task needed: `moveObject container: "outside"` (the shared
   street location, where collectors sweep). A `trash_day` routine (cadence 2 days) anchors the chore.
3. **Collection:** the collectors' `collection_rounds` pool gains `collected_the_trash`, consuming curbside
   bags. No depot → no collectors → the bags visibly pile up (pinned: three fill/take-out rounds accumulate
   exactly three uncollected bags).
4. **Bookkeeping:** the conjuring audit keeps `filled_the_trash_bag`; the 071 reachability scan accepts
   action-created archetypes as satisfiable objectAtLocation targets.

Tests: extended `test/actions/garbageService.test.ts`.
