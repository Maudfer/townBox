# [Content] Person-targeted Actions backfill — contracts, consent flags & decline events

- **Type:** Content / Migration
- **Labels:** `actions`, `social`, `content`, `progression-arc`
- **Depends on:** [072](072-person-targeted-action-contracts.md) (schema + hook), [073](073-consent-and-action-failure.md) (consent/failure semantics), [068](068-generalize-actions-and-events.md) (generic give/borrow/return verbs)

## Goal

Every person-targeted action in the manifest carries its interaction contract with the right `askFirst`
posture: affection, object transfer, borrowing, and invitations **ask first**; hostile acts don't. All require
same-building co-location this iteration. Decline/failure events are added only where something downstream
consumes them.

## Background (verified)

The person-targeted set (18 actions pre-068, likely consolidated by the generic-verb sweep):
`greeted_person`, `talked_to_person`, `asked_for_help`, `gave_object_to_person`, `shared_food_with_person`,
`lent_an_object`, `returned_borrowed_object`, borrow-side actions, play/celebrate/help-type socials, plus
whatever 068 added (generic `give`/`borrow`/`return`). Hostile actions: audit what exists — `argument` is an
*event* (probabilistic, engine-owned); a `punch`-like discrete action may not exist yet (add only if the sweep
wants a canonical non-consent example; keep it mild — this is a life sim, not a combat system).

**Marriage note (ratified in 056):** marriage remains **Engine-B owned** (the `marriage` event with its
two-role search, cohabitation signals, 023 machinery) — it is not converted to a consented action in this
iteration. If a `proposed_marriage` action is wanted for narrative texture, it may *manually invoke* the
marriage event on acceptance — optional stretch, explicitly not required. Document the decision either way.

## Requirements

- **Contract backfill:** every action with a `person` param gets its `interaction` block (the 072 validator
  makes this unskippable — this task is satisfying it across the manifest):
  - `askFirst: true` — kissing/hugging/affection (add if missing from the social set), giving an object,
    lending, **borrowing** (asking to borrow), invitations (inviting someone along to an activity — if 068/data
    has them), sharing food, teaching/helping where imposition is real.
  - `askFirst: false` — greetings, casual talk, playing with a willing household child (judgment call —
    document), and hostile acts (the punch-class: no one consents to being punched).
  - `requiresSameBuilding: true` universally (072 enforces); `allowSelf: false` throughout;
    `onDecline` set per action (object transfers: fail the parent sequence; casual socials: `skipStep` where
    they're pool flavor).
- **Return-side coherence:** `returned_borrowed_object` should target the *owner* of a carried borrowed
  instance (the ownership-vs-possession split identifies it) — ensure the socialOpportunityHook (072) can bind
  that specific target so lending loops actually close over time.
- **Selection modifiers:** apply the vision's social-context weighting as data — giving favors
  parent→child / grandparent→grandchild / duplicate-possession givers (`carries` + relationship-context
  modifiers as expressible today; note gaps for future modifier drivers rather than forcing them); visiting-
  relatives children (`visiting_relatives` pool) bind the give/lend/return verbs so the household-and-kin loop
  from the vision runs.
- **Decline events, curated:** wire `action_declined` (073) only where a consumer exists or is imminent —
  suggested: object-transfer declines (future relationship systems will care; the feed can surface a gentle
  "X wouldn't take the gift" if desired — optional). Everything else: the failure log entry is enough. Record
  the keep/skip choice per action in the 068 classification table.
- Frequency/balance pass on the socialOpportunityHook weights with the full contracted set: social actions
  occur at plausible rates on the fixture town (record sampled rates in the PR; tune weights/cooldowns).

## Non-goals

New social systems (relationship quality mutation, reputation). Remote interaction. Marriage-as-action (see
note). Combat mechanics.

## Testing

- Validator green across the manifest (every person-targeted action contracted); spot fixtures: an `askFirst`
  decline produces the 073 failure shape; a non-consent hostile act never consults consent.
- End-to-end social loops on a fixture household: give (consented) transfers ownership+possession; lend →
  return closes with the borrowed instance back at its owner; declined give leaves inventories untouched.
- Distribution sanity: over N simulated days, consent declines ≈ 20% of askFirst attempts; social action rates
  within the recorded bands; deterministic across runs and modes.
- `npm run docs:sim` regenerated (action↔event links changed).
