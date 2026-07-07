# [Feature] Job skill progression & rank promotion

- **Type:** Feature / Simulation
- **Labels:** `jobs`, `skills`, `brain`, `progression-arc`
- **Depends on:** [064](064-job-ranks-and-training-grants.md) (ranks + counters), [063](063-school-day-skill-progression.md) (the SkillProgression service it extends)
- **Blocks:** [066](066-jobs-ranks-data-backfill.md) exercises it at scale

## Goal

Completed work days convert into proficiency in the rank's declared skills, and accumulated skill growth
converts into **promotion** — ranks must be *consumed by the simulation*, not hiring metadata. Ten years of
full daily work takes a primary skill 0→100.

## Background (verified)

The daily seam exists: `stopped_working` (manual + the automated `afterEvent started_working +12 ticks`
fallback) is `limit: { once: 'perDay' }` — a workday closes exactly once per calendar day
(`test/eventRates.test.ts` pins it). Wired as `onComplete`/`onInterrupt` across all work actions, so both
normal shift-end interrupts and the fallback path count. The JobOrchestrator rotates the job's continuous
repertoire and rolls its discrete pool; per-child-action counts must **not** drive progression (a job with more
flavor actions must not level faster).

**Ratified decision (056/057):** per-job `daysOfWeek` off-days are kept. The base rate below is *per completed
work day*; "ten years" is nominal for a 7-day job — a 5-day job simply takes proportionally longer. Document
this beside the constant.

## Requirements

- **Base rate:** `WORK_DAILY_GAIN = 100.0 / 3650` (≈ 0.02739726) per completed work day. Per rank-declared
  skill: `gain = WORK_DAILY_GAIN × multiplier` (primaries `1.0`, secondaries `< 1.0`, e.g. `0.25`), provenance
  `job:<jobId>`, dependency-gated and clamped at 100 by the store. Rates live in data (the rank's `progresses`
  from 064), never inferred from action names.
- **Work-day credit:** the SkillProgression service (063) consumes committed `stopped_working` events (already
  per-day-limited) for employed persons: award the current rank's progressed skills, increment
  `workDaysInRank`/`totalWorkDays`. A per-person last-credited-day guard mirrors 063's double-entry protection.
  Explicitly **not** per child action / per tick — pin with a test (two extra discrete work actions in a day ⇒
  identical gain).
- **Promotion evaluation** (Job Orchestrator, deterministic cadence): when `workDaysInRank` crosses the rank's
  `promotion.evaluateEveryWorkDays` (default 30) — evaluate: person still holds the job, next rank exists in
  the same job's progression, `meets(next.requires)`, and `minWorkDaysInRank`/optional event requirements
  satisfied. On success: set `rankId` to the next rank, reset `workDaysInRank`, and fire a **manual promotion
  event** through the EventEngine (wire the existing `got_promoted`, today a no-op texture event, as the
  vehicle — with a rank param once [067](067-parameterized-requirements-and-event-payloads.md) lands; plain
  until then) with causation = the evaluation, plus a city-feed notification (`util/notifications.ts` — a new
  `promoted` signal or the event's feed mapping). Evaluation is RNG-free (pure predicate over counters/skills);
  if any randomness is ever added it forks `worldSeed → tick → personId → salt` per house rules.
- **Ranks affect behavior:** the orchestrator consults the rank's `workActions`/`actionWeights` overrides (064
  schema) when rotating/rolling — a promoted person's observable work changes where data declares it. `jobOf`/
  `JobFacts` carries rank facts (064 wiring) so this is a pure consumption change.
- HUD: `PersonDetails` shows job title + rank label; `WorkplaceDetails` employee rows show rank.
- Mode-identical: everything above rides `TickRunner` phases (committed-event dispatch + orchestrator hook);
  no live-only paths.

## Non-goals

Salary changes on promotion (follow-up candidate — note it). Demotion, performance reviews, firing-for-cause.
Rank-gated *hiring* changes beyond 064. Business economics coupling (staffing capacity math unchanged).

## Testing

- Rate exactness: N completed work days ⇒ primary = `N × 100/3650` (± float), secondary = `× multiplier`;
  off-day jobs accrue only on worked days.
- Single-credit: one day with continuous + many discrete work actions ⇒ one credit; fallback-closed day
  (automated `stopped_working`) ⇒ still exactly one.
- Promotion: a person crossing the next rank's thresholds is promoted at the next evaluation, counters reset,
  `got_promoted` committed with causation, feed entry emitted; a person short on one skill is not.
- Rank consumption: post-promotion orchestrator proposals reflect the new rank's action weighting (fixture job).
- Determinism + boundary: identical progression/promotion streams across two same-seed runs and across
  live/bootstrap.
