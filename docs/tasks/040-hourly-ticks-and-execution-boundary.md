# [Foundation] Hourly ticks, shared tick lifecycle & the simulation execution boundary

- **Type:** Foundation / Simulation architecture
- **Labels:** `framework`, `simulation`, `clock`, `boundary`, `save-migration`, `enrichment-arc`
- **Depends on:** [039](039-data-schema-registry-and-validators_DONE.md) (validators exist for the configs this touches)
- **Blocks:** 041–048 (everything runs on this lifecycle and context)

## Goal

Three tightly-coupled foundations from [038 §3–§4](038-simulation-enrichment-architecture_DONE.md):

1. **24 ticks per day** — the canonical simulation tick becomes the in-game **hour**.
2. The **shared tick lifecycle** — one deterministic 9-phase per-tick order used identically by live and bootstrap simulation, plus the **append-only log** with per-record timestamps, sequence numbers, and causation ids.
3. The **execution boundary** — an `ExecutionContext` (`mode: 'live' | 'bootstrap'`) with a `WorldAdapter` through which location-dependent behavior requests transitions, instead of scattered `if bootstrap` branches or null-adapter asymmetries.

## Background (verified)

- Tick = **day** today: `Clock.getCurrentTick()` returns the absolute day (`Clock.ts:37`), `ticksPerYear = 360`, mirrored in `json/population.json`; `GameManager` emits `newDay` per rollover (`GameManager.ts:257`) and `timeChanged` per in-game minute (`GameManager.ts:261`). All genealogy ticks (`birthTick`/`deathTick`), history ticks, and `withinDays` windows are in days. There is no hour tick anywhere.
- The per-person "event log" is an **aggregate**, `Record<eventId, {count, lastTick}>` (`types/LifeEvent.ts:72`) — no per-entry seq/causation. See 038 §1.2/§3.3.
- Live passes `{jobMarket, housing, skills, ledger}` to `simulateDay` (`City.ts:376–382`); bootstrap passes `{}` and filters the manifest (`HistoryBootstrap.ts:49–58`). Nothing waits for physical arrival anywhere (038 §1.3).

## Requirements

### A. Hourly ticks
- Redefine `Clock.getCurrentTick()` as the absolute **hour** index; `getTicksPerYear() = 8640`; helpers in `util/time.ts` (`dayOfTick`, `hourOfTick`, formatting). One tick unit everywhere — no dual day/hour scheme.
- `GameManager` emits a per-hour **`newTick`** (name TBD) driving the simulation; `newDay`/`timeChanged` remain for day-cadence consumers (economy month gate, HUD) and are derived from the same clock.
- **Save migration (`SAVE_VERSION` → 8):** multiply every persisted tick by 24 (`birthTick`, `deathTick`, event-history ticks, any `lastSimulatedYear`-adjacent bookkeeping). Update `population.json` `ticksPerYear` and the 039 validator that pins it.
- **Probability:** authored rates are per-*year*; the existing hazard conversion (`EventEngine.ts:240`) parameterizes cleanly (`ticksPerYear` = 8640). `daysPerStep` generalizes to `ticksPerStep`. Per-day-authored semantics, if any appear, convert via `1 − (1 − p)^(1/24)`. Individual review of `withinDays` windows/gradients is task 048's scope — but this task must convert the *units* of existing `withinDays` values mechanically (×24) so behavior is preserved until 048 revisits each.
- **Cadence audit:** `City.handleNewDay` moves to the hourly tick where the lifecycle requires it, while the coarse pool sim (`Population.simulate`) stays yearly and the economy stays monthly. `City.handleCommute` (per-minute) is untouched here (absorbed later by 046/047).
- **Perf budget:** measure engine cost per hourly tick over a representative materialized population before/after; record numbers in the PR. The eligibility index (`indexKeys`) and early-outs must keep the hourly loop affordable.

### B. Shared tick lifecycle + logs
- Implement the 9-phase per-tick order of 038 §3.1 as an explicit, testable sequence (a `TickRunner` the live loop and the bootstrap loop both call). Phases for systems that don't exist yet (actions, brain) are present but empty — 043/046 fill them.
- **Append-only log** (038 §3.3): per-person entries `{seq, tick, kind, defId, bindings/params, triggerSource, causationId, outcome}`; global monotonic `seq` assigned at commit; the old `{count, lastTick}` aggregate becomes a derived index rebuilt on load (keeps `hasEvent` O(1)). Save v8 migrates old aggregates to synthetic entries (documented lossiness: one entry per event id carrying the old count).
- Named RNG sub-streams per subsystem per tick (038 §3.2) so systems don't perturb each other's rolls.

### C. Execution boundary
- `ExecutionContext { mode, world: WorldAdapter, markets }` threaded into `EventEngine.simulateDay` (replacing the loose `adapters` bag) and, later, the Action engine. `mode` is for logging/metrics only — **never** a logic branch.
- `WorldAdapter` v1: `locationOf`, `requestTransition(personId, target, cause) → TransitionHandle`, `peopleAt`, and the `LogicalLocation` model (`home | workplace(id) | venue(kind) | outside`). Live implementation backs it with the map + the existing commute machinery (`City.startCommute`, `TravelStep`), resolving handles on arrival; bootstrap implementation resolves handles **immediately** and keeps logical locations in memory — both emit identical lifecycle records.
- Retire `bootstrapManifest()`'s silent event filter and the empty-adapters asymmetry: the bootstrap path receives a full `ExecutionContext` (bootstrap market implementations may be minimal at this stage — the point is the *shape* is symmetric; [055](055-history-asset-pipeline.md) fleshes the offline world out).

## Non-goals

Actions, Brain, objects, triggers (041–047). Retiring the coarse pool sim. HUD redesign (clock widget keeps working; small format tweaks OK).

## Testing

- `util/time.ts` pure-function tests for hour ticks; migration test: a v7 snapshot loads with ×24 ticks and identical derived ages/recency.
- Determinism: same seed → identical log (entries + seqs) across two runs, and across live-loop vs. bootstrap-loop invocations of the `TickRunner` on the same pool.
- Boundary: a fake action/event requesting a transition in bootstrap mode resolves same-tick with arrival records; in live mode (scene-free test with a stubbed commute) it stays pending until the handle is flipped, then produces the *same* records.
- Hazard math: yearly likelihood preserved within tolerance when stepping hourly vs. daily.
