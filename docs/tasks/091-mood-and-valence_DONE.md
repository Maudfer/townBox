# [Feature] Mood + the event-valence pass

- **Type:** Feature (state primitive + data pass)
- **Labels:** `simulation`, `mood`, `events`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — G1 (with
  the P2 valence tagging). Phase 3.
- **Save:** v16 (the `mood` section).

## Goal

The audit found "a lot of Events have no consequence". Give every event mechanical effect through a single
per-person state — grief becomes a *state*, not a log line — and give the whole texture corpus meaning
without touching a single probability.

## What shipped

1. **Mood (G1):** `game/population/Mood.ts` — a per-person 0–100 morale, serialized, **closed-form**
   mean-reverting toward a baseline via decaying impulses (the K2 rule). Big impulses decay slowly: a
   spouse's death is a large negative with a months-long half-life. Mood feeds selection exactly like needs
   do (multipliers through the same gradient), feeds consent (083), and displays in the inspector.
2. **The valence pass:** every event declares `valence: -3..+3` (a 414-event data pass across the manifest —
   most texture events get ±1, which retroactively gives the whole texture corpus mechanical meaning). An
   event commit lands its valence as a mood impulse; the event-classification generator tracks the column.
3. **The bounded impulse store:** impulses prune decayed dust and keep only the strongest few — one meter,
   bounded state, deterministic.
