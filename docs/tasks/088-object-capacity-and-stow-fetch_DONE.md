# [Feature] Object capacity, stow/fetch & the curiosity-demoted hook

- **Type:** Feature (rule + actions)
- **Labels:** `simulation`, `objects`, `inventory`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  F (F1 capacity, F2 stow/fetch). Phase 2.

## Goal

The audit found the median person carrying **553 objects** (top carrier 1,413): the inventory-opportunity
hook pocketed anything forever with no capacity check anywhere in `Inventory.ts`. Acquisition had no reason;
retention had no cost. Give objects an economy of use — a life should fit in two hands and a house.

## What shipped

1. **Carry capacity (F1):** per-person carry budgets (weight + a slot count for non-pocketables, tunable in
   `json/inventory.json`); `grab`/`pocket` intents and the acquisitive hooks respect it; exceeding budget is
   a typed plan failure like any other. The `inventoryOpportunityHook` was demoted from "always pocket
   anything" to a **curiosity** behavior: low chance, capacity-gated, novelty-biased (the pebble/seashell
   charm stays; the 6,709 wristwatches don't).
2. **Home storage & fetching (F2):** a `stow`/`fetch` pair of discretes move instances between a person and
   their house's location inventory (the per-building object location from 070/076 — pure reuse). A
   homecoming routine deposits non-essentials; planned actions that need tools fetch first (a D prerequisite:
   repair fetches the toolbox). The "household pantry" is simply food objects located at the house plus a
   query — no new storage system.
3. **Ownership norms (F4):** free-to-take stays for genuinely loose public objects, but shop stock and other
   people's possessions are not grabbable — the structural distinction the crime hook (099) needs.
