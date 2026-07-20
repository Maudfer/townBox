# [Feature] Guardianship depth — accompaniment, home-alone care, dependent fan-outs

- **Type:** Feature / Simulation
- **Labels:** `simulation`, `guardianship`, `joint-plans`, `wakes`
- **Status:** 📋 Planned — deferred from the simulation-aliveness-4 arc (V3 remainder)
- **Depends on:** V3 (the `minAge` gate, landed); the D3 joint-plan machinery (task 085)

## The problem

V3's `minAge` gate (`ActionEngine.startAction` + `VENUE_INDEPENDENCE_AGE`) stops young children doing adult
errands — a 2-year-old can no longer take a solo shopping trip. But three deeper guardianship pieces the
aliveness-4 audit surfaced remain unbuilt:

1. **No accompaniment.** A young child's *legitimate* located trip (a family outing, a doctor visit) has no
   mechanism to travel *with* a guardian — they can only be blocked (by `minAge`) or, for un-gated actions,
   go alone. There is no "child follows an adult" primitive.
2. **No home-alone detection.** Nothing notices a dependent left home with no adult (both parents commuting).
   The `caring_for_children` action exists and is selected, but it isn't *anchored* when a child would
   otherwise be unattended.
3. **No dependent fan-out on caregiver loss.** When a sole caregiver is jailed, hospitalized, or dies, a
   now-unattended child is only handled on the **death** path (orphan re-housing, task 011) — jail and
   serious illness leave a child unminded.

## Requirements

1. **Accompaniment.** A young child's located trip requires/joins a co-resident guardian via the D3
   joint-plan linkage (`Consequences.planJointActivity` / mirrored agenda entries, `game/actions/Agenda.ts`)
   — the child rides with an adult, never travels solo. Reuse the machinery V9 leaned on.
2. **Home-alone care.** A signal when a dependent (under a care-age threshold) would be home with no adult
   present anchors an available guardian's `caring_for_children` (or defers that guardian's departure) — the
   household doesn't leave a toddler alone to commute.
3. **Dependent fan-outs.** Extend the orphan-rehousing precedent beyond death: a jailed or seriously-ill
   sole caregiver triggers a check for now-unattended dependents and routes them to care (a relative, the
   other parent) via the existing relocation/care helpers — driven by the LP-12 wake channel where the
   trigger is mid-tick (arrest, `fell_seriously_ill`).
4. **Tests.** No under-N child leaves home unaccompanied over a traced week; a home-alone dependent anchors a
   guardian; a jailed/hospitalized sole parent's child is placed into care.

## References

`game/actions/ActionEngine.ts` (the `minAge`/`VENUE_INDEPENDENCE_AGE` gate), `game/events/Consequences.ts`
(`planJointActivity` ~541), `game/actions/Agenda.ts`/`Planner.ts`, `json/actions.json` (`caring_for_children`),
`City.resolveRehousing` (the death→orphan path), `game/actions/Detained.ts`, `game/actions/Wakes.ts`,
`util/kinship.ts`.
