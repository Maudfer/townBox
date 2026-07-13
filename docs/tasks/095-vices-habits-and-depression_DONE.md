# [Feature] Vices, habits & depression arcs

- **Type:** Feature (state + data-first)
- **Labels:** `simulation`, `mood`, `habits`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — G3.
  Phase 3.
- **Save:** v16 (the `habits` section).

## Goal

"No concept of bad stuff — depression, alcohol." Make coping behaviors emerge from coherent causes — the
brief's *death in the family → grief → drinking → maybe trouble* — with **zero scripting of the chain
itself**.

## What shipped

1. **Coping behaviors gated on mood/grief:** `at_the_bar` gains mood-low multipliers; new `drank_alone`,
   `stayed_in_bed_all_day`, social-withdrawal actions — each dampened or boosted by the depressed/low-mood
   state through the normal selection gates.
2. **Habits (`game/population/Habits.ts`, `json/habits.json`):** a per-vice counter with closed-form cooling;
   repeated coping raises the habit's own selection weight (`selectionMultiplier`) — addiction as a
   positive-feedback loop in the same selection math, no bespoke system. The escalation loop is the fuel the
   crime habit (099) reuses.
3. **Depression as a wired state:** mood held below a threshold for N consecutive days commits
   `depressive_episode` — a *state*, not a line — that deepens the withdrawal gates until lifted by a
   recovery arc (`lifted_spirits`) whose hazard reads social support (close-friend/family interaction
   frequency, 083), healthcare coverage (096), and time. Someone whose friends keep visiting climbs out
   sooner — measured through the same selection math. The full grief→coping chain emerges from G1's grief
   impulse × these mood gates.
