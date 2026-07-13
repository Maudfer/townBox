# [Feature] Pets on the street — the dog trails the walk

- **Type:** Feature (scene + data)
- **Labels:** `simulation`, `pets`, `scene`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 115.
- **Depends on:** [103](103-pets_DONE.md).

## Goal

Make the 103 companion system visible — a dog trailing the owner on the walk — and make owners reliably walk
their dogs.

## What shipped

1. **The pet sprite:** a tiny brown rectangle (`MainScene` overlay) trailing the owner's sprite with a fixed
   lag while `walking_the_dog` runs — created on the first refresh that sees the walk, follows in the redraw
   closure, hidden when the instance ends. No pathfinding of its own.
2. **A latent 093 gap closed:** the activity bubbles were never CREATED — `refreshActivityLabels` only read
   the label map, which stayed empty forever, so the street never actually narrated itself. Labels are now
   lazily created per person; the pet dot rides the same lifecycle.
3. **Walk pressure:** a `dog_walk` routine (cadence 1 day, adoption 1, `petCount ≥ 1`) so owners reliably
   plan the walk — the neglect texture stays free (a depressed owner's dampened walks happen less through the
   action's own 103 modifiers, never through planning randomness).

Tests: the planner suite (owner reliably walks within two days; petless never plan it). Sprite lifecycle is
browser-suite territory (scene code, per the 008 split).
