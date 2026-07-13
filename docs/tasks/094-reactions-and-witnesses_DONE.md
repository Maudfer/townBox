# [Feature] Reactions & witnesses

- **Type:** Feature (dispatch extension + data)
- **Labels:** `simulation`, `events`, `social`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — C3
  (reactions) + C4 (witnesses). Phase 3 — wants mood (091) and traits (087) for the reaction rolls.

## Goal

"People do things to other people that other people don't react to." Counterpart logging (082) gave the
target the record; now give them the *response*, and let co-located bystanders see the scene — the substrate
gossip (104) later turns into town memory.

## What shipped

1. **Role-participant fan-out (C3):** commit fan-out extended so role-bound participants (not just the
   subject) receive the `onEventCommitted` hook; a `reactions` field on events authors the answers
   (`thanked_person` after a gift, a hug back, a retort after an argument), one level deep (the 073
   decline-dispatch precedent — structurally no loops), same-tick, deterministic rolls on the person's
   forked stream. A `reactionsHook` in the Brain dispatches them. Co-located scenes start reading as scenes.
2. **Witnesses (C4):** co-located third parties log a rate-limited witnessed entry (≤3 per scene, once per
   witness per day via the event's own limit) — one more fan-out with a `witness` role. Cheap
   Dwarf-Fortress texture, and the store the 104 known-facts/gossip system reads.
3. **The valence/trait inputs:** reaction rolls read mood (091) and traits (087) — the retaliate-vs-
   de-escalate choice reads temper.
