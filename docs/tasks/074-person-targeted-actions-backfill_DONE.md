# [Content] Person-targeted Actions backfill — contracts, consent flags & decline events

- **Type:** Content / Migration
- **Labels:** `actions`, `social`, `content`, `progression-arc`
- **Depends on:** [072](072-person-targeted-action-contracts_DONE.md) (schema + hook), [073](073-consent-and-action-failure_DONE.md) (consent/failure semantics), [068](068-generalize-actions-and-events_DONE.md) (generic give/borrow/return verbs)

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

---

## Outcome (as merged)

- **Postures:** 7 askFirst (`gave_object_to_person`, `lent_an_object`, `returned_borrowed_object`,
  `shared_food_with_person`, `invited_person_over`, `taught_person_something`, `hugged_person` — NEW, the set
  had no affection action) / 12 non-consent, including the hostile `argued_with_person` (no punch-class action
  added — the argument covers the canonical non-consent case; this is a life sim). Kissing deferred: a
  partner-gated affection action needs relationship-context selection drivers that don't exist yet.
- **onDecline:** the four object transfers `failParent`; hug/invite/teach `skipStep`. All 19 carry curated
  `selection` weights/cooldowns (returns heaviest at 3.0, giving rarest at 0.12).
- **Decline events (keep/skip):** `action_declined` wired on `gave_object_to_person` + `lent_an_object` only
  (`events.onDecline`, validator-gated to askFirst actions); returned/shared_food/hug/invite/teach declines
  keep the failed log entry as their record. `action_failed` stays reserved.
- **Return-side coherence:** the socialOpportunityHook now binds `returned_borrowed_object` to the OWNER of a
  carried borrowed instance (co-located only), and skips any candidate with required params it can't bind.
- **Noted gaps (future drivers, not forced):** relationship-context selection modifiers (parent→child gift
  weighting) and duplicate-possession queries are inexpressible in today's predicate/modifier grammar; pool
  children cannot bind person params (the validator forbids required-param pool children), so the
  visiting_relatives kin-loop binding waits for pool param binding — household co-location already routes the
  give/lend/return verbs through the social hook at home.
- **Marriage:** remains Engine-B owned (ratified in 056); no `proposed_marriage` action added.
- **Sampled balance (fixture trio, 30 days, seed 9):** 1.27 social actions/person/day, 26 askFirst attempts,
  23.1% consent-decline rate. Bands pinned in `test/personTargetedBackfill.test.ts` (re-print with
  `PRINT_RATES=1`).
