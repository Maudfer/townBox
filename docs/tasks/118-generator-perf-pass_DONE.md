# [Perf] Generator perf pass — the hot band runs 2× faster, the regen unblocks

- **Type:** Performance / Simulation
- **Labels:** `performance`, `simulation`, `generator`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 118.
- **Depends on:** the 078/079 profiling playbook; [105](105-generator-two-band-and-regeneration_DONE.md).

## Goal

The aliveness arc made each agent-step heavier, pushing the default two-band regeneration toward a
multi-hour run. Apply the 078/079 playbook (per-phase `--profile` + V8 `--cpu-prof` as ground truth) to the
post-aliveness hot band, and unblock the maintainer's one full regeneration.

## What shipped

Measured 127.85 → **65.94 µs/agent-step** (1.94×) on the 1-hot-year dev workload; at capacity 150 ~98.68
µs/agent-step. The regeneration drops from the feared ~24 h to roughly 1.5 h. (The proposal's "~1.5
ms/agent-step measured" was stale — the profile found the real structure.)

1. **The whale (~43%):** the generator's "daily" block (`LogicalWorld.runDaily` + `Inventory.sweepExpired`,
   a whole-table spoilage scan) ran once per STEP, and the 105 two-band change made hot-band steps HOURLY —
   so it silently ran 24× per day. It now runs only on steps that cross a day boundary (exactly equivalent
   for the internally day-ranged accruals; the sweeps return to their designed daily cadence).
2. **Agenda whole-table scans (~17%):** `hasPendingRoutine`/`dueEntriesOf` now serve from a per-person id
   index (kept in sync by the mutation points, rebuilt on load) — behavior identical.
3. **The pool roll order:** child entries roll the chance BEFORE evaluating the requirement predicate (the
   079 social-gate lesson) — moves the RNG stream, deterministic per seed.
4. **Free-time/needs:** a one-pass per-need urgency table (`Needs.urgencyByNeed`, identical math) replaces
   the per-candidate re-derivation; each candidate's `satisfies` pairs and the routines sort are hoisted;
   planner adoption is memoized.

Verification: two identical-seed runs produce byte-identical assets (67 files, 0 mismatches); op-count
baselines re-pinned; full suite green. The one full regeneration remains the maintainer's pre-merge step.
