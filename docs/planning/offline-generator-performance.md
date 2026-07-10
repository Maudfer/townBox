# Offline history-generator performance — context & optimization notes

> **Purpose.** A detailed dump of everything we learned about the performance characteristics of the offline
> history generator (`npm run generate-history`, task 077) across a long back-and-forth: how the per-tick
> simulation is structured, what costs what, the benchmarks we ran, the fixes we landed, the size/runtime
> rates, and — most importantly — the **optimization opportunities** for the next session. The follow-up task
> is [tasks/078-offline-generator-perf-optimization_DONE.md](../tasks/078-offline-generator-perf-optimization_DONE.md).
>
> Written 2026-07-09, at the end of the task-077 work (PR #85). Numbers are measured on this dev machine
> (single-threaded Node via `tsx`), ±~40% — treat them as ratios/orders-of-magnitude, not absolutes.

---

## 1. What the generator is, mechanically

`game/HistoryAsset.ts` `generateHistoryAsset(params, onProgress, gitCommit, sink)` runs the **same shared
`TickRunner` in `bootstrap` mode** that live play uses, over the whole living pool, one step at a time. A
"step" is `daysPerStep` in-game days (default **1 = daily**); the engine scales per-year hazards to the step
via `ticksPerStep`, so the *distributions* are stepping-independent but the *number of steps* is `years ×
360 / daysPerStep`.

Each **step** does, per living agent:

1. **Action engine `advance`** (`game/ActionEngine.ts`, TickRunner phases 1–2): advance running continuous
   actions, resolve due sequence steps / pool children.
2. **Event engine `simulateTick`** (`game/EventEngine.ts`, phases 3–5): drain automated triggers, then the
   **probabilistic walk** — for every probabilistic event in the compiled plan, one RNG draw per agent.
3. **`SkillProgression.processCommits`** (phase 5.5) — only on `completed_school_day`/`stopped_working`
   commits (rare); the generator mostly uses direct accrual instead (below).
4. **Brain `processTick`** (phases 7–8): for each agent, run the hooks (jobOrchestrator, schoolObligation,
   wokeUp, actionFailed, socialOpportunity, inventoryOpportunity, idleFallback), arbitrate intents, start/
   interrupt actions. **Free-time selection** scans the continuous-action manifest with predicate evaluation.

Then, once per step (not per agent), `LogicalWorld.runDaily` does the **direct progression accrual** (school +
work day gains + promotion), the **school enrollment sweep**, early-childhood **skill milestones**, and (at the
snapshot cadence) a **skill-timeline snapshot**.

### Why direct accrual instead of the shift obligation
School/work progression is normally driven by *intra-day shift windows* (`isOnShiftAtTick`, 08:00–14:00 etc.).
Coarse stepping (e.g. monthly) almost never lands a tick inside those windows, so the obligation chain barely
fires. So the generator drives progression by **direct per-step accrual** (`schoolDailyGain` / `WORK_DAILY_GAIN`
× days-elapsed-in-step), stepping-tolerant and reproducing the same per-day numbers. Hiring stays event-driven
(`get_job`, probabilistic → stepping-tolerant); promotions fire `got_promoted` through the engine.

---

## 2. The determinism model (constrains what we can optimize)

- The event engine **forks its RNG per tick from the world seed** (`new SeededRandom(worldSeed).fork(tick)`),
  then consumes draws in **plan order** during the probabilistic walk.
- **Roll-before-resolve** (tasks 040/052): the engine draws the RNG *first*, then checks eligibility only on a
  successful roll. This is what keeps candidate role searches (marriage) affordable and makes the eligibility
  index **bit-identical** to an unindexed run.
- The **eligibility index** gates *after* the draw (cheap discriminant checks: `alive/gender/marital/employed/
  age`), so it can skip expensive work without moving the RNG stream. It costs **one draw per probabilistic
  event per agent per tick regardless of plausibility** — that draw count is a hard floor of the current design.
- Everything we added is pure/deterministic: the population thermostat (hysteresis, pure function of the living
  count), the `peopleAt` index, the incremental living index, bounded fertility.

**Implication for optimization:** anything that changes *which draws happen* (e.g. pruning events, gating
before the draw) changes the RNG stream and therefore the asset. That's fine for a *generator-only* mode
(the asset stays deterministic per seed) but breaks bit-identity with a full-manifest / live run. The
live↔bootstrap equivalence keystone (`test/arcScenarios.test.ts`) uses the **same manifest in both modes**, so
a generator-only reduced manifest wouldn't fail it — but it does bend the "one system, both modes" principle.
This trade-off is the crux of opportunity #1 below.

---

## 3. Benchmarks we ran (measured)

### Per-agent step cost (daily, full logical world)
| Agents | ms / agent / step |
|---|---|
| 63  | 4.0 |
| 402 | 5.4 |
| 801 | 6.2 |

Near-linear after the co-location fix (a pure O(agents²) term would have hit ~50 ms/agent at 800). Extrapolated
~6.7 ms/agent at 1,000 agents. **This ~5–7 ms/agent is now the runtime driver.**

### The co-location fix (landed this session)
`LogicalWorld.peopleAt` was an **O(agents) scan** called once per idle person per tick by the
`socialOpportunityHook` → **O(agents²)/step**. Replaced with a reverse **location→people index**
(`byLocationKey`, maintained on home-assignment / transition / death) → `peopleAt` is O(occupants). Before the
fix, per-agent at 402 would have been ~26 ms (it was 5.4 after). Behavior-preserving (same sorted ids →
byte-identical asset).

### Other pinned benchmarks (from the arc suites, for reference)
- Event **eligibility index**: ~3.2 ms/tick at **300 agents** over the full 698-event manifest
  (`test/eventEligibility.test.ts`) — events-only, no actions/brain.
- **Full spine** (events + actions + brain + social + progression): ~16 ms/tick at **60 agents**
  (`test/arcScenarios.test.ts`). Note ~16 ms / 60 = 0.27 ms/agent there vs ~4 ms/agent in the generator — the
  generator's higher per-agent cost is the *logical world* layer (job market, schools, objects, accrual) plus
  the fuller action/brain activity at scale.

### Runtime extrapolations (daily)
Runtime ≈ steps × agents × ~5–7 ms. Recording steps = `years × 360`. Examples:
- **250/100:** ~36k recording steps × 250 agents × 5 ms ≈ **~15 h** (overnight-feasible).
- **1,000/250:** ~90k × 1,000 × 6.7 ms ≈ **~7–8 days**.
- **2,000/500:** ~180k × 2,000 × ~7 ms ≈ **~3 weeks**.

Monthly (`--step-days 30`) is ~30× fewer steps → 250/100 ≈ ~30 min, 1,000/250 ≈ ~6 h.

---

## 4. Size rates (compressed on disk; for the size/runtime trade-off)

All measured as **compressed shard bytes** (pako deflate → base64; ~9.4× deflate, +33% base64 → ~7× net vs raw
JSON). Rates are **per living-person-year** unless noted:

| Section | Rate | Notes |
|---|---|---|
| Event log — events only (daily) | **~584 B/py** | dominated by frequent loggable events (`had_sex`, health, career) |
| Event log — events only (monthly) | **~145 B/py** | finer stepping fires more `had_sex` commits ⇒ ~4× more than monthly |
| Event log — **with action log** (daily) | **~17.7 KB/py** | the action texture; ~30× the events-only log |
| Skill timeline (yearly snapshots) | **~330 B/py** | dedup'd; a snapshot per person-year while skills change |
| Objects (carried possessions) | **~200 B/person** | one-time-ish per retained person |
| Population record | **~250 B/person** | GenPerson |

Scale drivers: **living-person-years** (≈ target × recording-years + warm-up integral) drives log + timeline;
**retained people** (≈ living-at-end + born-after-epoch) drives population + objects. Rough retained-people
counts: 250/100 ≈ 600; 1,000/250 ≈ 4,300; 2,000/500 ≈ 15,000.

**Key takeaway:** the action log is ~95% of the asset size at daily cadence. It's off for the big runs (can't
fit budget) but **on at 250/100** (~560 MB total, < 2 GB). Streaming means RAM stays bounded regardless.

