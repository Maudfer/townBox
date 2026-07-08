# [Feature] Consent evaluation & Action failure handling

- **Type:** Feature / Simulation
- **Labels:** `actions`, `brain`, `social`, `progression-arc`
- **Depends on:** [072](072-person-targeted-action-contracts.md) (`askFirst` contract), [067](067-parameterized-requirements-and-event-payloads_DONE.md) (failure-reason payloads)
- **Blocks:** [074](074-person-targeted-actions-backfill.md)

## Goal

`askFirst` actions route a **consent request through the target Person's Brain** before any consequence runs; a
decline resolves the action as **failed** with reason `consent_declined`, zero normal consequences, a traceable
log entry — and Brain **consumes failure** (no auto-retry, cooldown respected, decision-making continues).
Alongside consent, action failure generally gets the typed-reason treatment it currently lacks.

## Background (verified)

No consent mechanism exists. Brain is **stateless** (status/anti-repetition derive from instances/history) and
is never invoked for another person mid-tick — but consent needs no cross-person *state*: a pure evaluation
function on the target's context fits the existing architecture cleanly. Runtime action failures carry **no
typed reason** (`ActionLogEntry` has lifecycle only; typed outcomes exist only at start time); Brain has **no
reaction to any outcome** (`actionCompletedHook` is a stub; failure/blocked/interrupted are observed by
nothing). Sequence child failure policies (`blockParent | skipStep | failParent`) exist and work.

## Requirements

### Consent flow

- Order, per the vision: Brain proposes (normal selection) → engine validates all normal requirements incl.
  same-building (072) → **before consequences**, the engine calls the target's Brain:
  `Brain.evaluateConsent(request)` where `request = { actionId, params, sourcePersonId, targetPersonId, tick,
  ctx }` — a **pure, stateless** method (fits Brain's design; no queue, no cross-person mutation) with access
  to the same context deps hooks get (relationship facts, current activity, history) *for future use*.
- **Placeholder policy (this iteration):** deterministic **80% yes**. RNG: fork
  `worldSeed → tick → CONSENT_SALT → hash(source) → hash(target) → instanceSeq` — deterministic for a given
  (seed, action instance, source, target, tick), **independent of execution order** (its own salted stream;
  never perturbs event/brain/orchestrator streams — the JobOrchestrator salt precedent), identical in
  live/bootstrap. Document loudly that this is a placeholder for future contextual logic (relationship quality,
  personality, mood, past events, current activity, risk, action type) — the signature above is the extension
  point.
- Accept → action proceeds normally (consequences, success events). Decline → resolve **failed**:
  - outcome `failed`, `failureReason: 'consent_declined'`;
  - **no normal consequences, no success lifecycle events** (onComplete never fires; decide + document whether
    onInterrupt fires — recommended: no; failure is its own terminus);
  - a log entry carrying source, target (in params), params snapshot, tick, causation id, and the reason.

### Typed runtime failure (general)

- `ActionLogEntry` gains optional `failureReason` (additive; log round-trips) — populated for *all* runtime
  failures, with a closed reason vocabulary: `consent_declined`, `target_not_present` (072),
  `inputs_unavailable` (the OAR/consequence plan downgrade — today's silent `failed`), `requirements_unmet`,
  plus room for growth. Surface it in the HUD person log.
- Generic **`action_failed`** / **`action_declined`** events (reserved in 068): manual, parameterized (067) —
  fired **only where downstream simulation needs them**, not for every failed low-level interaction by default
  (this iteration: nothing auto-fires them; they exist for 074's curated cases and future Brain/relationship
  reactions — document the restraint).

### Brain consumes failure

- Dispatch outcomes to hooks: implement the reserved `onActionCompleted`-family dispatch minimally — a failure
  notification path (`onActionFailed` kind or outcome-carrying completion dispatch; pick the smallest design
  consistent with 046's registry) so Brain-side logic runs in the same tick's phase 7.
- Behavior on failure: the failed intent is gone (intents are per-tick already — assert), **no automatic
  retry**, and the same action is not re-selected *in immediate response* — enforce via anti-repetition:
  failed attempts count toward `hasAction`-style recency and the action's `selection.cooldownTicks` applies
  after failure (decide/document how `hasAction` treats failed lifecycles — likely a query flag so
  requirements can distinguish "did X" from "attempted X"). Normal decision-making resumes next hook/tick.
- **Sequence children:** a consent-declined child follows 072's `onDecline`/`onStepFailure` policy —
  default fails/interrupts the parent; a declined `give` never lets the sequence continue as if it succeeded
  (pin the exact case).

## Non-goals

Contextual consent logic (future — placeholder only). Relationship consequences of declines (future; the
`action_declined` event is the hook). Retry strategies/backoff. Multi-party consent.

## Testing

- Consent determinism: same (seed, instance, source, target, tick) ⇒ same verdict, across two runs and across
  live/bootstrap; ~80% acceptance over a large sample; **stream isolation** — enabling/disabling a consent roll
  does not shift any other subsystem's RNG draws (bit-compare a with/without-consent-action run's unrelated
  streams, the eligibility-index test pattern).
- Decline path: zero consequence mutations (inventory/money/state conservation), no onComplete event, log entry
  with `consent_declined` + causation; accept path identical to a non-askFirst run.
- Brain: no re-proposal of the failed action within its cooldown; next-tick selection proceeds; failed-attempt
  recency visible to requirements per the chosen `hasAction` semantics.
- Sequences: declined child under default policy fails/interrupts the parent (the `give` case); `skipStep`
  fixture continues correctly.
- Failure reasons: each closed-vocabulary reason produced by its trigger and rendered in the person log; save
  round-trip of entries with reasons.
