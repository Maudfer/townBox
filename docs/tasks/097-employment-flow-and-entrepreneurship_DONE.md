# [Feature] Employment flow — seeking, first-placement matching & entrepreneurship

- **Type:** Feature (data + planner + generation + event)
- **Labels:** `simulation`, `economy`, `jobs`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  I (I1 seeking, I2 first-placement matching, I3 entrepreneurship). Phase 4.

## Goal

"Takes a long time for someone to get a job; morph businesses to fit residents; entrepreneurial system; make
it flow." Replace pure hazard-waiting with visible behavior, and let the town grow its own economy.

## What shipped

1. **Job seeking as behavior (I1):** unemployment enqueues a `job_seeking` routine — visible
   `applied_for_a_job` actions at the venue that drive the `get_job` rate up sharply (a `jobApplications`
   context factor over recent applications), with money urgency accelerating it. Days-to-two-weeks to
   employment when a reachable slot exists, and the search is visible (`application_rejected` when it isn't).
   The `get_job` event + JobMarket remain the single hiring authority.
2. **First-placement matching (I2):** the 037 unmet-demand weighting (plus a workforce-fit term from
   JobMarket's candidate scoring over the unemployed pool) now feeds the **initial** blueprint draw — place
   houses and a work lot and you get a shop the residents can actually staff. Determinism preserved (seed +
   anchor unchanged; only the weights change).
3. **Entrepreneurship (I3):** a qualified unemployed adult with savings above a threshold may **found a
   business** on a vacant work lot in the category with the largest unmet demand, in the trade they strictly
   know — `founded_business` seeds it with the founder's own capital (ledger-clean via the external-sector
   mirror), hires them at their matched rank, and names it after them. At most one founding per month behind
   a deterministic roll.
