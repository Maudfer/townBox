# [Framework] The needs engine — the motivational substrate

- **Type:** Framework (state + selection integration)
- **Labels:** `simulation`, `needs`, `brain`, `framework`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  A (A1–A5). Phase 2. The single highest-leverage change of the arc.
- **Save:** v16 (the `needs` section).

## Goal

The Brain was stateless; free-time selection was a weighted dice roll per (tick, person), so *randomness was
structural* — nothing linked this hour's pick to the last or the next. Give every person a small closed set
of need meters whose urgency reshapes selection, turning variety from noise into rhythm, and giving the
whole 260-action corpus purpose without deleting a single action.

## What shipped

1. **The need set (A1):** six meters — `food`, `rest`, `social`, `fun`, `hygiene`, `purpose` — as closed
   Context attributes.
2. **State & determinism (A2):** `game/population/Needs.ts` holds `{ level, updatedAtTick }` per need;
   decay is **closed-form** from authored per-need curves — never per-tick mutation — so off-screen people
   cost nothing and the generator's day stride integrates exactly (the K2 seam). Lazy deterministic
   initialization from `(worldSeed, personId, need)`; save v16 backfill shared by live and asset-hydrated
   people.
3. **Authoring surface (A3):** actions declare `"satisfies": { "food": 45, … }` (discrete children fill —
   *eating* the meal fills `food`, not the cooking wrapper — which makes cooking→eating a real chain);
   `json/needs.json` holds decay curves + the urgency→weight gradient; a `needs` validator enforces every
   `satisfies` key is declared and every need is satisfiable by ≥5 actions (the 076 reachability tradition).
4. **Selection integration (A4):** `Brain.computeFreeTimeAction` + the social hook multiply each candidate's
   weight by need urgency; a new `needsHook` (before `idleFallback`) proposes a required-necessity intent
   above a critical threshold (a starving person interrupts leisure to eat). Authored modifiers still apply
   on top — data keeps the last word — and it stays the same deterministic seeded pick, so live/bootstrap
   equivalence holds structurally.
