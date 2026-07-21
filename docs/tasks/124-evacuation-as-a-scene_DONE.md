# [Feature] Evacuation as a scene — a rally, a conclusion, and kin who notice

- **Type:** Feature / Simulation
- **Labels:** `simulation`, `fire`, `wakes`, `live-play`
- **Status:** ✅ Done (core) — landed in the aliveness-4 follow-up batch (PR #103). The 6-hour "Evacuating!"
  wander is bounded by V4's burning gate (no re-entry loop); a new `homeFire` reactive wake notifies an
  occupied home's residents on ignition (`City.runFireHazard`). Remaining polish (a richer rally-to-a-named-
  safe-spot + a dedicated kin "gather at home" hook) is noted below and can ride a later street-life pass.
- **Depends on:** V4 (the burning gate `LiveWorld.isBurning`, landed) — builds on it

## The problem

V4 landed the **burning gate** (a located transition INTO a building on fire is refused —
`LiveWorld.requestTransition`/`pump` + `City` wiring `Game.incidents.openFireAt`) and the stale-home
interrupt, so nobody walks back into a fire. But the **evacuation itself** still reads wrong.

The `evacuating` action (`json/actions.json`: `location: outside, ambulatory: run`) is an unbounded street
wander. The aliveness-4 audit watched evacuees roam building-entrance to building-entrance for **~6 in-game
hours** labeled "Evacuating!", with no rally point and no conclusion — the `evacuationHook`
(`game/actions/FireResponse.ts`) *is* presence-scoped (`objectLocationOf` → only people physically in the
burning building propose it), but once they step out the ambulatory run just keeps roaming until the action's
short duration lapses and re-proposes. And nobody else's **day** changes: a family whose home is burning gets
a mood impulse at most (grief valence), never a behavioral wake — the LP-12 `homeFire` reaction is absent.

## Requirements

1. **A rally and a conclusion.** An evacuee heads to a rally target — the connected street outside their home
   (`Field.getAdjacentRoadTile`, the seam the commute already uses) or a relative's house via the relocation
   helper — and the evacuation **concludes** when the fire incident resolves (or after a bounded window),
   instead of re-roaming entrances for hours. The `escaped_a_fire` completion still lands.
2. **Presence truth verified.** Only occupants *at ignition* evacuate; confirm the hook does not re-propose
   for people already clear of the building, and that household members elsewhere in town never enter the
   evacuation state (they get a wake instead — below).
3. **Family-notify wakes.** A home fire enqueues a `homeFire`-class `BrainWake` (the `game/actions/Wakes.ts`
   / LP-12 machinery) for kin and off-site occupants — gather/condolence behavior, not just valence. Declare
   its scope + cleared-cooldown class per the wake-catalogue convention.
4. **Tests.** An evacuee rallies and concludes when the fire resolves (not a 6-hour wander); a kin wake fires
   on a home fire; the 102/110 suites (`test/actions/fireHooks.test.ts`, `test/economy/fireService.test.ts`)
   stay green.

## References

`game/actions/FireResponse.ts` (`evacuationHook`), `json/actions.json` (`evacuating`, `escaped_a_fire`),
`City.runFireHazard`/`resolveFires`/`fireResponseAt`, `game/actions/Wakes.ts` + `json/arbitration.json`
(wake vocab), `Field.getAdjacentRoadTile`, `test/actions/fireHooks.test.ts`, `test/economy/fireService.test.ts`.
