# [Migration] Revise & backfill all existing Events for triggers, hourly ticks & Action links

- **Type:** Migration / Data + Review
- **Labels:** `events`, `actions`, `data`, `migration`, `enrichment-arc`
- **Depends on:** [042](042-event-triggers-and-causation_DONE.md) (triggers), [043](043-actions-core_DONE.md)/[044](044-action-consequences-and-object-action-relationships.md) (action linkage), [046](046-brain-and-hooks.md)/[047](047-job-orchestrator.md) (real trigger sources exist)

## Goal

A deliberate, per-event editorial pass over the (by then migrated-in-place) event manifest: every existing event is **re-evaluated** rather than mechanically carried forward.

## Background

- 040 converted tick *units* (`withinDays` ×24) and 042 mechanically moved probability blocks under `triggers.probabilistic` — both semantics-preserving. What has **not** happened yet is the per-event review the hourly model and the Action system demand ([038 §4, §6](038-simulation-enrichment-architecture_DONE.md)).
- The 15 current events (`death`, `had_sex`, `pregnancy`, `marriage`, `divorce`, `get_job`, `layoff`, `retirement`, `fell_ill`, `injury`, `recovered`, `trade_school`, `nursing_school`, `made_friend`, `argument`) were authored for daily rolls and probability-only triggering.

## Requirements

For **every** event in the manifest, decide and record (a short table in the PR description or a `docs/planning/` note):

1. **Should it be an Action instead?** (things people *do* that currently masquerade as happenings — e.g. `had_sex` is arguably an Action with an Event record; education "events" may become enrollment Actions with graduation Events).
2. **Should it be Action-caused?** Link it: which Actions trigger it manually (`triggersEvents` on the action side, source category on the event side); the validator (039/043) checks both directions.
3. **Triggers property:** correct mix of `probabilistic` / `manual` / `automated` (e.g. `get_job` likely becomes manual-from-hiring-flow or keeps a probabilistic seek component; `retirement` gains an automated age-threshold component; `stopped_working`-style events arrive with automated fallbacks).
4. **Hourly semantics:** with 24 rolls/day, review each probability + gradient + `withinTicks` window individually — events with time windows, cooldowns, or complex requirements can't rely on the mechanical conversion. Add occurrence-limit scopes (042: `once ever/perDay/perJob/perRelationship/withinTicks`) where "Started working every hour" bugs would otherwise appear. Time-of-day gating where sensible (arguments at 3am should be rarer than at dinner).
5. **Causation correctness:** fire-and-log with the right `triggerSource` end-to-end in the inspector.

Also:
- Statistical regression harness: per-year incidence rates of key events (deaths, marriages, births) before vs. after the revision stay within design tolerance (document the target rates — this guards the demography the economy and genealogy depend on).
- Update `PersonDetails`/feed labels where events split into action+event pairs.

## Non-goals

The 500+500 new-content backfill ([052](052-events-data-backfill.md)). New engine capabilities (if the review reveals a missing primitive, spec it as a follow-up rather than scope-creeping here).

## Testing

- Validator green on the revised manifest (both-direction action↔event links).
- The statistical regression harness above (seeded, fast configs).
- Per-event unit fixtures for the interesting rewrites (at minimum: one action-caused event, one automated fallback, one occurrence-limited event).
