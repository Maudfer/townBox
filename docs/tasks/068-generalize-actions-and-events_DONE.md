# [Migration] Generalize Actions & Events

- **Type:** Migration / Content
- **Labels:** `actions`, `events`, `content`, `progression-arc`
- **Depends on:** [067](067-parameterized-requirements-and-event-payloads_DONE.md) (param plumbing)
- **Blocks:** [071](071-building-context-action-requirements_DONE.md) and [074](074-person-targeted-actions-backfill.md) build on the generalized verbs

## Goal

Sweep the 255 actions and 698 events for over-specific entries: object-specific **actions** become generic
parameterized verbs (`grab(object)`, not `grab_pencil`); object-specific **events** become generic
parameterized events (`object_acquired(object)`, not one hardcoded event per household item) *where an event is
still warranted at all* — and sequences keep their specificity by **binding** the generic verbs to concrete
values. Generic must never mean vague: every generic action stays strongly parameterized and validated.

## Background (verified)

- Actions: `grab_pencil` (hardcoded archetype in requirement + consequences) and `pocketed_small_toy`
  (hardcoded `childhood` tag) are the canonical offenders; `pocketed_small_object` (flag-driven) is the good
  template. Meal/craft specificity already lives correctly in OAR entries, not per-object actions.
- Events: object texture events hardcode objects into ids (`bought_new_couch`, `lost_keys`,
  `lawnmower_never_returned`, …); **~151 manual-only events are invoked by nothing** (placeholders from 052);
  `ActionLogEntry.params` already records what actions did — events should not duplicate the action log.
- Sequences support `$parent.<param>` / `$previous.output` bindings and per-step `params` — the binding
  mechanism for keeping `bake_cake` concrete over generic children already exists.

## Requirements

### The generic verb set (actions)

- Author/consolidate the generic object verbs, each with typed params, real requirements (067 param-refs), and
  instance-moving consequences: `grab` / `pocket` (move a real instance from the location into possessions —
  **never conjure**), `place`, `store`, `discard`, `consume`, `use`, `repair`, `clean`, `buy`, `sell`, and the
  person-targeted `give`/`borrow`/`return` (contract details land in
  [072](072-person-targeted-action-contracts_DONE.md)/[074](074-person-targeted-actions-backfill.md) — here just
  keep their object side generic). `grab(object)` requires, per the vision: a matching accessible instance at
  the current location (`objectAtLocation` param-ref), carryable flag; pocketable when the destination is
  pocket-like; no conflicting ownership/access rule (keep to the existing owner-kinds semantics; full access
  rules are 069/070 metadata).
- Fold the offenders into the generics: `grab_pencil`, `pocketed_small_toy`, and every similar
  hardcoded-object action either becomes a **sequence/pool child binding** of a generic verb (e.g. `wander`'s
  pool binds `pocket` with a tag/param) or is deleted. Update the child pools/sequences that referenced them
  (e.g. writing-like actions require a writing instrument and may bind `grab(object=pencil)` as a step).
- Buy/sell first pass: `buy` moves an instance from a business-owned stock when one exists and adjusts money;
  until [070](070-contextual-object-generation_DONE.md) fills shops, a validated fallback (create-with-provenance at
  a shop context) is acceptable — mark it clearly and revisit in 071. No silent conjuring outside that marked
  fallback.

### Event sweep

- Classification pass over all 698 (recorded as a checked-in table or in this task file): for each —
  **keep** (vital/narrative value, correctly triggered), **generalize** (fold hardcoded-object families into a
  parameterized generic: `object_acquired`, `object_given`, `object_received`, `object_lost`,
  `object_consumed`), **retire** (redundant with the action log and consumed by nothing), or **wire** (the
  ~151 never-invoked manual events: connect to a real caller — action lifecycle, orchestrator, 065 promotion,
  058 school — or downgrade/retire). Criteria: an Event exists for *meaningful state change, history entry, or
  a downstream trigger* (Brain/jobs/relationships/feed) — not to mirror every log line.
- Add the generic job/school events where downstream systems need them and no equivalent exists:
  `job_applied_for` is explicitly **not** needed (no application flow exists — hiring is `get_job`);
  `job_started`/`stopped` exist (`started_working`/`stopped_working`); promotion is 065's `got_promoted`
  (+ rank payload now); school events exist (058 wires them). `action_failed`/`action_declined` land in
  [073](073-consent-and-action-failure.md) — reserve the ids here.
- Texture preservation: the point of 052's texture layer is log richness — when generalizing, keep the *label
  variety* via payloads (the feed/log can render "bought a new couch" from `object_acquired(couch)` with a
  `bought` flavor param) or keep a curated subset of hardcoded texture events where the flavor is irreplaceable
  and rates are tuned. Do not mass-delete narrative texture for purity's sake — this is a judgment sweep, and
  the classification table is its reviewable artifact.
- Parameter-name consistency migration: normalize param names/types across actions and events (`object`,
  `target`, `recipe`, …) — validator-enforced going forward.

### Hygiene

- `npm run docs:sim` regenerated in the same PR (054 checked-diff gate). Validators updated for removed/renamed
  ids; OAR table keys re-pointed where actions renamed; save compatibility: the action/event logs store `defId`
  strings — removed ids must not break log *rendering* (HUD falls back to the raw id or a legacy-label map;
  decide and document).

## Non-goals

Consent/failure semantics (073). Person-target contracts (072). Building-context requirements backfill (071 —
this task only makes them expressible). New texture content.

## Testing

- Generic verbs: each verb's requirement/consequence round-trips on real instances (grab moves, never creates;
  consume depletes; repair state-gates) — extend `test/consequences.test.ts` patterns.
- Sequences: `bake_cake`-style chains still produce exactly one output through generic children with bindings.
- Sweep integrity: no action/event references a removed id (validators); every remaining manual event has at
  least one caller or a documented keep-reason (data test over the classification table).
- Log rendering: old saves with retired defIds still render person logs.
- Determinism + eligibility-index suites green.
