# [Feature] Reputation & gossip — the town remembers

- **Type:** Feature (state + action)
- **Labels:** `simulation`, `social`, `reputation`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  O. Phase 5 — rides witnesses (094), valence (091), edges (083).
- **Save:** v16 (the `knownFacts` section).

## Goal

The Dwarf-Fortress texture multiplier: turn incidents into social reality. Make "everyone knows what he did"
a mechanical truth instead of a narration.

## What shipped

1. **Known facts (O1):** a per-person, capacity-capped memory of *references* to other people's notable log
   entries — witnessed directly (094) or heard (O2). No new content: a fact points at an existing log seq.
   Serialized, and facts decay (old gossip fades). Only notable scenes (nonzero valence) are worth
   remembering.
2. **Gossip propagation (O2):** `shared_gossip` — a co-located, relationship-gated social discrete that
   transfers the speaker's juiciest known fact (`|valence| × recency`, never about either party) to the
   listener; the `heard_gossip` counterpart lands the listener's log line, and City's committed loop moves
   the fact (`transferGossip`). B's edges decide who talks, 094 decides what is knowable, this decides how
   it travels — a witnessed crime becomes town knowledge in days, no scripted broadcast.
3. **Restraint (O4):** facts are bounded, decaying references — deliberately not a beliefs/deception system.
