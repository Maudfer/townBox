# [Feature] The market, end to end — at a real shop, the shelf is the truth

- **Type:** Feature (world adapter + data audit)
- **Labels:** `simulation`, `economy`, `market`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 113.
- **Depends on:** [089](089-retail-materialization-and-spoilage_DONE.md), [107](107-venue-grounding_DONE.md).

## Goal

The payoff of 107's venue grounding, verified and closed: at a real shop, purchases should consume actual
stock, and `bake_cake` (blocked 206/206 in the audit) should complete in live play.

## What shipped

1. **The fallback retired at real shops:** `WorldAdapter.businessAt(location)` (LiveWorld answers with the
   occupying business; off-map leaves it undefined) tells `purchaseObject` when the buyer is inside a
   business-hosted building — there, missing stock is a typed plan failure with zero mutations instead of a
   conjured instance. Off-map keeps the documented fallback (the seam's only sanctioned difference).
   Revert-danced.
2. **Honest stock gaps closed:** `flour_bag`, `egg`, `cream_jar` gained supermarket placement + generation
   (purchasable but never on any shelf); `medicine_bottle` stocks the pharmacy; `bought_groceries` gained the
   cream purchase — `cream_jar` was neither purchasable nor generatable anywhere, so `bake_cake`'s final step
   was unreachable in normal play.
3. **The coverage audit:** a test pins every `purchaseObject` query as satisfiable by real stock somewhere
   (shelf generation or a production-recipe output) — new content can't reopen the gap.
4. **The flagship closed:** a live-mode test shops real supermarket stock (the very instances change hands,
   money moves person→business, town total conserved) and `bake_cake` completes at the home oven.

Tests: `test/economy/marketEndToEnd.test.ts` (4 arcs).
