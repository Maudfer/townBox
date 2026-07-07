# [Content] Events data backfill (500 probabilistic + 500 manual)

- **Type:** Content / Data
- **Labels:** `content`, `events`, `data`, `enrichment-arc`
- **Depends on:** [042](042-event-triggers-and-causation_DONE.md) (triggers), [048](048-events-revision-hourly-migration_DONE.md) (revision conventions established), [051](051-actions-data-backfill.md) (actions to link to), [049](049-content-planning-lists_DONE.md) (the name list)

## Goal

Grow the event manifest from ~15 to the enriched catalog: **≥ 500 probabilistic** and **≥ 500 manual** events post-dedupe (one event may be both), from [`docs/planning/events-master-list.md`](../planning/events-master-list.md).

## Requirements

- Follow the conventions 048 established: correct trigger mixes, hourly-sane probabilities with occurrence limits/cooldowns, gradients where age/health/context matter, labels/categories for the inspector and feed.
- **Every Action-caused (manual) event links to valid Actions/source categories and validates both directions**; scheduled/automated events use real schedule rules.
- Effects stay within the closed vocabulary; where a batch of events genuinely needs a new attribute or effect primitive, that is a deliberate separate code change (list candidates in the PR; don't smuggle primitives in).
- Cover the life arc + mundane texture per the planning list (childhood, adolescence, career, aging, accidents, possessions, community, moods) while respecting the demography guards: the 048 statistical harness (death/marriage/birth rates) must stay in tolerance as content lands — big batches should land incrementally with the harness green at each step.
- Feed/inspector noise control: mark which categories surface in the city feed vs. person-log-only (reuse the existing feed mapping in `util/notifications.ts`).

## Non-goals

New Brain hooks or engine primitives; economy rebalancing (if event money effects meaningfully shift the economy, flag for a tuning follow-up).

## Testing

- `validateAll()` green; compiler warnings zero; count assertions (≥ 500 / ≥ 500 post-dedupe).
- The 048 statistical regression harness green.
- Seeded long-run smoke: event logs read as coherent life stories (manual spot-check documented in the PR); performance of hourly evaluation at the enlarged manifest measured and acceptable (the 040 eligibility index at scale).
