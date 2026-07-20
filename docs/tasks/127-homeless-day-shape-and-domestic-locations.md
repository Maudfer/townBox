# [Feature] Homeless day-shape + domestic home-locations — no resting at the rubble

- **Type:** Feature / Simulation + Data pass
- **Labels:** `simulation`, `homeless`, `actions-data`, `generator`, `asset-regen`
- **Status:** 📋 Planned — deferred from the simulation-aliveness-4 arc (V4 / Appendix-B.1 remainder)
- **Depends on:** V4 (`City.interruptStaleHomeAction`, landed); interacts with the asset regeneration

## The problem

V4 interrupts a displaced person's *running* home action so a stale `spending_time_at_home` can't keep
running at a rubble lot. But two gaps make homelessness still read wrong:

1. **Location-less domestic actions run at the curb (the Appendix-B.1 residual).** ~267 of the corpus's
   actions declare **no location** and run wherever the body happens to be. A `location: home` action
   resolves to null for the homeless and cancels — but a location-*less* domestic action (rest, watch TV,
   rearrange possessions) runs at the curb. A person stranded outdoors will "watch TV" on the sidewalk until
   a located action pulls them somewhere. This is the known deferred data pass (CLAUDE.md §4.17 Appendix B.1)
   that perturbs generator streams, so it was held for the regeneration.
2. **The homeless have no day-shape.** Homelessness is materialized-but-hidden (022) with a visible
   `looking_for_a_home` ambulatory (W9); the *rest* of their day is ordinary free-time from wherever they
   squat — no shelter-seeking, no bench/park rhythm, so the eviction→homeless→recovery arc is invisible
   between the demolition and the recovery sweep.

## Requirements

1. **Domestic-location data pass.** Give the domestic repertoire explicit `home` locations (or add a Brain
   "go home for a domestic action" default) so a domestic action cannot run at a non-home location — closing
   the "resting/TV at the rubble/curb" class for everyone, homeless or merely stranded. **This perturbs
   generator RNG streams** → schedule alongside/after the asset regeneration and re-baseline the generation
   op-counts (`test/perf/generationPerf.test.ts`).
2. **Home-gate + shelter repertoire.** Home-category actions hard-gate on the person *having* a home (a typed
   failure otherwise); a minimal homeless day-shape — shelter-seeking at night, park/bench by day (the
   existing outdoor repertoire) — so the arc reads as a story. The recovery flow (`City.tryRecoverHousehold`
   / `looked_for_housing`) still lands them home.
3. **Tests.** A homeless (or stranded-outdoors) person never runs a home/domestic action at a non-home
   location; the shelter day-shape fires; the eviction→homeless→recovery path still completes.

## References

CLAUDE.md §4.17 Appendix B.1 (the deferred data pass, stated), `json/actions.json` (domestic repertoire —
`spending_time_at_home`, `watched_tv_show`, `took_a_nap`, `rearranged_possessions`, …),
`City.displaceHousehold`/`interruptStaleHomeAction`, `City.enqueueHomeSeeking`/`tryRecoverHousehold`
(`looking_for_a_home`), `game/execution/LiveWorld.ts` (`targetBuilding` home→null), `test/perf/generationPerf.test.ts`.
