# [Feature] Retail materialization + spoilage & stock ceilings

- **Type:** Feature (economy seam + sweep)
- **Labels:** `simulation`, `economy`, `objects`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — F3.
  Phase 2 — closes the food chain end-to-end.

## Goal

Give the abstract monthly demand economy a **concrete object face**, and close the loop the audit exposed:
12,185 `baked_dough` + 11,942 `bread_loaf` produced with no sales sink, `bake_cake` blocked 206/206 because
pantries were never stocked on purpose.

## What shipped

1. **Retail materialization (F3):** shopping actions at a venue convert **business-owned stock instances**
   (which production recipes already create) into household-owned objects with a real `adjustMoney`
   micro-transaction. Reconciliation keeps double-counting away — per-business/per-person materialized
   counters that the monthly economics *nets out* of the abstract demand resolution (`Economy.recordPurchase`
   / `recordFallbackPurchase`, drained monthly); materialized sales count as part of `unitsSold`, not in
   addition.
2. **Stock ceilings:** production recipes stop creating an archetype once its shelf hits a ceiling
   (`STOCK_CEILING_PER_ARCHETYPE`) — the dough mountain can no longer accumulate; sales drain the shelf and
   production resumes.
3. **Perishables:** `expiresAfterTicks` on consumable archetypes + a daily spoilage sweep
   (`Inventory.sweepExpired`, run on the day cadence) — bread rots, the shelf drains, production resumes
   below the ceiling.

Production → shelf → purchase → pantry → cooking → eating → the `food` need: every step already had an
action; they finally connect.
