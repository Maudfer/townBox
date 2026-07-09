# [Perf] Offline history-generator — per-agent step-cost optimization

- **Type:** Performance / Simulation + Tooling
- **Labels:** `performance`, `simulation`, `generator`, `077-followup`
- **Depends on:** [077](077-offline-logical-economy-world.md) (the offline logical-economy generator + streaming).
- **Context (read first):** [`docs/planning/offline-generator-performance.md`](../planning/offline-generator-performance.md)
  — a detailed dump of the generator's per-tick mechanics, the determinism constraints, every benchmark we ran,
  the rates, what's already optimized, and the ranked optimization opportunities this task pursues.

## Goal

Make `npm run generate-history` (task 077) **dramatically faster at daily cadence**. After the co-location fix
(a location→people index that removed the O(agents²) social-hook scan), the runtime driver is now the raw
**per-agent step cost (~5–7 ms/agent/step)**. At 1,000 agents daily that is ~7–8 days for a 250-year run; the
current default was cut to 250/100 (~15 h) partly to sidestep this. This task attacks the per-agent cost itself
so larger canonical assets (1,000/250, 2,000/500) become practical.

## Scope (from the planning doc's ranked opportunities)

1. **Add a `--profile` mode first** — phase timers around action-advance / event-walk / brain / `runDaily` so
   attribution is exact (the planning doc's estimates are hypotheses). Everything below is *benchmark-driven*.
2. **Reduced generator event manifest (likely the biggest win).** The ~680 effect-free **texture events** are
   already dropped from the persisted asset (not `loggableEventIds`) yet still cost one RNG draw per event per
   agent per tick plus commit/dispatch overhead. Run the generator against a **reduced manifest** = events that
   are effect-bearing ∪ requirement-referenced ∪ manually-invoked-by-the-logical-world (`get_job`/`layoff`/
   `started_school`/`graduated_school`/`got_promoted`/education/illness/marriage/birth/death/…). Expect
   ~10–25× fewer probabilistic evaluations. **Caveats:** it changes the RNG stream (asset differs from a
   full-manifest run — still deterministic per seed; bump `generatorVersion`, gate behind a config flag,
   document). Precisely derive the "safe to drop" set (no `effects`, no consumed `signal`, not `hasEvent`-
   referenced by a kept event). The live↔bootstrap keystone uses the full manifest in both modes, so it won't
   regress.
3. **Brain free-time selection.** `Brain.selectFreeTimeAction` scans the ~260-action leisure manifest with
   predicate + modifier evaluation **per idle person per tick**. Reduce it: static-gate pre-filtering,
   memoized/precompiled candidate lists, or re-select only when the person's context signature changes. Keep
   the seeded weighted pick deterministic.
4. **Micro-optimizations** (`LogicalWorld.runDaily` and friends): iterate the living set (not all
   `homeKeyOf.keys()` incl. dead), precompute a job title→definition map, avoid per-step re-sorts/allocations.
5. **(Stretch) worker-sharded parallelism** — only if 2–4 don't get there; needs a deterministic merge + fixed
   draw order. Likely out of scope for a first pass.

## Constraints

- **Determinism preserved** per (seed, params, generatorVersion): same inputs → byte-identical asset. Reduced
  manifest / any stream change bumps `generatorVersion` and is documented.
- **No regression to live play or the live↔bootstrap keystone** (`test/arcScenarios.test.ts`): generator-only
  fast paths must be gated so live and the equivalence test keep the full manifest / full behavior.
- **Correctness of the asset content**: skills/careers/possessions/histories the game consumes must be
  unchanged in *kind* (a reduced manifest legitimately changes *which* texture events happened, but must not
  drop vital events, skills, jobs, or histories the game relies on).

## Acceptance criteria

- A `--profile` run attributes per-agent cost to phases, checked into the planning doc.
- The reduced-manifest mode (or whatever the profiling shows is the win) lands behind a config flag, with a
  measured **before/after ms/agent/step** at ≥3 agent counts (e.g. ~60 / ~400 / ~800) recorded in the docs.
- Target: a **≥3–5× per-agent speedup** at daily cadence (stretch: enough that 1,000/250 daily is < ~2 days).
- `npm test` green (incl. a determinism test for the new mode), `npm run typecheck` clean, docs updated
  (`generatorVersion`, the 077 table, the planning doc's "current default"/benchmarks).

## Out of scope

- Live-play per-tick perf (the live sim runs over materialized agents only; the generator runs the whole pool —
  different regime). Any shared win is a bonus, not the target.
- Changing the simulation's *fidelity* (event/action content) for live play.

---

## Delivered

Merged as task 078 (generator `078.0`). Full write-up in
[`docs/planning/offline-generator-performance.md` §9](../planning/offline-generator-performance.md).

- **`--profile` mode** (acceptance #1): per-phase timers thread through `TickRunner` (`TickProfiler`) into
  `HistoryAsset`'s `meta.stats.profile` (µs/agent-step + share), printed by the CLI (`--profile`). Zero overhead
  when off; timing never affects logic (determinism preserved).
- **Profiling inverted the §6 ranking.** The driver was **not** the event walk (a ~0.3% rounding error) but
  `ActionEngine.activeInstanceOf` scanning **every continuous instance ever created** (~2,700/call after 27
  steps, growing unbounded — terminal instances were never pruned), called ~5×/agent/tick by Brain's `statusOf`
  → ~97% of per-agent cost.
- **Fix:** an O(1) **active-instance index** + **terminal-instance pruning** in `ActionEngine` (both
  behaviour-identical; index rebuilt on load). Plus the **reduced event manifest** (§6 #2, `reducedEventManifest`,
  default on, `--full-manifest` to disable — a secondary 2–3× cut of the event phase) and the §6 #4 micro-opts
  (`LogicalWorld.runDaily` iterates the living set, precomputed job title→def map, `Brain` static candidate list).
- **Result (acceptance #2/#3):** measured **ms/agent/step** at ~60/~400/~800 agents daily: **2.68→0.20**,
  **2.82→0.22**, **3.03→0.27** — **~11–13×**, and now *flat* over the run (was growing). Projected 1000/250
  daily ≈ ~7 h (was ~7–8 days) — stretch goal met, and the memory wall that would have OOM'd the big assets is
  gone.
- **Determinism/no-regression:** `generatorVersion` bumped to `078.0`; reduced mode gated behind a flag, live
  play + the `arcScenarios` live↔bootstrap keystone keep the full manifest. New tests: reduced-mode determinism
  (logical world on), reduced/full content parity, `--profile` determinism, and the ActionEngine index/pruning
  invariants (incl. load rebuild). `npm test` (631) green, `npm run typecheck` clean.
