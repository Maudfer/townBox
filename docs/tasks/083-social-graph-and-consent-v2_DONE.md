# [Framework] The social graph & consent v2

- **Type:** Framework (state + predicate grammar + policy)
- **Labels:** `simulation`, `social`, `framework`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  B (B1–B3 store/effects/predicates + target weighting, B6 consent v2). Phase 1.
- **Save:** v15 (the elective `socialGraph` section).

## Goal

The social graph **was** the family tree — `types/Social.ts` had no friend, rival, or dating relationship,
so `made_friend`/`argument` emitted a feed string and mutated nothing, and the social hook picked "a random
companion". Add elective bonds carrying strength and history so interactions can prefer targets, gate
intimate acts, and grow relationships over time.

## What shipped

1. **The graph (B1):** `game/population/SocialGraph.ts` — a serialized store keyed by the unordered
   person-id pair (`{ kind, strength 0–100, formedAtTick, lastInteractionTick, provenance }`), kinds
   friend/close_friend/rival/dating/engaged/ex_partner. **Family stays derived** (the genealogy remains the
   sole source of kinship — the "kinship is derived, never stored" rule is untouched); the graph holds only
   elective bonds. Strength decays closed-form from `lastInteractionTick` (the K2 rule — the generator
   strides over it exactly), so neglected friendships genuinely fade.
2. **Mutation + policy (B2):** an `adjustRelationship` event effect + consequence op; kind transitions
   (thresholds, romance flags, rival-from-negatives) authored in `json/relationships.json` — the policy is
   data, the primitive is code.
3. **Predicate & target weighting (B3):** a `relationship` predicate node + `relationshipToTarget` /
   `strengthToTarget` context attributes; the `socialOpportunityHook` weights candidates by edge kind and
   strength instead of picking at random.
4. **Consent v2 (B6):** `game/actions/Consent.ts`'s placeholder 80%-yes roll became a scored policy —
   base by action posture, shifted by edge kind/strength (mood/traits/reputation join it in later tasks),
   on the same salted, stream-isolated RNG so declines now **dent strength** and mean something.
