# [Core/Framework] Pause & resume + traits

- **Type:** Core (action lifecycle) + Framework (state)
- **Labels:** `simulation`, `brain`, `traits`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — L5
  (pause/resume) + Workstream M (traits M1–M3). Phase 2 — completes the utility currency's inputs before
  the content phases price against it.
- **Save:** v16 (paused instances).

## Goal

Two finishers for the Brain rework: continuous actions that survive interruption (the walk interrupted by a
chase continues after), and temperament that makes two neighbors in identical circumstances behave
differently — the other half of "too much looks random".

## What shipped

1. **Pause & resume (L5):** a `paused` lifecycle status for continuous instances flagged `resumable` —
   interruption from a higher band **parks** the instance instead of killing it (log: `interrupted` → later
   `resumed`, same instance id, causation chaining the interrupter), and a resume hook auto-enqueues
   resumption within a bounded window (past it, a typed abandonment entry — a broken plan is also story).
   The fleeing suspect's dinner is still on the stove when the chase ends.
2. **Traits (M1):** `game/population/Traits.ts` + `json/traits.json` — six axes (sociability,
   industriousness, temper, riskAppetite, orderliness, hedonism), 0–100, **derived** never stored, a
   deterministic blend of the person's own seeded roll and their parents' base rolls (one generation of
   heritability — family temperaments emerge for free). Asset people derive theirs from `(seed, personId)`
   so **no regeneration is needed**; a per-person memo caches (traits are effectively immutable).
3. **Where traits bite (M2):** actions declare `affinity` tags mapped to axes; L3's `scoreIntent` multiplies
   by the person's affinity factor — all through existing seams, no new decision machinery. The inspector
   shows traits as authored prose (M3), and validators enforce every affinity tag maps to a declared axis.
