# [Integration] The Job Orchestrator

- **Type:** Integration / Simulation
- **Labels:** `jobs`, `actions`, `brain`, `enrichment-arc`
- **Depends on:** [045](045-job-shifts-and-work-actions.md) (work-action declarations), [046](046-brain-and-hooks.md) (intent publishing)
- **Blocks:** [048](048-events-revision-hourly-migration.md) benefits (job events get real sources), [051](051-actions-data-backfill.md) exercises it at scale

## Goal

A per-business **Job Orchestrator** ([038 §9](038-simulation-enrichment-architecture_DONE.md)) — a context-specific *Action source* that is a counterpart to Brain in responsibility but never a duplicate in control. **Brain remains the single owner of a person's active Action state; jobs must not grow a second competing state machine.**

## Requirements

- **Knows** which Persons are assigned to the job/business (from `Workplace`/`WorkLife`) and who is currently on shift (045's shift math).
- **Publishes high-priority work Action intents** to each on-shift Person's Brain (046 intent shape, `sourceHook: jobOrchestrator`, causation = shift/schedule record): the continuous work Action at shift start (after arrival), replacements when one completes, and completion/interruption requests at shift end (pairing with 046's shift hooks — decide and document which side owns the shift-end request; suggested: the Orchestrator proposes, Brain resolves, the automated `stopped_working` fallback of [042](042-event-triggers-and-causation.md) is the safety net if the person never got a resolution, e.g. despawned mid-shift).
- **Proposes discrete work Actions** on ticks — sometimes several — from the job's declared discrete pool, under the **same pooling/interleaving/cooldown/eligibility rules as 043 child pools** (reuse that machinery, don't reimplement).
- **Waits** on the Brain/Action engine for outcomes; never applies effects itself.
- **Tracks workplace outputs & business inventory:** work-Action consequences with `ownership: employer` (044) land in a per-business inventory (041 instances, owner = business, container = building). No indiscriminate confiscation — personal-lunch-vs-factory-output routes purely by declared consequence ownership.
- **Triggers job-related Events** only through the Event engine (042 manual triggers, with causation).
- Deterministic: orchestrator proposals fork their own named RNG sub-stream (040) keyed by business + tick.
- Runs identically under both execution modes; in bootstrap the "arrival" precondition resolves instantly through the adapter. (Whether bootstrap has businesses at all is [055](055-history-asset-pipeline.md)'s offline-world scope — this task only needs mode-agnostic code.)

## Non-goals

Business economics changes (P&L stays monthly and category-based; produced inventory does not yet feed the supply chain — note the future link to `materials.json`/035 in comments). Staffing/scheduling AI (who works which days is authored by 045 data). School modeling beyond what 045/046 established.

## Testing

- On-shift roster correctness across day-of-week and cross-midnight shifts.
- Intent flow: shift start → arrival → continuous work Action running; discrete proposals respect pools/cooldowns/interleaving; shift end → completion + `stopped_working` (manual path) and the automated fallback when unresolved.
- Output ownership: employer-owned outputs land in business inventory; person-owned don't.
- Determinism: fixed seed → identical proposal streams across two runs and across live/bootstrap modes.
