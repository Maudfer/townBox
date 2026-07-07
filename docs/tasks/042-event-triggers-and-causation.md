# [Core] Event triggers (`manual` / `probabilistic` / `automated`) & causation logging

- **Type:** Core system / Simulation + Data
- **Labels:** `framework`, `events`, `triggers`, `causation`, `enrichment-arc`
- **Depends on:** [039](039-data-schema-registry-and-validators_DONE.md) (validator), [040](040-hourly-ticks-and-execution-boundary_DONE.md) (hourly lifecycle, log with causation ids)
- **Blocks:** [043](043-actions-core.md)/[044](044-action-consequences-and-object-action-relationships.md) (actions trigger manual events), [046](046-brain-and-hooks.md) (hooks fire on committed events), [048](048-events-revision-hourly-migration.md) (migration of all existing events)

## Goal

Give every Event an explicit **`triggers`** property with three types — `probabilistic` (today's model), `manual` (programmatically invokable), `automated` (deterministic schedule rules) — and record a **trigger source + causation id** on every invocation ([038 §6](038-simulation-enrichment-architecture_DONE.md)).

## Background (verified)

- Today every event is implicitly probabilistic: `probability: { perYear, factors }` at the top level (`types/LifeEvent.ts:25`), rolled per tick by `EventEngine.perDayProbability` (`EventEngine.ts:225–241`). There is no way for code to *invoke* an event; systems that need an event outcome mutate directly or emit ad-hoc bus signals.
- Signals carry `{ signal, personId, tick }` with **no causation metadata** (`EventEngine.ts:299–302`); `City` infers meaning from signal names (038 §1.3).

## Requirements

### Schema
- New `triggers` object per event; each type individually optional, but the 039 validator **errors on an event with no trigger at all**.
  - `triggers.probabilistic` — absorbs the current `probability` block (per-tick evaluation at hourly cadence). While migrating, evaluate which existing top-level parameters are genuinely global event config (`label`, `category` stay top-level) vs. trigger config (rates, factors move).
  - `triggers.manual` — declares the event invokable through the Event engine by other code (Actions, Brain, Job Orchestrator, shift rules). May declare expected parameters/roles the caller must bind. "Manual" ≠ player-manual.
  - `triggers.automated` — deterministic schedule rules: `{ afterTicks }`, `{ atTimeOfDay }`, `{ everyDayOfWeek }` (day-of-week arrives with 045's calendar extension — validator-gate it), `{ afterDelayOf: eventRef }`. Represented as **scheduled work in a persisted simulation schedule queue**, drained in lifecycle phase 3 — never invisible direct mutations.
- An event may declare multiple trigger types (e.g. `stopped_working`: manual from the Work Action lifecycle + automated shift-end fallback).
- **Occurrence limits & cooldowns** (038 §4): declarative scopes — `once: 'ever' | 'perDay' | 'perJob' | 'perRelationship' | { withinTicks }` — enforced by the engine against the log index. This replaces hand-authored negated-`hasEvent` cooldowns where appropriate (full per-event review is 048).

### Engine
- `EventEngine.invoke(eventId, subject, bindings, cause)` — the manual entry point: validates the event declares `manual`, checks requirements, applies effects, commits to the log. Failure returns a typed rejection (ineligible / missing binding), never a silent skip.
- Schedule queue: persisted (save v8 family), deterministic drain order (by due tick, then seq), survives save/load; automated triggers enqueue on their rule, fire via the same commit path.
- **Every invocation** — all three types — records `{ triggerSource: 'probability' | 'action' | 'brain' | 'schedule' | 'system', causationId }` in the 040 log, so the inspector can show *why* an event happened.

### Migration & UI
- Mechanical migration of the 15 existing events to `triggers.probabilistic` (semantics-preserving; the per-event *redesign* is [048](048-events-revision-hourly-migration.md)).
- `PersonDetails` event log shows the trigger source (small, e.g. a badge/tooltip) — proves the causation chain end-to-end.

## Non-goals

Actions themselves (043). Rewriting event content (048). New effects vocabulary (044 adds the consequence-facing ones).

## Testing

- Validator fixtures: no-trigger event errors; malformed schedule rules error; unknown manual parameters error.
- Manual invoke: eligible fires + logs with `triggerSource: 'action'`; ineligible rejects typed; determinism unaffected by interleaved manual invokes (seq ordering).
- Automated: `afterTicks`/`atTimeOfDay` fire exactly once at the right tick, survive a save/load round-trip mid-schedule.
- Cooldown scopes: `once: 'ever'` blocks re-fire; `withinTicks` re-allows after the window.
- Existing `eventCompiler`/`eventEngine` suites stay green through the mechanical migration.
