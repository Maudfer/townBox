# [Perf/Feature] Generator two-band recording + logical venues

- **Type:** Feature (generator)
- **Labels:** `simulation`, `history-asset`, `generator`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  K (K1 two-band, K2 stride-tolerance, K3 logical venues). Phase 6 — deliberately after all state layers.

## Goal

Part 0's biggest artifact: windowed people arrived with day-quantized, workless, school-less histories (24k
identical 24-hour sleeps, zero work actions across an 18-job career). Give drawn people true diurnal texture
AND friends.

## What shipped

1. **Two-band recording (K1):** the offline generator keeps the day stride for the deep past but runs the
   final `hotYears` at **hourly** stride, and the window selector is constrained to the hot band — so
   windowed people carry real shifts, real school days, real evenings, while ancestors keep affordable
   coarse histories. `hotYears: 0` keeps the old behavior for iteration runs.
2. **Stride tolerance (K2):** the acceptance criterion for every new state (needs, edges, mood, habits) —
   all closed-form so both bands integrate identically at the seam (a value at the band boundary is the same
   whether reached by 24-tick strides or 1-tick steps).
3. **Logical venues (K3):** `LogicalWorld` gives the social hook co-location candidates off-map, so asset
   people arrive with believable friend networks, not just family — the social graph rides the asset.

The one canonical asset regeneration is the maintainer's pre-merge step; the generator perf pass (118)
brought the hot-band run cost back to budget first.
