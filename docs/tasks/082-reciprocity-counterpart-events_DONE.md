# [Core] Reciprocity — counterpart events & the fake-double rewires

- **Type:** Core engine + data
- **Labels:** `simulation`, `events`, `actions`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  C (C1 counterpart events, C2 fake-double demotions). Phase 1.
- **Depends on:** the 067 event-payload machinery.

## Goal

Fix the reciprocity fake-out the audit found: `gave_object_to_person` moved the object and logged only the
**giver's** side, while `received_gift` existed and fired **probabilistically at random**, unconnected to
any real gift. The manifest held both halves of dozens of interactions and they never touched. Wire the
second half from the real source.

## What shipped

1. **Counterpart event links (C1):** the action `events` block gained `onCompleteTarget` — the engine fires
   the target-side event through the existing `EventEngine.invoke` with **subject = the target**, the same
   `causationId`, and a typed payload built from the action's params (`$actor`/`$params`). The receiver's
   inspector now shows "Received a gift — …, from Ana Souza" chained to the same seq as Ana's "Gave a gift".
   Zero new logging machinery — pure reuse of invoke + params (067) + causation.
2. **The fake doubles demoted (C2):** the flagship rewire set — `received_gift`, the object transfers,
   lend/return, teach, argue — lost their `probabilistic` triggers and became manual-only, fired from the
   C1 links. **No event was deleted**; each gained a true source instead of a dice roll.
3. **The event-classification generator** (`docs/generated/event-classification.md`) tracks the rewiring so
   the checked-diff doc records the counterpart dispositions.
