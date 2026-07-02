# [Feature] Pre-game history bootstrap (detailed fast-forward simulation)

- **Type:** Feature / Simulation + Architecture
- **Labels:** `feature`, `simulation`, `framework-followup`, `strategic`
- **Depends on:** 013 (event engine + coarse pool). Best after 015/032 so histories are rich.
- **Status:** ✅ **Done.** On a new game, `GameManager.runBootstrap` runs the detailed Engine B over the whole
  living pool for a configurable recent span (`json/bootstrap.json`: `years`/`stepDays`) in a **Web Worker**
  (`bootstrap.worker.ts` via a dynamically-imported `bootstrapWorkerFactory`, so the `import.meta` worker URL
  stays out of the CommonJS/ts-jest path), behind a `BootstrapLoader` overlay with progress; the resulting pool
  + event history install into the live engine, so drawn households have real histories (no cold start). Pure
  core is `game/HistoryBootstrap.ts` (deterministic per world seed; tested). A load skips the bootstrap; the
  bootstrapped pool/history serialize normally (no save-version change).
  - **Feasibility findings (measured):** the per-day engine over the ~3k-living pool is ~17s/simulated-year
    daily; a whole-pool *centuries* sim is minutes-to-hours (the living population is thousands and **grows** as
    event-driven births compound), so "centuries in tolerable load" is not achievable with the current
    engine/pool. Two mitigations landed: `marriage` (the only O(agents) candidate-search event) is **excluded**
    from the bootstrap manifest — generation already lays the marriage backbone — keeping it linear; and
    `EventEngine.simulateDay` gained an optional **`daysPerStep`** hazard multiplier (default 1, no effect on
    live play) so the bootstrap steps weekly with correct probabilities. The default span is a modest **8 years
    (weekly, ~18s)** — enough to remove the cold start — with `years` as the depth/load knob.
  - **Reconciliation (req. 3):** chose **(a) staged toward (b)** — the bootstrap seeds the pre-game history and
    anchors `lastSimulatedYear`; the coarse `Population.simulate` still runs for off-map people during play.
    Full one-fidelity (retiring the coarse live sim) needs the engine to run over the whole pool each day live,
    gated on the same perf work (bounded population growth + an incremental living index + the `marriage`
    role-search optimisation) — documented as the follow-up.

## Summary

Before a new game starts, **fast-forward the population through the detailed event engine for a long span
(e.g. a few centuries)** on a loading screen, so that when households are drawn, their members arrive with
**real life histories** instead of a blank slate. This resolves the materialization cold-start that 013
deliberately accepted (`docs/tasks/013` §1 decision 5) and is the long-term path to **replacing the coarse
off-map pool sim** with one consistent simulation.

## Background / current state (verified)

- Today there are **two fidelities** (`docs/tasks/013` §1 decision 4): the coarse yearly `Population.simulate`
  over the off-map pool (hardcoded-ish mortality/fertility) and the per-day `EventEngine` over **materialized**
  people only. A freshly placed household's members have **no event history** (`EventEngine` history is empty
  for them), so history-gated events (e.g. pregnancy needing `had_sex`) can't fire until they occur live —
  the accepted cold-start.
- `generatePopulation` (`game/Population.ts`) creates the pool deterministically at new-save (founders →
  generations, lifespans). `EventEngine.simulateDay(state, agentIds, tick, ticksPerYear)` already runs the full
  resolver over an arbitrary agent set against the pool — it is **not** intrinsically limited to materialized
  people; `City` just feeds it the materialized ids.
- New-game flow: `GameManager` generates the pool in `postSceneInit` (when `pendingLoad === null`);
  `TitleScene` "Start Game" → `transitionToGame` → `MainScene`. There is no loading/bootstrap step between
  generation and gameplay. `EventEngine` history serializes (save v5).

## Goals / Requirements

1. **Add a bootstrap phase** that, on **new game** (not on load), runs the detailed `EventEngine` over the
   **whole living pool** for a configurable number of in-game years (data-driven, e.g.
   `json/economy.json`/a new `bootstrap.json`: `years`, batching). Advance day-by-day (or an optimised
   coarser-but-still-event-driven cadence) so the engine records histories, partnerships, deaths, births, etc.
   across the pool — producing a living population with plausible pasts.
2. **Performance.** This is the explicit "trade space/CPU on a loading screen" pass — it may be expensive.
   Run it **off the frame loop** (e.g. chunked with progress, in a worker if needed) so the UI can show a
   loading screen. Target: bootstrap a 10k-ish pool over centuries in a tolerable load time; document the
   achieved budget and the knobs.
3. **Reconcile the two fidelities.** Decide the end-state: either (a) the bootstrap is a one-off seed and the
   coarse `Population.simulate` continues for off-map people during play, or (b) the detailed engine becomes
   the single sim for the whole pool and the coarse path is retired. Recommended direction: (b) over time —
   at minimum make the bootstrap consistent with live play so there's no visible discontinuity at
   materialization. Document the chosen path; full coarse-pool retirement can be a follow-up.
4. **Loading screen UX.** Add a bootstrap/loading scene or overlay between `TitleScene` "Start Game" and
   `MainScene` showing progress (years simulated, population). Reuse `TitleScene` styling.
5. **Determinism & save.** The bootstrap is a deterministic function of the world seed; the resulting pool +
   event history serialize so a save captures the bootstrapped world (loads must **not** re-run the
   bootstrap).
6. **Scale guard.** Running the full engine over thousands of people per day for centuries is the heaviest
   thing in the project — profile it, and provide config to scale the span/pool for lower-end machines.

## Out of scope

- Rendering any of the bootstrap (it's pre-materialization; nothing is on the map yet).
- A full rewrite of `Population.simulate` in this task (retiring the coarse path can be a follow-up once the
  bootstrap proves out).

## Acceptance criteria

- Starting a new game runs a deterministic detailed bootstrap over the pool behind a loading screen, after
  which drawn households' members have real event histories (e.g. adults plausibly have `had_sex`/marriage/job
  history), removing the cold-start.
- The bootstrap runs off the frame loop with visible progress and a documented performance budget/knobs.
- Loads do not re-run the bootstrap; the bootstrapped world round-trips through save/load.
- `npm test` passes with tests asserting determinism and that post-bootstrap pool people carry history.

## Notes

- This is the most computationally ambitious task and the strategic key to one-fidelity simulation. It pairs
  with the §1-decision-4 note that the coarse pool is "slated for replacement" — this is that replacement's
  foundation. Land the cheaper loop-wiring (014–031) first; this makes the *existing* world deeper rather than
  enabling new wiring.
