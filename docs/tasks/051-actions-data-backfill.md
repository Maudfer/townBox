# [Content] Actions data backfill (general-purpose + per-job)

- **Type:** Content / Data
- **Labels:** `content`, `actions`, `data`, `enrichment-arc`
- **Depends on:** [043](043-actions-core_DONE.md)/[044](044-action-consequences-and-object-action-relationships_DONE.md) (schema, consequences), [045](045-job-shifts-and-work-actions_DONE.md) (job declarations), [046](046-brain-and-hooks_DONE.md) (selection metadata is consumed), [049](049-content-planning-lists_DONE.md)/[050](050-objects-data-backfill.md) (names + objects to reference)

## Goal

Fill `actions.json` with the continuous and discrete Actions a Person can do — the free-time repertoire, the social repertoire, and the per-job work Actions — from [`docs/planning/work-actions.md`](../planning/work-actions.md) and the behavior catalog in [038 §8](038-simulation-enrichment-architecture_DONE.md).

## Requirements

- **Free-time continuous Actions** (with child pools/sequences, requirements, selection weights + modifiers): sleeping, resting, wandering around, sitting in a park, visiting relatives, visiting friends, spending time at home, reading, watching television, cooking, gardening, exercising, playing at a playground, shopping, browsing a store, going to the beach/bar, studying, cleaning, hobby work, caring for children, socializing at work breaks, running errands — the initiating brief's worked examples (wandering, visiting relatives, playground, spending time at home) implemented substantially as specified there, including their child pools (e.g. wandering's "Pocketed a small object" with the full object-eligibility requirements; visiting relatives' "Gave away an old possession" as a real instance transfer with age/duplicate-possession selection modifiers — expressed as data, never Brain code).
- **Social Actions** with `target: Person` parameters (talk/greet/help/give object/borrow/return/share food/invite/visit/argue/apologize/play/teach/advise/job lead/ride/celebrate…), target selection data-driven (relationship-type allowances, proximity/reachability requirements, modifier-favored pairings — parents→children gifts, grandparents→grandchildren, duplicate-possession giveaways, borrowed-object returns). All transfers are Action consequences with causation.
- **Work Actions**: the shared continuous/discrete catalogs referenced by 045's per-job declarations, satisfying its validator (≥ 5 + 5 per job title).
- Every action carries honest **requirements** (hard gates) and **selection modifiers** (variety), cooldowns/anti-repetition, preferred contexts, and a behavior category — Brain has no special cases per action.
- Scale: hundreds of actions. Curate from the planning lists; keep ids/labels consistent (continuous = gerund, discrete = past-tense log line).
- Where an action transforms objects, its [053](053-object-action-relationships-backfill.md) relationship entries must exist — land 051/053 in whatever order keeps validators green (they may merge into one PR if that proves simpler; note it in the PR).

## Non-goals

New engine primitives (spec follow-ups instead). Events content ([052](052-events-data-backfill.md)).

## Testing

- `validateAll()` green (all refs, bindings, both-direction event links).
- Simulation smoke: a seeded multi-day run where people sleep, work, wander, socialize, and accumulate plausible possessions; assert non-degenerate variety (no person locked in one action; pool interleaving visible; possessions grow over long runs).
- Selection-distribution tests for a few flagship actions (playground favors children; visiting relatives rises with age/retirement, per the declared modifiers).
