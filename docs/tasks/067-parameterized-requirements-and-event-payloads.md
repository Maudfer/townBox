# [Framework] Parameterized requirements, object refs & event payloads

- **Type:** Framework / Simulation
- **Labels:** `actions`, `events`, `predicates`, `progression-arc`
- **Depends on:** [056](056-progression-arc-discovery-baseline_DONE.md)
- **Blocks:** [068](068-generalize-actions-and-events.md) (generic actions/events are inexpressible without this), [073](073-consent-and-action-failure.md) (failure-reason payloads), [074](074-person-targeted-actions-backfill.md)
- **Note:** this task was added during the planning pass — the discovery found that the generalization arc's
  data work is *inexpressible* on current plumbing; landing it as data-backfill-time hacks would be worse.

## Goal

Three expressiveness gaps, one framework task: **(1)** action requirements and object queries can reference the
action's own parameters; **(2)** the action→event bridge can forward declared parameters; **(3)** events can
carry a small typed **payload** that lands in the log and the feed. Together these make `grab(object)` /
`object_acquired(object)` / `job_rank_promoted(rank)` authorable as *data*.

## Background (verified)

- Consequence `ObjectRef` already supports `{param}` (`Consequences.ts`), but the predicate grammar's
  `carries`/`objectAtLocation` take **static** `ObjectQuery`s only, and requirements are evaluated with no
  access to `params` (`ActionEngine.contextFor`). So "Grab X" can *move* X but cannot *require* X-at-location.
- `EventEngine.invoke` bindings are `Record<string, PersonId>` (roles only); `EventLogEntry` has **no params
  field** (contrast `ActionLogEntry.params`); `ActionEngine.fireEvent` passes `{}` — action params are
  discarded at the bridge. Feed messages (`util/notifications.ts`) are name-interpolated only.
- **The eligibility-index invariant is the hard constraint** (`test/eventEligibility.test.ts`): one RNG draw
  per probabilistic event per agent, bit-identical with/without the index. Payloads must ride the
  manual/automated/commit paths without changing probabilistic draw counts or order.

## Requirements

### Param-aware requirements & queries

- `ObjectQuery` gains a param reference form (e.g. `{ archetypeParam: "<name>" }` — resolved against the
  instance's `params` at evaluation; design the exact shape with the validators). Applies to `carries` and
  `objectAtLocation` predicate nodes **when evaluated as action requirements** (events have no params —
  validator rejects param-refs in event predicates), and to OAR `context`.
- `ActionEngine` threads the instance/start params into requirement evaluation (`contextFor`) and start-time
  validation: a param-referencing requirement on an action started without that param is a typed
  `missingParameter` failure.
- Validators: every referenced param exists on the action and has a compatible type
  (`objectArchetype`/`objectInstance` for object queries); predicate version bump if the grammar grows
  (`PREDICATE_VERSION` 2 → 3) with fixtures.

### Event payloads

- `EventDefinition` gains an optional `parameters` spec (typed like action params: string/number/boolean +
  object-archetype/rank-id-ish string domains; keep it scalar — no object graphs in logs).
- `EventEngine.invoke` accepts a `params` bag alongside role bindings; validated against the spec (typed
  rejection on mismatch); committed into a new optional `EventLogEntry.params` field (additive — the
  serialized event log stays backward-compatible; older entries simply lack it). Probabilistic commits carry no
  params (they have no caller) — document; automated `afterEvent` rules may forward a declared subset of the
  source commit's params (design minimally; skip if it complicates determinism).
- **Invariant guard:** zero changes to probabilistic evaluation order or RNG consumption —
  `test/eventEligibility.test.ts` must stay green untouched (bit-identical).
- Feed: `util/notifications.ts` message builders can interpolate payload values (e.g. "picked up a *pencil*",
  "was promoted to *Attending*"); HUD `PersonDetails` log rendering shows params on entries that carry them.

### The bridge

- `ActionEventLinks` (`events.onStart/onComplete/onInterrupt`) gains an optional param-mapping form:
  `{ event, params: { object: "$params.object", … } }` (string shorthand stays valid). `fireEvent` resolves the
  mapping from the instance's params/outputs and forwards it. Validator: mapped params exist on the action and
  match the event's spec.

## Non-goals

The actual generalization sweep (068). Consent/failure semantics (073) — only the payload capability they'll
use. New predicate node types beyond param-refs (same-building is 072's action-level capability, not grammar).
Params on probabilistic texture events.

## Testing

- Param-aware requirement: `grab(object=pencil)` requires pencil-at-location — satisfied/unsatisfied both ways;
  missing param ⇒ typed start failure; validator fixtures for bad param refs.
- Payload round-trip: manual invoke with params → log entry carries them → save/load round-trip → HUD/feed
  render; invalid payload ⇒ typed rejection, no commit.
- Bridge: an action's onComplete forwards `$params.object` into the event's payload with causation intact.
- **Eligibility-index suite untouched and green** (bit-identical invariant); determinism suites green.
- OAR `context` with a param-bound query resolves correctly in the bake-chain style tests.
