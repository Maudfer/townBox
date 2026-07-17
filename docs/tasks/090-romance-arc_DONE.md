# [Feature] The romance arc — courtship, dating, proposal

- **Type:** Feature (data + one wired handler)
- **Labels:** `simulation`, `social`, `events`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — B4–B5.
  Phase 2.
- **Depends on:** [083](083-social-graph-and-consent-v2_DONE.md), [085](085-planner-routines-and-joint-plans_DONE.md),
  [086](086-arbitration-v2-bands_DONE.md).

## Goal

Marriage was a probabilistic event over any eligible pair — it married strangers, and `had_sex` had no
partner gate at all. Rebuild courtship as stages gated on the social graph, every existing event kept and
retriggered.

## What shipped

1. **The stages (B4):** repeated positive interactions grow acquaintance→friend edges (from the C interaction
   deltas); `asked_someone_out` (askFirst) → consent → a `dating` edge, decline → the existing
   `action_declined` machinery + a cooldown + a strength dent; dating couples get planner dates (085 joint
   plans) that grow strength; `had_sex` gains the relationship gate (`dating|spouse`) — fixing both the rate
   outlier's incoherence and its magnitude; `proposed_marriage` (askFirst, planner-placed at a nice venue —
   the propose-at-the-park worked example) → engaged; the existing `marriage` event keeps Engine-B ownership
   but its eligibility gains the `relationship: dating/engaged, minStrength` gate — it stops marrying
   strangers. Divorce hazard reads sustained low strength + rival edges + mood; `ex_partner` edges persist.
2. **Asset & hydration (B5):** the generator runs the same graph off-map (105), so drawn people arrive with
   friends and partners; a deterministic backfill synthesizes edges for pre-graph assets and cold starts.
