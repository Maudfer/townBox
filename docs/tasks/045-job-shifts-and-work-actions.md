# [Integration] Job shift schedules & work-Action declarations

- **Type:** Integration / Data + Simulation
- **Labels:** `jobs`, `actions`, `data`, `enrichment-arc`
- **Depends on:** [043](043-actions-core.md) (action schema), [044](044-action-consequences-and-object-action-relationships.md) (output ownership); coordinates with [049](049-content-planning-lists_DONE.md) (the work-action name lists)
- **Blocks:** [046](046-brain-and-hooks.md) (shift hooks), [047](047-job-orchestrator.md) (proposes these actions)

## Goal

Upgrade the job schema so every job carries a real **shift schedule** and declares its **continuous and discrete work Actions** with parameterized frequencies ([038 §9](038-simulation-enrichment-architecture_DONE.md)).

## Background (verified)

- `JobPosition = { title, salary, requirements, shiftStart, shiftEnd }` in minutes-since-midnight (`types/Work.ts:31–37`); ⚠️ **`jobs.json` currently authors no shift times at all** — all 33 jobs silently use the 09:00–17:00 defaults (`types/Work.ts:28–29`). There is no day-of-week concept, no cross-midnight handling, and no "working" state; shift boundaries only steer the visual commute (`City.handleCommute`, `City.ts:1291–1315`).

## Requirements

### Schema (`jobs.json`, registered in the 039 registry)
- Per job: `shiftStart`/`shiftEnd` (explicitly authored for **every** job — the validator now requires them, retiring the silent defaults), **`daysOfWeek`** (the 360-day calendar gains a 7-day week convention in `util/time.ts`; document the calendar assumption — weeks don't align with 30-day months, that's fine), **`crossesMidnight`** allowed and handled (shiftEnd < shiftStart), and the linkage `job → workplace/business` (already real at runtime via `WorkLife.getWorkplace()`; make the *location* reachable through the boundary's `LogicalLocation`).
- **Work-action declarations:** per job, a set of **continuous work Actions** (e.g. "Attending customers", "Restocking shelves") and **discrete work Actions** ("Greeted a customer", "Misplaced a document"), each with frequency parameters — same pooling schema shape as 043's child pools (weights, per-tick chance, cooldowns, maxPerTick) so 047 can reuse the machinery.
- Backfill all 33 existing jobs with sensible shifts (vary them: bakers early, bartenders late, hospital shifts staggered) and work-action declarations drawn from the [049 planning lists](../planning/work-actions.md). Validation: every referenced action id exists in `actions.json` (a starter set of shared work actions lands here or in 051 — coordinate so the validator passes at every commit).

### Simulation integration
- Shift windows become queryable simulation facts (`onShift(personId, tick)`) used by requirements ("is on shift"), by 046's hooks (`onShiftStarted/Ended`), and by 047. `City.handleCommute`'s minute-window logic must consume the *same* shift math (one source of truth; its behavioral replacement by intents is 046/047's scope).
- Day-of-week shifts affect eligibility — a person is not commuted to work on an off day (this fixes the current every-day commute).

## Non-goals

The Job Orchestrator runtime (047). Brain (046). Payroll changes (wages stay monthly). School schedules (schools are businesses; minors' school attendance is modeled via 046's obligations using the same shift math — keep the helpers person-agnostic).

## Testing

- Validator fixtures: missing shift, bad day-of-week, dangling action ref.
- Shift math: cross-midnight windows, day-of-week gating, `onShift` truth table around boundaries.
- Backfill sanity test: every job has authored shifts + ≥1 continuous and ≥1 discrete work action; commute behavior on off-days.
