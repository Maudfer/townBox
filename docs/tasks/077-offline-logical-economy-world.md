# [Feature] Offline logical-economy world — off-map jobs/schools/objects during history generation

> ## ✅ Delivered (this PR)
>
> **Landed & tested (`npm test` 620 green, `npm run typecheck` clean):**
> - **`game/LogicalWorld.ts`** — the headless analogue of `City.handleTick`'s tick assembly: a `WorldAdapter`
>   with per-person **logical homes** (a partner joins their partner, a child joins a parent — per-home object
>   pools + co-location), reusing `Inventory`/`SkillBook`/`SchoolRegistry.sweep`/`generateBuildingObjects`, plus
>   a scene-free **`LogicalJobMarket`** (ports `game/JobMarket.ts`'s rank-match + atomic grant-on-hire, no-farm).
> - **Direct per-step progression accrual (§3 crux).** The generator steps coarsely (monthly) for runtime, but
>   school/work progression is normally intra-day shift-driven (`isOnShiftAtTick`) which coarse stepping can't
>   hit. So `LogicalWorld.runDaily` drives **direct accrual** — `schoolDailyGain`/`WORK_DAILY_GAIN` × days
>   elapsed in the step — reproducing the same per-day numbers, stepping-tolerant. Hiring stays event-driven
>   (`get_job`, probabilistic → stepping-tolerant); promotions fire `got_promoted` through the engine.
> - **The asset carries lived skills + carried possessions** (`HistoryAsset.skillBook`/`objects`), wired behind
>   `historyGenerator.json` `logicalWorld.{enabled,homes,schools,jobs,objects}` (default on; disabled = the 055
>   pool-intrinsic spine). Deterministic per `(seed, params)`.
> - **Part B consumes them** — `HistoryAssetSelection.sliceAndRebase` filters skills/possessions to the retained
>   cohort and rebases ticks; `GameManager.startNewGameWorld` installs the `SkillBook` (its `initialized` set
>   makes `City.setupHousehold.initialize()` a no-op for asset people, preserving their real proficiency) + the
>   carried `Inventory`. People arrive **unemployed but skilled with real careers-as-history**; the live
>   `JobMarket` re-hires them (§2 — logical employers are map-less).
> - **Per-window skill snapshotting (the follow-up, now folded in).** Skills are no longer an end-of-generation
>   snapshot: the generator records a per-person **skill timeline** (`SkillTimeline`, snapshotted every
>   `skillSnapshotYears`, dedup'd by a proficiency signature so static-skill people keep one entry), and
>   `HistoryAssetSelection` installs each drawn person's snapshot **as of the window `w`** — so their job skills
>   match their windowed age instead of their end-of-life proficiency. A person with no snapshot ≤ `w` (a young
>   child born after the last snapshot) falls back to `City.setupHousehold`'s age-appropriate `initialize()`.
> - Tests: `test/logicalWorld.test.ts` (homes, adapter, direct school accrual, carried-inventory filtering,
>   per-window snapshot selection, end-to-end generator determinism + career progression).
>
> **Streaming to sharded files (RAM-bounded generation + chunked loading).** The generator no longer holds the
> whole centuries-long history in RAM: the two big, ever-growing sections (event log + skill timeline) are
> DRAINED to compressed disk **shards** every `flushIntervalYears` via a `HistoryAssetSink` (`LifeLog.drain` /
> `LogicalWorld.drainSkillTimeline`; the aggregate history the sim reads is untouched, so `hasEvent` keeps
> working). The asset is now a **directory** — a small `meta.json` header + `population`/`objects`/
> `eventHistory` sections + `log-*`/`skills-*` shards, each shard carrying its tick range. New-game selection
> (`selectStartingWorldFromShards`) reads **only the shards up to the chosen window `w`** (future shards never
> fetched), so both generation and browser loading stay memory-bounded, and a multi-GB asset splits into
> git-friendly chunks (no LFS). Streamed↔in-memory selection equivalence is pinned by `test/logicalWorld.test.ts`.
>
> **Bounded, non-exponential population.** Two mechanisms replace the old logistic carrying capacity so
> population is *stable*, not exponential:
> - **Per-person `maxChildren`** (`types/Genealogy.GenPerson`, sampled at creation from `util/fertility` — a
>   distribution mounding on 2–4 (~70%), 0–6 tails). Gates pregnancy via the new `wantsMoreChildren` Context
>   attribute (and the coarse off-map sim mirrors it), so a couple stops at their innate willingness regardless
>   of probability. Applies in live play too. Save v13 backfills legacy people deterministically.
> - **A global fertility multiplier** on the pregnancy hazard (`EventEngine.setProbabilityScale`; 0 = nobody
>   has children, 1 = no influence). Live play leaves it at 1; the offline generator drives it with a
>   **population thermostat** — AC-style **hysteresis** (`PopulationThermostat`): suppress above the high pivot
>   `target·(1+band)`, allow below the low pivot `target·(1−band)`, HOLD between (no chatter around a single
>   setpoint). Verified to grow to `target` and hold within the band instead of ballooning.
>
> **Co-location perf fix.** `LogicalWorld.peopleAt` was an O(agents) scan called once per idle person per tick
> by the social hook → **O(agents²)/step**, the daily bottleneck. It now uses a **reverse location→people
> index** (`byLocationKey`, maintained on home-assignment / transition / death), making `peopleAt` O(occupants)
> and the whole step near-linear. Behavior-preserving (same sorted ids → identical asset). Measured
> per-agent-per-step: **4.0 ms @ 63 agents → 5.4 @ 402 → 6.2 @ 801** (a pure quadratic term would have hit
> ~50 ms/agent at 800).
>
> **Defaults** (`json/historyGenerator.json`): the richest asset the budget allows — daily stepping, logical
> economy fully on, yearly skill snapshots, **and the full action log kept** — over **250 living × 100 years**
> (thermostat `target` 250, ±5% band); begins and holds ~250 living. At this scale the action log fits (~560 MB
> < 2 GB), so the default asset carries full per-tick action texture. `--no-action-log` drops it (~29 MB).
>
> ### Measured size + runtime estimates for a full 250/100 run (compressed on disk; ±~40%)
>
> | Scenario | Flags | Asset size | Est. runtime |
> |---|---|---|---|
> | **Default** (daily · full action log · yearly snaps) | *(none)* | **~560 MB** | **~15 h** |
> | Events-only | `--no-action-log` | **~29 MB** | ~15 h |
> | Coarser snapshots | `--snapshot-years 5` | **~550 MB** | ~15 h |
> | **Feasible / fast** | `--step-days 30 --no-action-log` | **~15 MB** | **~30 min** |
>
> (~31k living-person-years, ~600 retained people. Log ~584 B/py events-only daily · ~17.7 KB/py with actions;
> skill timeline ~330 B/py yearly; objects ~200 B/person — all compressed. ~5 ms/agent/step at ~250 agents.)
> 250/100 daily is **overnight-feasible** (~15 h). Larger canonical assets (1,000/250 ≈ ~270 MB / ~7–8 days;
> 2,000/500 ≈ ~1 GB / ~3 weeks) remain available via flags. RAM stays bounded (~one flush interval) in every
> scenario. **The per-agent step cost (~5 ms) is now the runtime driver — the co-location O(agents²) is fixed;
> further speedups target the per-agent work itself (see the perf task 078).**
>
> Everything below is the original ticket.

- **Type:** Feature / Simulation + Architecture
- **Labels:** `feature`, `simulation`, `framework`, `asset`, `055-followup`
- **Depends on:** [055](055-history-asset-pipeline.md) (the offline generator + asset-fed new game — landed, PR #84),
  [040](040-hourly-ticks-and-execution-boundary_DONE.md) (the execution boundary / `ExecutionContext`),
  [063](063-school-day-skill-progression_DONE.md)/[065](065-job-skill-progression-and-promotion_DONE.md) (the
  `SkillProgression` service), [064](064-job-ranks-and-training-grants_DONE.md)/[066](066-jobs-ranks-data-backfill_DONE.md)
  (job ranks), [070](070-contextual-object-generation_DONE.md) (`generateBuildingObjects`),
  [075](075-progression-arc-validation-and-docs_DONE.md) (the live↔bootstrap equivalence keystone).

## 0. Why this exists

Task 055 delivered the offline history-asset **pipeline** at **pool-intrinsic** fidelity: the generator
(`game/HistoryAsset.ts`) runs the shared `TickRunner` in `bootstrap` mode with a bare spine — a plain
`BootstrapWorld`, **no markets, no `jobOf`/`schoolOf` facts, no `SkillProgression`, no `Inventory`**. So the
asset captures birth/death/marriage/pregnancy/illness/education-as-record/social, but **skills, careers, and
possessions are NOT simulated off-map** — they materialize at draw via `SkillBook.initialize` (age-appropriate
synthesis), exactly as live play does today.

This task closes that gap: run the **whole progression loop off-map during generation** — logical schools (so
children earn calendar-exact school proficiency), logical jobs (so adults get hired, progress rank skills, and
get promoted, producing real career event histories), and object generation (so people accumulate real
Possessions) — and carry the results (`SkillBook`, person-carried `Inventory`) into the asset so drawn people
arrive with genuinely lived skills/careers/possessions instead of synthesized ones.

**The machinery already runs in `bootstrap` mode** — `test/arcScenarios.test.ts` ("live ↔ bootstrap equivalence")
already drives school-day progression, `SkillProgression`, and `generateBuildingObjects` through a
`BootstrapWorld` + `runTick`. What's missing is a **logical world** that *assembles* those facts/adapters at
generation scale (thousands of agents, centuries), the way `City.handleTick` assembles them for live play.

## 1. Background / current state (verified)

- **The live tick assembly is the blueprint.** `City.handleTick` (`src/app/game/City.ts:618`) builds, per tick:
  `jobMarket` (`new JobMarket(personByGenId, field, skillBook, tick)`), `housing` (`new HousingMarket(...)`),
  `skills` (`new SkillRegistry(skillBook, tick)`), `skillProgression`, and the closures `employerKeyOf`,
  `jobOf`, `schoolOf`, `jobAssignmentOf` — then calls `runTick(...)` with `ctx.markets` + those facts. The
  generator must assemble the **logical equivalents**.
- **Field-coupled adapters need logical reimplementations.** `game/JobMarket.ts` reads `field.getStructures()`,
  `person.work.getJob()`, `person.social.getHome().getPosition()`, `workplace.hire/getOpenPositions`;
  `game/HousingMarket.ts` reads `House`/`Person`. Off-map there is no `Field`/`Workplace`/`Person`. Both
  implement small interfaces (`types/LifeEvent.ts` `JobMarket` = `isEmployed/canHire/hire/fire`; `HousingMarket`
  = `canMoveOut`), so a logical world can back them with plain state.
- **Scene-free systems reuse as-is:** `SkillBook` (init/grant/progression, serializable),
  `SkillProgression` (`processCommits`, needs `jobAssignmentOf` returning a mutable `JobPosition`),
  `SkillRegistry` (needs only `SkillBook` + tick), `SchoolRegistry.sweep` (already logical — takes
  `SchoolSeat[]`/`SchoolCandidate[]`, `position: null` off-map), `generateBuildingObjects` (takes an
  `anchorKey`/`tags`/`host`, writes to an `Inventory`), `BusinessGen.generateBusiness` (pure), the Brain hooks
  (`jobOrchestratorHook`/`schoolObligationHook` already read `deps.jobOf`/`deps.schoolOf`).
- **The Brain facts contract:** `game/Brain.ts` `JobFacts` (shift/workplaceKey/rank/continuousActions/
  discreteActions) and `types/School.ts` `SchoolFacts`; `TickRunner.TickPlan` already accepts `jobOf`,
  `schoolOf`, `employerKeyOf`, `jobAssignmentOf`, `skillProgression`, `inventory` (`src/app/game/TickRunner.ts:29`).
  So **no engine/TickRunner change is required** — this is a matter of building a producer of those facts.
- **The asset today** (`game/HistoryAsset.ts` `HistoryAsset`) carries `population` + `eventHistory` +
  `eventLog` (slimmed to loggable events) + `eventSchedule`. It does **not** carry `SkillBook`/`Inventory`.
- **The consume point at draw** is `City.setupHousehold` (`src/app/game/City.ts:249`): it calls
  `Game.skillBook?.initialize(memberId, …)` (idempotent via the `initialized` set) and `fillBuildingObjects`.
  `game/HistoryAssetSource.ts`/`HistoryAssetSelection.ts` + `GameManager.startNewGameWorld` install the asset.

## 2. Key design decision — what the asset carries (and what it does NOT)

The asset's people have careers **at logical off-map businesses that do not exist on the player's map**. So:

- **DO carry:** `SkillBook` state (real lived proficiency — school + job progression), person-**carried**
  `Inventory` (Possessions accumulated off-map), and the event log (already carries `got_job`/`got_promoted`/
  `started_school`/… — verify these are in the loggable set, i.e. effect-bearing or requirement-referenced).
- **DO NOT carry live job assignments / employer references.** A drawn person arrives **unemployed but
  skilled**, with the career as *history + proficiency*; the live `JobMarket` re-hires them into a **real** map
  job matching their asset-earned skills (a seasoned worker strict-qualifies at a higher rank — the intended
  behaviour). Building fixtures are per-map-building and keep regenerating via `fillBuildingObjects`; only
  person-carried loose items travel.

This makes Part B a clean install (load `SkillBook` + carried `Inventory`) with **no logical-employer or
logical-building materialization** — the hard part is confined to *generation*.

## 3. Part A — the logical world (generation side)

Build a `game/LogicalWorld.ts` that owns the off-map state and produces the `ExecutionContext` + facts the
generator's `runTick` needs. Deterministic (seeded from the world seed), scene-free, serializable enough for the
asset. Suggested subsystems (each independently testable; gate risky ones behind config so a bad layer can ship
disabled per 055's pattern):

1. **Logical homes** — assign every person a home key (for object pools + co-location). Births → mother's home.
   Optional light churn on `movedOut`/`partnershipFormed` signals (or keep static; living arrangements are
   redrawn fresh at play, so off-map churn need not carry over). Backs `objectLocationOf`/`peopleAt`/`register`
   (extend or wrap `BootstrapWorld`).
2. **Logical businesses + jobs** — generate a pool of businesses (`BusinessGen.generateBusiness` over
   `json/businesses.json`) sized to the living count, with `JobPosition`s. A **`LogicalJobMarket`** implementing
   `isEmployed/canHire/hire/fire` over per-person logical assignments (port the rank-match logic from
   `game/JobMarket.ts` — strict rank then the entry `entryTrainingGrant` shortcut via `SkillBook.grantClosure`;
   this is the load-bearing reuse). Provide `jobOf`/`employerKeyOf`/`jobAssignmentOf` (a **mutable**
   `JobPosition` per person so `SkillProgression.awardWorkDay` can bump counters + promote).
3. **Logical schools** — a set of logical `school` buildings; drive `SchoolRegistry.sweep` on the day cadence
   (`SchoolCandidate`/`SchoolSeat` with `position: null`); provide `schoolOf` (`SchoolFacts`) so
   `schoolObligationHook` fires `attend_school` → `completed_school_day` → `SkillProgression.awardSchoolDay`.
4. **Object generation** — run `generateBuildingObjects` for logical homes/venues into a shared `Inventory`, so
   the inventory hook + context-grounded actions have real objects and Possessions accumulate.
5. **Wire into the generator** — `HistoryAsset.generateHistoryAsset` builds the `LogicalWorld` and passes the
   full plan to `runTick` (markets `{ jobMarket, skills, housing }`, `skillProgression`, `inventory`, and the
   fact closures), mirroring `City.handleTick`. `SkillBook.initialize` runs when a person **enters** the sim
   (founders at t0; newborns at birth) using `JOB_CORE_SKILLS` = `new Set(Object.values(JOBS).flatMap(j => j.requiredSkills ?? []))`.

**Cadence note:** job/school day-completion events (`stopped_working`, `completed_school_day`) are per-day; the
day-cadence sweeps (school enrollment, promotion evaluation) must fire correctly under the generator's
`daysPerStep` stepping (the engine already scales hazards per `ticksPerStep`; verify the day-boundary logic).

## 4. Part B — carry + consume at draw

- Extend `HistoryAsset` to carry `skillBook: SkillBookState` and person-carried `objects: InventoryState`
  (carried instances only; drop building-fixture instances). Rebase/slice must handle them: on window select,
  keep only retained people's records; skills/possessions are tick-light (records carry acquisition ticks —
  rebase those). Bump `HISTORY_GENERATOR_VERSION` and the asset `formatVersion`.
- `GameManager.startNewGameWorld` installs the selected `SkillBook` (`Game.skillBook.loadState`) and carried
  `Inventory` before households are ever drawn. Because the loaded `SkillBook` marks asset people `initialized`,
  `City.setupHousehold`'s `initialize` call becomes a **no-op for them** — preserving their lived skills — while
  still seeding freshly cold-started or immigrant people. Possessions: apply carried instances to the drawn
  `Person`. **No employer/job is restored** (§2).
- Fallback unchanged: no asset → cold-start (`SkillBook.initialize` at draw as today).

## 5. The equivalence contract (must hold)

`test/arcScenarios.test.ts`'s "live ↔ bootstrap equivalence (the keystone for 055)" must stay green: a child
simulated through the logical world must reach **identical skill outcomes** to live play, modulo
arrival/commute-latency tick offsets (the accepted divergence). Add a scaled version proving a person hired +
promoted off-map ends with the same rank/skills a live run would. Determinism: same `(seed, params)` → identical
asset, including skills/possessions.

## 6. Closed-loop check (gaps to patch during implementation)

- **Reachability:** a fresh 18-year-old with logical-school basics@≤60 must reach every job's entry rank via the
  training grant (the CI reachability rule) — confirm the logical `JobMarket` honours it.
- **No skill farming:** the entry grant applies only inside a successful hire (as `game/JobMarket.ts` does) —
  the logical port must preserve the atomic grant-on-hire, not grant on evaluation.
- **Loggable career events:** `got_job`/`got_promoted`/`started_school`/`graduated_school`/`stopped_working`
  must survive the asset's log slimming (`loggableEventIds`) — they carry effects/signals, so they should;
  assert it.
- **Population scale vs. jobs:** the logical business pool must offer enough positions across categories that a
  realistic fraction of adults are employed (otherwise careers never progress); size it to the living count.
- **Determinism at scale:** the incremental living index + carrying capacity from 055 must remain pure with the
  logical world layered on (no RNG stream perturbation of the event walk — the logical world forks its own).
- **Runtime:** the added per-tick work (job market rebuild, school sweep, object gen) must not blow the ~15h
  budget for a full run; the logical `JobMarket`/sweep should be incremental, not rebuilt from scratch each step
  where avoidable.

## 7. Out of scope

- Off-map **economy/money** (wages, cost of living, P&L) — no economy off-map; `markets.ledger` stays null,
  money events ineligible (unchanged from 055 §8). Skills/careers progress without money.
- Restoring live employment from the asset (§2 — people arrive unemployed-but-skilled).
- Multiple concurrent asset packs / culture variety.

## 8. Acceptance criteria

- The generator runs the full progression loop off-map: logical schools/jobs/objects fire, `SkillProgression`
  awards school + work days, promotions happen, Possessions accumulate — all deterministic per `(seed, params)`.
- The asset carries `SkillBook` + person-carried `Inventory`; Part B installs them; drawn people arrive with
  lived skills/careers-as-history/possessions, and `City.setupHousehold`'s `initialize` no-ops for them.
- The live↔bootstrap equivalence keystone holds; a new scaled career-progression equivalence test passes.
- The CI reachability + no-farm rules hold for the logical `JobMarket`. `npm test` green, typecheck clean.
- `HISTORY_GENERATOR_VERSION` + asset `formatVersion` bumped; `CLAUDE.md`/`README.md`/055's task note updated to
  reflect the asset now carrying skills/possessions.

## 9. Open decisions (lock at implementation)

- Logical-home churn: static vs. reactive to `movedOut`/`partnershipFormed` (co-location realism vs. cost).
- Logical business roster size / refresh policy over centuries (fixed pool vs. grow with population).
- Whether to carry a bounded recent action-log window for the inspector (vs. events-only, as 055 ships).
- Bounded vs. exact marriage candidate search at scale (carried over from 055 §2.2).
