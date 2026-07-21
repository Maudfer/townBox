# [Feature] Persistent household cars — park it, don't conjure it

- **Type:** Feature / Simulation + Visual
- **Labels:** `simulation`, `vehicles`, `sprites`, `save`
- **Status:** ⛔ Reverted — landed briefly (implemented + live-verified in the observation pass), then
  **reverted by [task 130](130-ridesharing-and-on-demand-cars_DONE.md)** in the same PR: persistent parked cars
  read as abandoned and the maintainer preferred on-demand spawn/despawn. Task 130 restores V1's on-demand
  car (spawn as the driver leaves the origin, despawn as they enter the destination) and builds coordinated
  ridesharing on top. The description below records what 129 did before it was reverted. A commuter's car
  used to **park** on arrival (`Person.processTravel` `Arrived`
  disembarks but keeps it linked + controlled instead of despawning) and is **re-boarded** on the next trip
  (`City.startCommute` reuses the owner's parked car when it is near the body; a car stranded far away — the
  owner walked off and now drives from elsewhere — is released via `Person.releaseVehicle` and a fresh one
  spawns at the origin). A mid-drive (occupied) car is NOT reused — that path keeps the W8 148-car-leak
  despawn (`setVehicle`). `Field.removePerson` despawns the owner's parked car; a restored linked car is
  marked controlled on load (`SaveManager`) so it doesn't wander (parked cars re-derive across save/load —
  the task's allowed option, no save-version bump). **Live-verified:** across two in-game days the vehicle
  count stayed bounded (1–5, no leak), drivers retained parked cars (`occupied:false, controlled:true`,
  linked), and **every W8 sprite invariant read zero at every sample** (orphanControlledVehicles /
  occupiedDriverlessVehicles / orphanSprites). Known residual: N driving adults in one household park N cars
  at the same curb (visual overlap; bounded), and the walk-away-then-drive-elsewhere case still spawns a
  fresh car — both documented, minor.
- **Depends on:** V1 (the trip planner, landed); V8 (the sprite invariants, landed)

## The problem

V1's trip planner made short trips walk and fixed origin truth, cutting car churn substantially. But the
**residual is still per-trip magic**: `City.startCommute` (`game/City.ts` ~2995) spawns a **new** `Vehicle`
for every drive, and `Person.processTravel` **despawns** it on arrival (`TravelStep.Arrived`). The audit's
"magic pop-in/pop-out cars everywhere" is reduced, not eliminated — every driving commute still materializes
a car out of nothing at the origin curb and vanishes it at the destination. A household should **own** a car
that parks at the curb and is **re-boarded**.

## Requirements

1. **Household vehicles.** A house owns a persistent car (or a small bounded pool) that parks on its adjacent
   road. A commuting resident **boards the parked car**, drives, parks at the destination, and the car
   **persists** — re-boarded for the return leg or the next trip — instead of being despawned. Bounded per
   household; serialized in the save (or deterministically re-derived on load).
2. **Sprite/lifecycle truth (the W8 contract).** A legitimately-parked household car must satisfy the W8
   invariants: it is **not** an "orphan controlled vehicle" (the `City.runWakePass` orphan sweep and
   `auditSprites` must not reap it), the spawn/despawn race stays closed, and `auditSprites` stays all-zero.
   The `controlled`/`occupied` flags and the orphan-sweep predicate need a "parked & owned" state.
3. **Interaction with V1.** Origin truth still holds — a resident walks to *their* parked car (which lives at
   home's curb), not one conjured wherever they stand; a resident away from home who needs to drive either
   walks home to the car or the trip stays a walk (V1's threshold).
4. **Tests.** A household commute reuses one car across trips (car count doesn't grow); the orphan sweep does
   not reap a parked household car; sprite invariants hold across a multi-trip day.

## References

`City.startCommute` (~2995), `City.runWakePass` (the orphan-vehicle sweep ~2938), `game/agents/Person.ts`
(`processTravel` `TravelStep.Arrived` despawn, `setVehicle`, `abortTravel`), `game/agents/Vehicle.ts`
(`controlled`/`occupied`), `game/world/Field.ts` (`spawnVehicle`/`removeVehicle`), `game/world/House.ts`
(garage), `TestHarness.auditSprites`, `test/agents/commute.test.ts`.
