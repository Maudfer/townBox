# [Perf] Offline history-generator — the brain/actions per-agent pass

- **Type:** Performance / Simulation + Tooling
- **Labels:** `performance`, `simulation`, `generator`, `078-followup`
- **Status:** ✅ Done
- **Depends on:** [078](078-offline-generator-perf-optimization_DONE.md) (the `activeInstanceOf` index +
  terminal-instance pruning + reduced manifest; and the coarse `--profile` mode).
- **Context (read first):** [`docs/planning/offline-generator-performance.md`](../planning/offline-generator-performance.md)
  §10 (the post-078 baseline + this pass's targets) and §11 (this task's results).

## Goal

After 078 killed the unbounded `activeInstanceOf` scan, per-agent cost sat at **~0.21 ms/agent-step**, split
`brain` ~60% / `actions` ~37% (§10). This task drives that down further — **profiling first** (§10's explicit
mandate: the 078 ranked hypotheses were wrong until a profiler proved otherwise), then fixing whatever the finer
profiler actually fingers, **without changing the generated asset** (live play and the `arcScenarios` keystone
stay on the full behavior; a fixed-seed asset must stay byte-identical, so `generatorVersion` does not bump).

## What shipped

1. **Finer `--profile`.** `TickProfiler` (`game/TickRunner`) gained an optional `SubProfiler`
   (`types/Execution.ts`) that Brain and the ActionEngine accumulate into: **per-Brain-hook** wall-clock +
   `resolveIntents`, and **per-advance-sub-phase** (scan / aliveOrDead / materialize / spine / pool / sequence /
   completeWhen / durationFinish), with `finish()` split internally (consequence-plan / log / onComplete event).
   Threaded through `HistoryAsset` into `meta.stats.profile` and printed by the CLI. Null-clock when off → zero
   overhead in live play; timing never touches logic, so determinism is untouched.

2. **The profiler found two costs §10 mis-ranked:**
   - **`invoke` on the action-completion path.** At daily cadence a free-time action started one step completes
     the next → fires its `onComplete` manual event via `EventEngine.invoke`, whose per-call cost was dominated
     by `Object.keys(state.people).filter(isAliveAt).sort()` — the **whole pool incl. the dead**, rebuilt every
     call and **growing over the run** (a 078-style trap, hidden one layer down in an *event* call the `actions`
     bucket paid for) — plus a `fakerPT_BR.seed()` every call. **72 → ~10.6 µs.**
   - **Doubled free-time selection.** `wokeUp` and `idleFallback` both call `selectFreeTimeAction` for the same
     idle-just-woken person the same step, computing the **identical** deterministic pick twice. **86.7 → ~40 µs.**

3. **Fixes (all byte-identical):**
   - **`invoke` fast paths** — precompute per event `invokeNeedsCandidateSearch` (any role with a `where` search)
     and `invokeUsesFaker` (any `birth` effect); build the living-agent list only for the former, seed faker only
     for the latter. Unused agents were never iterated and faker is drawn only by birth → invisible.
   - **Per-(person, tick) free-time memo** on `Brain` (transient, not serialized — Brain stays stateless).
   - **Per-context memos** in `ActionEngine.contextFor` (attribute / objects-here / carried-list, cached per
     context since the person is immutable for its life).
   - **Social candidate precompute** in `SocialOpportunity` (a per-manifest `WeakMap` of the ~19 person-targeted
     actions, mirroring `Brain.freeTimeCandidates`).

## Result

**~54% faster** at daily cadence (206 → ~98 µs/agent-step at 250 agents), and the completion path no longer
grows with the accumulating deceased pool. Verified two ways: the full unit suite passes (incl. the
`arcScenarios` live↔bootstrap keystone and the `eventEligibility` bit-identical invariant), and a fixed-seed
generated asset hashes **byte-identical** to `main`. New regression tests: the per-context memo isolation
(`test/actionEngine.test.ts`) and the unpinned-`where`-role candidate search through `invoke`
(`test/eventTriggers.test.ts`).

## Pass 2 (same session — planning doc §12)

A second pass pushed **~98 → ~54 µs/agent-step** (4× under the §10 baseline overall), still byte-identical
(`generatorVersion` unchanged; fixed-seed hash == `main`). Method: hook-internal segment timers
(`HookContext.sub`) plus **V8 `--cpu-prof` as ground truth** when a bracket read 1000× its micro-benched cost.
Finds: (1) a real bug in pass 1 — `invokeNeedsCandidateSearch` included the **subject** role's `where`, so the
O(whole-pool) agent build still ran on every invoke (pass 1's win had actually come from the faker gate);
(2) `socialOpportunityHook` computed `peopleAt` (the run's hottest function) before its 15% RNG gate — rolling
first is byte-identical and skips 85% of the queries; (3) repeated pure reads → three cache layers:
per-containerKey-invalidated `Inventory.contentsOf`/`carriedInstances` caches + mutation/container epochs, an
engine-level `objectAtLocation` query cache validated per location epoch, and a one-entry proposal-phase context
memo (person/tick/backing/epoch-keyed, dropped at every mutation point). Regression tests cover the cache
invalidation and memo semantics. Projected 1000/250 daily ≈ ~1.7 h.

## Follow-ups (not done here)

Remaining cost is the predicate-interpreter floor over the free-time candidates (~17 µs) and few-µs hook
residuals. The next lever, if ever needed: **predicate precompilation** (JSON AST → closures, once per
manifest), est. ~2× on that slice. Profile first — this task went three-for-three on ranked guesses being wrong.
