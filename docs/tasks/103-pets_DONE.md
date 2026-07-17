# [Feature] Pets — small companions

- **Type:** Feature (state)
- **Labels:** `simulation`, `pets`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  N. Phase 5 — rides routines (085), ambulatory (093), mood (091).
- **Save:** v16 (the `pets` section).

## Goal

Disproportionate charm per line of code: make the manifest's pet dream real at the lightest fidelity that
pays. Pets exist through their owner's behavior — a new routine anchor, more street presence, and a grief
source that isn't a human death.

## What shipped

1. **The registry (`game/population/Pets.ts`, `json/pets.json`):** pets are lightweight serialized records
   (species, name, owner, birthTick) — **not** Persons, no Brain, no needs of their own. Capped per owner
   (`petCount` context attribute gates adoption).
2. **Wiring:** `adopted_a_pet` at the pet shop registers one (`resolveAdoption` draws the species and name);
   `caring_for_the_pet` is a daily routine; `walking_the_dog` is an ambulatory action gated on ownership,
   morning-boosted, on a cooldown; a pet's death lands a real mood impulse (a −3 — ask any dog owner). The
   visible dog sprite on the walk lands in task 115.
