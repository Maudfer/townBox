# [Feature] Street life — ambulatory actions & map activity bubbles

- **Type:** Feature (world adapter + data + scene)
- **Labels:** `simulation`, `movement`, `hud`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  E (E1–E3) + J2 (map bubbles). Phase 3.

## Goal

"People mostly do things inside buildings; the simulation is visually dull." `location: 'outside'` existed
but outdoor continuous actions didn't *move* anyone. Get people onto the streets, visibly, and let the
streets narrate themselves.

## What shipped

1. **Ambulatory actions (E1):** an `ambulatory` action field (`stroll`/`jog`/`run`); in `LiveWorld` an
   ambulatory instance walks a route over the existing curb/crosswalk network and keeps the person visibly
   moving while it runs; `BootstrapWorld` treats it as any immediate transition — no `if bootstrap`, the
   adapter seam holds. Stepping outside (a person at their entrance, no longer indoors) resolves immediately.
2. **The outdoor repertoire (E2):** new outdoor actions with proper requirement gates — jogging, taking a
   walk, evening strolls, window shopping, street games, `cleaning_the_sidewalk` (ties into the 101 litter),
   the couple walk (a 085 joint plan, both sprites on one route).
3. **Presence & the bubbles (E3/J2):** outdoor performers stay visible (not indoors-hidden); a throttled
   `MainScene` overlay floats the current action label over each visible outdoor person, refreshed per
   in-game minute. The street becomes self-narrating.

*(A latent bug in the bubble creation — the label map was never populated — was found and fixed later in
task 115.)*
