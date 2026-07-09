# Offline history-generator performance — context & optimization notes

> **Purpose.** A detailed dump of everything we learned about the performance characteristics of the offline
> history generator (`npm run generate-history`, task 077) across a long back-and-forth: how the per-tick
> simulation is structured, what costs what, the benchmarks we ran, the fixes we landed, the size/runtime
> rates, and — most importantly — the **optimization opportunities** for the next session. The follow-up task
> is [tasks/078-offline-generator-perf-optimization.md](../tasks/078-offline-generator-perf-optimization.md).
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
log ON** (~560 MB, ~15 h — fits the budget at this scale). Flags dial to larger canonical assets or faster
iteration runs. See task 077's delivered note for the full size/runtime table.
