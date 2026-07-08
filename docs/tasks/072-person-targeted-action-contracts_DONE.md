# [Framework] Person-targeted Action interaction contracts

- **Type:** Framework / Simulation
- **Labels:** `actions`, `brain`, `social`, `progression-arc`
- **Depends on:** [067](067-parameterized-requirements-and-event-payloads_DONE.md) (param plumbing), [056](056-progression-arc-discovery-baseline_DONE.md)
- **Blocks:** [073](073-consent-and-action-failure.md) (consent rides the contract), [074](074-person-targeted-actions-backfill.md)

## Goal

Every Action that targets another Person carries an explicit **interaction contract** — which parameter is the
target, same-building co-location, `askFirst`, self-targeting, and sequence-failure behavior — expressed as
action-level capabilities (not fragile per-action requirement fragments), validated, and **actually exercised**:
a target-selection path finally binds the `target` param, resurrecting the 18 person-targeted actions that are
dead content today.

## Background (verified)

18 actions declare a required `person` param (the 044/053 social/lending set: `lent_an_object`,
`returned_borrowed_object`, `gave_object_to_person`, `greeted_person`, …) and **nothing ever binds it** — no
hook supplies `params.target`, so none of them fire in normal play. `moveObjectToPerson`/`targetPerson`
ownership resolution works at the consequence layer. There is **no same-building check**: `WorldAdapter.peopleAt`
/`locationOf` exist but are not consulted by the engine for targets, and the predicate grammar has no
person-proximity node (deliberate — the contract is action-level capability, not grammar).

## Requirements

### Schema — the `interaction` block

- `ActionDefinition` gains `interaction?: { targetParam: string; requiresSameBuilding: boolean;
  askFirst: boolean; allowSelf: boolean; onDecline?: StepFailurePolicy }`:
  - `targetParam` names the `person`-typed parameter that identifies the target.
  - `requiresSameBuilding` — **must be `true` for every person-targeted action this iteration** (no phone
    calls / remote interaction yet; the field exists so relaxing later is data, not schema).
  - `askFirst` — consent required ([073](073-consent-and-action-failure.md) implements the flow; this task
    lands the field + validation).
  - `allowSelf` — default false; engine rejects self-targeting unless set.
  - `onDecline` — how a declined/failed instance behaves **as a sequence child**, reusing the existing
    `StepFailurePolicy` (`blockParent | skipStep | failParent`); default follows the sequence's
    `onStepFailure`, with the documented default that a failed child fails/interrupts its parent (a rejected
    `give` must never let the sequence continue as though the object changed hands).
- **Validator (the teeth):** any action with a `person`-typed parameter and no `interaction` block is
  **rejected**; `targetParam` must reference an existing `person` param; `requiresSameBuilding: false` is
  rejected this iteration (lifted later by data change + validator relaxation).

### Engine — enforcing the contract

- At start (and re-checked at consent time in 073): resolve the target — must be a live, currently simulated
  person; if `requiresSameBuilding`, `world.locationOf(target)` must equal `world.locationOf(actor)`
  (`locationKey` equality) — violation is a typed failure (`target_not_present`) with zero mutations. Works
  identically through `BootstrapWorld` (locations are logical either way).

### Target selection — making the content live

- A **`socialOpportunityHook`** (new built-in Brain hook, the 046 registry already reserves the slot):
  onTick/free-time, for a person not obligated — deterministic candidate targets from
  `world.peopleAt(locationOf(person))` (co-located, excluding self), filtered by the action's own
  requirements, weighted by relationship context where cheap (household members, then relatives via existing
  kinship derivation), seeded fork `worldSeed → tick → personId → salt`, sorted candidates. It proposes
  person-targeted intents **with `params.target` bound**. Modest frequency (config/weights) — social actions
  should season free time, not dominate it.
- Free-time selection: person-targeted actions without a bindable target are hard-excluded from candidates
  (no half-proposed intents).

## Non-goals

The consent evaluation itself and failure handling (073). Data backfill of contracts across the social
repertoire (074). Remote interactions, invitations-to-elsewhere, multi-target actions (schema leaves room —
`targetParam` names one param; note the future). Relationship mutation from interactions.

## Testing

- Validator: person-param-without-contract rejected; bad `targetParam` rejected; `requiresSameBuilding: false`
  rejected (fixtures).
- Engine: same-building enforced (co-located succeeds, elsewhere ⇒ typed `target_not_present`, zero
  mutations); `allowSelf` respected; dead/despawned target ⇒ typed failure.
- Hook: with two co-located household members, social intents propose with bound targets; empty building ⇒
  none; deterministic across runs; live/bootstrap identical (extend `test/executionBoundary.test.ts`).
- The previously dead `lent_an_object`/`returned_borrowed_object` pair now fires end-to-end in a fixture
  household (lend → borrowed possession → return), through the hook, with correct ownership semantics.
