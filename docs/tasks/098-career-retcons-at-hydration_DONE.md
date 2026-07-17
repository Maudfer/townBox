# [Feature] Career retcons at hydration

- **Type:** Feature (hydration)
- **Labels:** `simulation`, `history-asset`, `skills`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — I4.
  Phase 4 — needs 096's gap signals.

## Goal

Asset people arrive fully-formed, so a town needing a doctor could wait forever. Implement the brief's
compromise — bounded, history-coherent retcons at draw time — so the town can staff its clinic without
blank-slate immigrants, while keeping everything the asset was built for.

## What shipped

1. **The retcon (`City.applyCareerRetcon`, `json/retcons.json`):** when the coverage ledger (096) reports a
   critical STAFFING gap **and a facility exists** (a retcon answers a staffing gap, not a missing building),
   the household draw may select a candidate whose skills are adjacent to the needed job and inject an
   authored transition template into their hydrated history — a `nursing_school`/`trade_school` event at a
   plausible past age plus the corresponding `acquireSkill` grants through the normal SkillBook path,
   appended as real (negative-tick) log entries with a `retcon` provenance marker.
2. **The rules:** deterministic (seed + draw), capped (≤1 retcon per household, a bounded fraction of draws
   behind a seeded roll), lineage/family/possessions untouched, never overwriting existing events — only
   *adding* a plausible chapter. The person keeps their real family, childhood, and quirks; they just also
   went to nursing school, which the window's skill install reflects.