---

## 5. Architecture facts that matter for perf (already optimized — don't redo)

- **`LifeLog` is write-only during generation.** The sim's `hasEvent` queries read the *aggregate* history
  (`EventEngine.history`: count+lastTick per event id), NOT the full log. So the full log can be **drained to
  disk shards** periodically (`LifeLog.drain` / `EventEngine.drainLog`) without affecting the sim — this is how
  streaming keeps RAM bounded.
- **`Inventory.contentsOf` is already indexed** (`byContainer: Map<containerKey, Set<id>>`), so
  `instancesAtLocation` / `possessionsOf` / `carriedInstances` are O(occupants), not O(all instances).
- **`canBeHired` (job market `canHire` → `bestMatch`, which scans all businesses×positions) is only evaluated
  after a successful `get_job` roll** (it's in the subject predicate, checked post-roll), so the O(businesses)
  bestMatch is *not* a per-agent-per-tick cost — it runs for the tiny fraction of agents whose `get_job` rolled
  that tick. Confirmed by the near-linear scaling.
- **`peopleAt` is now indexed** (this session).
- **Incremental living index** (a `Set` updated from each tick's births/deaths) avoids the O(pool) filter.
- **Bounded population** (per-person `maxChildren` + the thermostat) means agent count is *stable*, not
  exponential — so per-step cost doesn't balloon over a long run.

---

## 6. Optimization opportunities (the point of task 078)

Ranked by expected impact. All are hypotheses — **benchmark before/after** (add a `--profile` or use the
per-agent harness we used: run to a fixed agent count with a `maxRuntimeMs` cap and read ms/agent/step).

### #1 — Reduced generator event manifest (drop pure-texture events). *Likely the biggest win.*
The manifest is **698 events: ~18 vital/effect-bearing + ~680 effect-free "texture" events** (achievements,
mishaps, social moments…). Texture events **emit no signals and carry no effects**, and — crucially — they are
**already dropped from the persisted asset** (the log is slimmed to `loggableEventIds` = effect-bearing ∪
requirement-referenced). So during generation they contribute **nothing to the asset** except:
(a) consuming one RNG draw per event per agent per tick (~680 of the ~500+ probabilistic draws), and
(b) occasional commits → Brain `onEventCommitted` dispatch overhead.

Running the generator against a **reduced manifest** (only events that are effect-bearing, requirement-
referenced, or manually invoked by the logical world — `get_job`/`layoff`/`started_school`/`got_promoted`/
education/illness/marriage/birth/death/…) would cut the probabilistic walk from ~500 to ~tens of events →
potentially **~10–25× fewer draws + far fewer commits/dispatches**. This likely dominates the per-agent cost.

**Caveats to work through:** (i) it changes the RNG stream, so the asset differs from a full-manifest run
(still deterministic per seed — acceptable for a generator-only mode; document it, bump `generatorVersion`).
(ii) Verify the "safe to drop" set precisely: an event is droppable iff it has **no `effects`, emits **no
`signal`** that the generator consumes, and is **not referenced by any `hasEvent` requirement** of a kept
event. Build this set from the manifest (we already compute `loggableEventIds` — extend it: also keep events
whose signals matter off-map, and events invoked manually by `LogicalWorld`). (iii) The live↔bootstrap keystone
uses the full manifest in both modes, so it won't break — but note the philosophical bend and gate the reduced
manifest behind a config flag (default on for the generator, off for correctness runs).

### #2 — Brain free-time selection cost.
`Brain.selectFreeTimeAction` iterates the continuous-action manifest (leisure subset of ~260 actions),
evaluating each action's requirement predicate + selection modifiers, **per idle person per tick**. This is a
large per-agent cost for the many idle agents. Ideas: pre-compile a static candidate list (actions whose hard
gates are context-independent), cache/memoize predicate sub-evaluations, prune by category/age-band/location up
front, or only re-select when the person's context signature changes (they're often idle in the same context
for many ticks). Requires care to keep determinism (the weighted pick is seeded per (tick, person)).

### #3 — Generator-only pre-draw gating (aggressive; changes stream).
Instead of one draw per probabilistic event per agent, gate on the cheap discriminants **before** the draw and
skip impossible events entirely (fewer draws). This is what the eligibility index deliberately does *not* do
(to stay bit-identical). A generator-only "fast" mode could accept a different (deterministic) stream for a big
draw reduction. Overlaps with #1 — do #1 first (simpler, bigger, cleaner).

### #4 — Micro-optimizations.
- `LogicalWorld.runDaily` / `accrueSchoolDays` / `accrueWorkDays` / `runSchoolSweep` iterate **all**
  `homeKeyOf.keys()` (including the dead) each step and re-sort. Iterate the **living set** instead, and avoid
  per-step re-sorts where order isn't needed.
- `accrueWorkDays` does `Object.entries(JOBS).find(... title ===)` per employed person per step — precompute a
  title→definition map once.
- Reuse allocations (the `agentIds = [...living].sort()` per step; the per-tick `TickResult` arrays).
- `snapshotSkills` signature-compares all living each snapshot — fine at yearly, watch if snapshot cadence
  drops.

### #5 — Parallelism (stretch).
The generator is single-threaded. Per-tick agent processing is *mostly* independent, but the shared mutable
pool (births/deaths/marriages), the global RNG stream order, and cross-agent role searches (marriage) make
naive parallelism break determinism. A worker-sharded design would need a deterministic merge and a fixed draw
order. High effort; note but likely not first.

### Non-issues (measured/reasoned — don't chase these)
- Co-location `peopleAt` — fixed.
- Inventory location/possession queries — already indexed.
- Job market `bestMatch` — only on successful `get_job` rolls, not per-tick.
- RNG itself (mulberry32) — cheap; the *count* of draws is the lever (#1/#3), not the per-draw cost.

---

## 7. How to measure (harness we used)

Run `generateHistoryAsset` with `logicalWorld` on, `daysPerStep: 1`, a `populationControl.target` at the agent
count you want, and `safety.maxRuntimeMs` to cap wall-clock; then compute `(secs / steps) / avgAgents` for
ms/agent/step, where `steps = endTick / (daysPerStep*24)` and `avgAgents ≈ (founders + livingAtEnd) / 2`. To
isolate a layer, toggle `logicalWorld.{schools,jobs,objects}` and compare. A committed `--profile` mode (phase
timers around action-advance / event-walk / brain / runDaily) would make attribution exact — worth adding
first in task 078.

Size rates: run with an in-memory sink that compresses each drained shard and divides bytes by living-person-
years (log/timeline) or retained-people (objects/population).

---

## 8. Current default (as of this doc)

`json/historyGenerator.json`: **250 living × 100 years**, daily, logical world on, yearly snapshots, **action
log ON**, **reduced event manifest ON** (task 078). Flags dial to larger canonical assets or faster iteration
runs. See task 077's delivered note for the full size/runtime table. Task 078 cut per-agent cost ~11–13× (see
§9), so the runtime figures in §3 are now pessimistic by roughly that factor.

---

## 9. Task 078 results — what the profiler actually found (and the fix)

Written 2026-07-09 at the end of task 078. **The ranked hypotheses in §6 were largely wrong**, which is exactly
why the task mandated a `--profile` pass *first*. The per-phase attribution (new `--profile` mode; timings
threaded through `TickRunner` into `meta.stats.profile`, printed by the CLI) at daily cadence, fixed agent
counts (`founders = threshold` so the epoch is tick 0):

### The real bottleneck: `ActionEngine.activeInstanceOf` — not the event walk

Profiling (µs per agent-step, daily, logical world on):

| phase | before | after | note |
|---|---|---|---|
| **brain** | **~2600–2930** | **~124–150** | `statusOf → activeInstanceOf`, called ~5×/agent/tick by Brain hooks |
| actions | ~77–99 | ~65–109 | `ActionEngine.advance` (now bounded to active instances) |
| events (full manifest) | ~7–9 | ~7–9 | the event walk — a **rounding error**, not the driver |
| events (reduced manifest) | — | ~2–4 | the reduced walk (§6 #1) — a real 2–3× cut, but ~2% of the total |
| runDaily / snapshot / other | ~4 | ~4 | micro-opts (§6 #4) applied; already small |

`activeInstanceOf` and `advance` scanned **`Object.values(state.instances)` — every continuous instance ever
created** — on every call. Terminal instances were **never pruned**, so the scan set grew without bound
(measured: ~2,700 instances/call after only 27 steps, ~78 M total iterations; it would reach hundreds of
thousands over a 100-year run). Called ~5×/agent/tick by the Brain hooks (`statusOf`), this was **~97% of
per-agent cost and grew over the run** — dwarfing the event walk the §6 ranking fingered.

**Fix (task 078):**
- **Active-instance index** — a `Map<person → active instance ids>` maintained on start/finish, so
  `activeInstanceOf` is O(1) and `advance` iterates O(active) instead of O(all-ever). Rebuilt from state on
  load; behaviour-identical (returns the same first-active instance in id order).
- **Terminal-instance pruning** — a finished continuous instance is deleted from `state.instances` (it is inert:
  children are discrete, the one-active-continuous rule blocks a second, and the LifeLog holds every lifecycle
  entry). Keeps the scan set *and* memory bounded over a centuries-long run, and shrinks live saves. No
  production code read terminal instances by id — only tests did (now assert the outcome from the log).
- **Reduced event manifest** (§6 #1, gated behind `reducedEventManifest`, default on for the generator) —
  restricts the probabilistic walk to `loggableEventIds`, cutting the event phase 2–3×. Kept because it is free
  and clean, but it is a secondary win, not the headline. It changes the RNG stream, so the generated asset
  differs byte-wise from a full-manifest run (still deterministic per seed) — `generatorVersion` bumped to
  `078.0`.
- **Micro-opts** (§6 #4): `LogicalWorld.runDaily` and its sub-sweeps iterate the generator's incremental
  **living** set instead of the ever-growing `homeKeyOf` (which retains the dead); `accrueWorkDays` uses a
  precomputed title→definition map; `Brain.selectFreeTimeAction` precomputes its static leisure-candidate list.

### Net result (ms/agent/step, daily, logical world on)

| agents | before | after (reduced) | speedup |
|---|---|---|---|
| ~60  | 2.68 | 0.20 | ~13× |
| ~400 | 2.82 | 0.22 | ~13× |
| ~800 | 3.03 | 0.27 | ~11× |

And critically, the after-cost is **flat over the run** (the before-cost grew as instances piled up). Projected
**1000/250 daily ≈ ~7 h** (was ~7–8 days) — the stretch goal (< 2 days) is met with margin, and the memory
wall that would have OOM'd the big assets is gone.

**Takeaway for the next pass:** the remaining per-agent cost is now split between `brain` (free-time selection +
hooks, ~130 µs) and `actions` (`advance` child/sequence processing, ~65–110 µs). Both are honest work over the
full spine; there is no longer a single dominant O(n²)/unbounded term. Profile before chasing further.

---

## 10. Fresh baseline for the next per-agent pass (post-078)

Added 2026-07-10, after the asset naming/manifest/**runtime-loading** work landed (see below). A current
`--profile` run — daily, logical world on, **reduced manifest on** (the default), no action log, **250 agents,
360 steps** (founders = threshold = 250 → epoch at tick 0, no warm-up), writing to a temp dir:

```
profile (360 steps, 94,402 agent-steps; µs/agent-step, share of total):
  actions         75.60 µs   36.6%
  events           3.03 µs    1.5%
  progression      0.00 µs    0.0%
  brain          124.37 µs   60.3%
  runDaily         3.21 µs    1.6%
  snapshot         0.04 µs    0.0%
  other            0.10 µs    0.0%
  TOTAL          206.35 µs   (0.21 ms/agent-step)
```

So **~97% of per-agent cost is now `brain` (60%) + `actions` (37%)**; events / runDaily / snapshot / other are
rounding errors. This is the target surface for any further optimization. **First step of the next pass: make
`--profile` finer** — sub-time the Brain per-hook and the ActionEngine per sub-phase — because we don't yet know
*which part* of brain/actions dominates. Hypotheses to test (do not assume; profile):

### Where `brain` (~124 µs) likely goes
`Brain.processTick` runs all built-in hooks for every agent every tick, then arbitrates. Suspects:
- **Free-time selection** (`selectFreeTimeAction`): even with the 078 precomputed static candidate list, it
  still evaluates each candidate's requirement predicate + selection modifiers and does a seeded weighted pick,
  **per idle person per tick**. Idle people are often idle for many consecutive ticks in the *same context* —
  **cache the selection** (or the candidate+weight vector) until the person's context signature changes or the
  chosen action ends. Determinism: the pick is seeded per (tick, person), so a cache must reproduce the same
  choice — key it so a cache hit is provably identical, or only cache the *filtered candidate set* (context-
  independent gates) and still do the seeded pick.
- **Per-hook fixed overhead**: 7 hooks × every agent × every tick. Several do real work even when they return no
  intent — `socialOpportunityHook` (RNG roll + `peopleAt` + co-located candidate scan), `inventoryOpportunityHook`
  (`objectsAt` + carried-instance scan). Consider gating hooks earlier (cheap pre-checks) or skipping hooks for
  agents in a known-inert state (e.g. sleeping, mid-obligation).
- **Context construction**: `contextFor` / `makeContext` builds `getAttr`/`hasEvent` closures; if it is rebuilt
  per hook call, build it once per (agent, tick) and share.

### Where `actions` (~76 µs) likely goes
`ActionEngine.advance` (now bounded to *active* instances after the 078 index) still, per active instance per
tick: rolls the discrete work **pool** children (per-child RNG + requirement checks — heaviest for on-duty work
actions with rich flavor pools), resolves **sequence** steps, and applies **consequences** (object create/
consume/move). Suspects: the pool-child requirement evaluation and consequence planning. Sub-profile advance to
see whether pools, sequences, or consequences dominate.

### Determinism reminder (unchanged)
Any change that alters *which RNG draws happen or their order* changes the asset (fine for the generator-only
path — bump `generatorVersion` — but keep live play + the `arcScenarios` keystone on the full behavior). Caching
must return provably-identical results, not merely "close enough."

### Non-perf work since §9 (context, not optimization targets)
Landed after 078; **not** part of per-agent cost, listed so the picture is complete:
- **Asset naming/provenance:** dirs are `history-<YYYYMMDDHHMMSS>-<hash>` (monotonic "latest = highest", never
  overwritten); each carries an exhaustive `manifest.json`; a `latest.json` pointer names the newest run.
- **Runtime loading:** `GameManager.startNewGameWorld` → `loadSelectedWorldFromHttp` fetches `latest.json` → the
  newest asset's `meta.json` → only the shards the window needs, then `selectStartingWorldFromShards`. A
  `copy-history` build step copies the newest asset into the served output (`./dist` dev, `./bin` prod).
- **Gotcha fixed:** the CLI shard-writer used `Math.min(...ticks)` / `Math.max(...ticks)`; with the action log a
  flush holds hundreds of thousands of entries, and spreading that many args **overflows the call stack**. Use a
  running-loop min/max (or chunk) for any large array — never spread it into function args. (`util/compress`
  already chunks `String.fromCharCode` at 32 KB for the same reason.)

---

## 11. Task 079 results — what the finer profiler found (and the fixes)

Written 2026-07-10 at the end of task 079 (PR TBD). Following §10's mandate, the **first** change was making
`--profile` finer: `TickProfiler` now carries an optional `SubProfiler` (`types/Execution.ts`) that Brain and
the ActionEngine accumulate into — **per-Brain-hook** wall-clock (+ `resolveIntents`) and **per-advance-sub-phase**
(materialize/pool/sequence/completeWhen), with `finish()` split internally (consequence-plan / log / onComplete
event). Zero overhead when off (a null clock). Again **the §10 hypotheses were mostly wrong** — the profiler
found two costs neither §10 bullet named as the top item:

### The two real bottlenecks

Finer `--profile` (250 agents, 360 daily steps, reduced manifest, no action log):

| sub-phase | before | after | what it was |
|---|---|---|---|
| **`advance:finish:onCompleteEvent`** | **72.0 µs** | **~10.6 µs** | a free-time action completes every step (a day-long step finishes the few-hour action) → fires its `onComplete` **manual event via `EventEngine.invoke`**, whose per-call cost was dominated by `Object.keys(state.people).filter(isAliveAt).sort()` — the **whole pool incl. the dead**, rebuilt every call, **growing over the run** — plus a `fakerPT_BR.seed()` every call |
| **`hook:idleFallback` + `hook:wokeUp`** | **86.7 µs** | **~40 µs** | both call `selectFreeTimeAction` for the *same idle-just-woken person the same step*, computing the **identical** deterministic pick twice |

So the top cost wasn't the free-time predicate scan (§10's lead suspect) or the pool children (§10's actions
suspect) — it was **`invoke` rebuilding an O(whole-pool) agent list on the action-completion path** (a
078-style unbounded/growing scan, hidden one layer down in an *event* call the `actions` bucket paid for) and a
**doubled free-time selection**.

### Fixes (all byte-identical — verified: a fixed-seed asset hashes identically to `main`)

1. **`invoke` fast paths (`EventEngine`).** Precompute per event (at construction) `invokeNeedsCandidateSearch`
   (has a role with a `where` search) and `invokeUsesFaker` (has a `birth` effect). Build the sorted living-agent
   list **only** for candidate-search events (subject-only events — nearly all action `onComplete`/`onStart` and
   most manual events — skip the O(whole-pool) filter+sort); seed faker **only** for birth events. Both are
   invisible: unused agents were never iterated, and faker is drawn only by birth (which still reseeds
   identically). *This is the headline win, and it also removes the run-growth term.*
2. **Per-(person, tick) free-time memo (`Brain`).** `selectFreeTimeAction` is a pure function of
   (worldSeed, tick, personId, context), and within one tick's proposal phase a person's context is stable
   (hooks only propose; actions start later). A transient memo (keyed by the tick, cleared on advance) returns
   the same pick the second caller asks for. Not serialized → Brain stays stateless across saves.
3. **Per-context memos (`ActionEngine.contextFor`).** One context is reused across a whole candidate loop, and
   the person is immutable for its life — so cache `getAttr` results, the objects-here list, and the carried
   list per context instead of recomputing per candidate.
4. **Social candidate precompute (`SocialOpportunity`).** Mirror `Brain.freeTimeCandidates`: cache (per manifest,
   via a `WeakMap`) the ~19 person-targeted actions so the hook stops re-scanning all ~260 actions each eligible tick.

### Net result (µs/agent-step, daily, logical world on, 250 agents)

| bucket | before (§10) | after |
|---|---|---|
| actions | 75.60 | ~15.2 |
| brain | 124.37 | ~76 |
| **TOTAL** | **206.35** | **~98** |

**~54% faster** (0.21 → ~0.10 ms/agent-step), and the removed `invoke` agent-list build means the completion
path no longer **grows** with the accumulating deceased pool — so a long run gains more than this 1-year
snapshot shows. Determinism proven two ways: all 637 unit tests pass (incl. the `arcScenarios` live↔bootstrap
keystone and the `eventEligibility` bit-identical invariant), and a fixed-seed generated asset is **byte-identical**
to `main`. `generatorVersion` is **unchanged** (078.0) precisely because the asset didn't change.

### Takeaway for the next pass
Remaining per-agent cost is honest work with no single dominant term: `brain` ~76 µs (free-time selection compute
~40 µs in whichever of wokeUp/idleFallback runs first; `socialOpportunity` ~18 µs dominated by `peopleAt`+filter
for *every* idle person; `inventoryOpportunity` ~11 µs), and `actions` ~15 µs (the residual `invoke` cost of the
onComplete commit, now cheap). Candidate levers if more is wanted: share ONE context per (person, tick) across
hooks (so the attr memo spans them), a cheap early-out before `socialOpportunity`'s `peopleAt`, or (bigger) cache
the free-time *filtered candidate set* across ticks while the person's context signature is unchanged. Profile
first — the record here is two-for-two that the ranked guesses were wrong.

---

## 12. Task 079 pass 2 — hook-internal profiling, the V8 ground truth, and another ~1.8×

Written 2026-07-10, same session as §11, immediately after. §11 ended at ~98 µs/agent-step; this pass ends at
**~54 µs** (4× under the §10 baseline). Everything remains **byte-identical** (fixed-seed asset hash == `main`,
`generatorVersion` still 078.0); all 639 tests green.

### Method upgrades (both mattered)

- **Hook-internal segment timers.** `HookContext` gained an optional `sub` (the SubProfiler), and the hooks +
  `computeFreeTimeAction` + `invoke`/`attemptCommit` time their internal segments (`social:company`,
  `freeTime:requirements`, `invoke:pre`, …). This is what localized the real costs below.
- **V8 `--cpu-prof` as ground truth.** When a bracket read ~11 µs for code that micro-benched at 0.0095 µs, the
  next step was `NODE_OPTIONS=--cpu-prof` + a script summing self-time per function — NOT more guessing. Lesson:
  **bracket timers lie at fine granularity** (V8 attributes inlined callees to the caller; bracket boundaries
  catch work that "belongs" elsewhere). The CPU profile named `peopleAt` (10.1%!), `invoke` (7%), and
  `contentsOf` (~5%) — none of which §11's takeaway had ranked first.

### What was actually wrong (three finds)

1. **A real bug in the §11 fix.** `invokeNeedsCandidateSearch` was computed over ALL roles — **including the
   subject**, whose `where` (the alive check) nearly every event has. So the set contained ~everything and the
   O(whole-pool) agent build still ran on every invoke; the §11 speedup had actually come from the faker gate
   (faker's Mersenne-twister reseed was the hidden heavyweight). Excluding the subject (only non-subject roles
   consume `agents`) made the set = {marriage} → `invoke:pre` fell 9.2 → 0.14 µs and `actions` 16 → ~6 µs.
2. **`peopleAt` before the RNG gate.** `socialOpportunityHook` computed the co-located company (sorted copy per
   idle person per tick — the single hottest function of the run) BEFORE its 15%-per-tick roll. Rolling first is
   byte-identical (the RNG fork is private and discarded; empty-company people return `[]` either way; with-company
   people consume the same draw sequence) and skips 85% of the queries. `social:company` 15.5 → 2.9 µs.
3. **Repeated pure reads.** Three cache layers, all invalidation-correct and byte-identical:
   - `Inventory.contentsOf` / `carriedInstances` results cached, invalidated per-containerKey on containment
     mutation (`invalidateReadCaches(key)`; a global clear churned too often to hit) + a **mutation epoch** and
     **per-container epochs** exposed for external caches. `transformInstance`'s in-place archetype swap also
     invalidates (query-visible without a containment change — easy to miss).
   - An engine-level **objectAtLocation query cache** (`WeakMap<Inventory, Map<locKey|sig, {epoch, result}>>`)
     validated against the location's container epoch — free-time selection asks the same ~20 queries for every
     idle person at the same location every tick.
   - A one-entry **proposal-phase context memo** in `contextFor` keyed (person, tick, world, inventory,
     inventory-epoch), served only to param-less callers (executing paths pass params and always rebuild), and
     dropped at every mutation point (startAction/interrupt/finish). Covered by regression tests
     (`test/actionEngine.test.ts`: query-cache invalidation; memo share/drop semantics).

### Net (µs/agent-step, daily, 250 agents, reduced manifest, no action log)

| bucket | §10 baseline | §11 (PR #91 v1) | pass 2 |
|---|---|---|---|
| actions | 75.60 | ~15.2 | **5.7** |
| brain | 124.37 | ~76 | **41.8** |
| events | 3.03 | ~3 | 2.9 |
| **TOTAL** | **206.35** | **~98** | **~53.6** |

Projected 1000/250 daily ≈ **~1.7 h** (was ~7 h post-078, ~7–8 days pre-078). Remaining cost is now dominated by
free-time predicate evaluation itself (`freeTime:requirements` ~10 µs + `modifiers` ~7 µs — the AST interpreter
floor over ~60 candidates) and per-hook residuals of a few µs each. The next lever, if ever needed, is predicate
**precompilation** (compile the JSON AST to closures once per manifest) — broader change, est. ~2× on that slice.

### Lessons added to the record
- **Three-for-three: every ranked guess was wrong until profiled.** This pass's own §11 fix contained a bug that
  a bracket + a micro-bench + a CPU profile were needed to find.
- **Verify fixes with the profiler, not just the outcome metric** — §11's headline number improved for a
  different reason than claimed (faker, not the agent list).
- **Micro-bench + CPU profile beat bracket timers** once you're under ~10 µs.
- **Global cache epochs churn to death in an interleaved sim** — invalidate at the finest natural key
  (per-container here) or the cache never survives one person's resolution phase.

---

## 13. Task 079 pass 3 — predicate precompilation (~53.6 → ~49.4 µs)

Written 2026-07-10, same session. The §12 takeaway named the predicate interpreter as the remaining floor;
this pass cashes part of it. `evaluatePredicate` re-walks the JSON AST on every call — the `'x' in pred`
structural dispatch plus recursion. `compilePredicate` (`util/predicate.ts`) resolves that dispatch ONCE into a
closure tree; `evaluatePredicateCached` memoizes the compiled closure per predicate-object identity (a WeakMap
— manifest predicates are stable references), and the hot selection paths (Brain free-time
requirements/modifiers, the social hook, ActionEngine requirement/`completeWhen`/pool checks) call it instead
of the interpreter.

**Byte-identical by construction** — the compiled form is a mechanical mirror of the interpreter (same
short-circuit order, same `compareValues`, same query shapes), and `test/predicate.test.ts` cross-checks
`compilePredicate`/`evaluatePredicateCached` against `evaluatePredicate` over every node kind × combinator in
both a rich and a sparse context. Fixed-seed asset hash still == `main`; all 641 tests green.

**Result:** `freeTime:modifiers` 7.0 → 4.9 µs, `freeTime:requirements` 10.1 → 8.9 µs; TOTAL ~53.6 → **~49.4 µs**
(~8%). Smaller than the earlier passes — because most of a predicate eval's cost is the *context field access*
(`getAttr`/`hasEvent` closures, already memoized in pass 2), not the AST dispatch the compiler removes. The
interpreter floor is real but shallow once the data access underneath it is cached. Net over the whole task:
**206 → ~49 µs, ~4.2×, byte-identical, `generatorVersion` unchanged.**

Further gains would need to attack the field access itself (e.g. a positional attribute vector instead of the
`getAttr(name)` string-keyed closure) — a deeper change to the Context contract, clearly diminishing returns.
This is a natural place to stop.
