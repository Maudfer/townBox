# [Feature] Wire jobs to pathfinding — daily work commute loop

- **Type:** Feature / Gameplay loop
- **Labels:** `feature`, `simulation`, `pathfinding`, `gameplay-loop`

> **Note:** scope unchanged, but the **job/employer assignment** this task consumes now comes from
> [013-procedural-simulation-framework_DONE.md](013-procedural-simulation-framework_DONE.md) (Engine A businesses +
> Engine B hiring events), not the old 007. Implement the commute against the jobs/workplaces the framework
> assigns; the temporary fixture note below still applies if 013 hiring is not yet merged.
>
> **Now unblocked by [015-skill-matched-hiring.md](015-skill-matched-hiring.md).** Once 015 lands, employed
> residents have a real `WorkLife.job` (with `shiftStart`/`shiftEnd` from the clock work in 005) at a real
> `Workplace`, so the commute can be driven for actual employees. Verify against current code during the
> exploration pass: `Person.processTravel()` / `TravelStep` (`types/Travel.ts`) is **partially wired** — the
> state machine advances but car spawn/park/despawn (`TravelStep.WalkingToCar`/`EnteringCar`/`ExitingCar`)
> and the trigger to *start* a commute on shift boundaries are not connected. Departures should be driven by
> the clock's `timeChanged`/`newDay` signals against each employee's shift times. Retiring the placeholder
> random-destination wandering for employed residents is shared with
> [016-retire-debug-spawning.md](016-retire-debug-spawning.md).

## Summary

Connect the existing **job system** to **pathfinding and the clock** so that employed people living
in houses **leave for work every day and return home at the end of their shift**, using a mix of
**walking and driving**. The initial implementation spawns a car parked in front of the person's
house/work as they depart, has them walk to the car, drive to in front of their destination, walk
in, and **despawns the car as they enter the building**.

## Background / current state

- **Travel state machine already exists but is only partially wired.** `Person` has a `TravelStep`
  state machine (`types/Travel.ts`:
  `Idle → ExitingBuilding → WalkingToCar → EnteringCar → Driving → ExitingCar →
  WalkingToDestination → Arrived`) driven by `Person.processTravel()`. `Person.setDestination()`
  sets `destinationBuilding` and kicks off `ExitingBuilding`. `setVehicle()` assigns a vehicle.
  **Car spawning/parking and despawning are NOT implemented**, and nothing currently triggers a
  commute — `updateDestination()` instead sends idle people/cars to a **random** building.
- **People & homes/jobs:** `Person.social` (`SocialLife`) holds `home` (`House`); `Person.work`
  (`WorkLife`) holds a `job`. `House` tracks `residents`, `occupants`, and a `garage` of vehicles;
  `Workplace` tracks `employees`, `occupants`, and a `garage`. Buildings expose
  `getEntrance()` (`Building.calculateEntrance()`).
- **Movement primitives:** `PathFinder.findPath(start, goal)` returns a `Tile[]`; `Person.walk()`
  follows curb waypoints; `Vehicle.drive()` follows lane waypoints. `Field.update()` calls these
  each frame. `Field.spawnVehicle(pixelPosition)` creates a `Vehicle` and emits `vehicleSpawned`.
- **Clock:** the day-rollover / time-of-day signals from `005-clock-and-calendar-system_DONE.md` and the
  job **shift start/end times** added there are the intended scheduling triggers.
- **Indoors handling:** `Person.setIndoors(true/false)` toggles visibility; `MainScene.drawPerson`
  hides indoor people.

## Goals / Requirements

1. **Schedule-driven departures.** Using the clock's time-of-day / day signals and each job's
   **shift start/end times**, make each employed resident **leave home for work** at (or before)
   shift start and **return home** at shift end. People without a job stay home (for now).
2. **Car spawn/park.** When a person begins a commute, spawn a `Vehicle` **parked in front of the
   origin building** (house when leaving home, workplace when leaving work) near the building
   entrance, and assign it via `Person.setVehicle()`. Track the vehicle in the building's `garage`
   as appropriate.
3. **Walk → drive → walk.** Drive the existing `TravelStep` machine end to end:
   `ExitingBuilding` (mark not indoors) → `WalkingToCar` → `EnteringCar` → `Driving` (path to in
   front of destination) → `ExitingCar` → `WalkingToDestination` (to the entrance) → `Arrived`
   (mark indoors). Implement the currently-missing car enter/exit and parking-position logic.
4. **Car despawn.** When the person enters the destination building (`Arrived`/indoors), **despawn
   the car** and remove it from tracking/lists (`Field.vehicles`, building garage), with no leaked
   sprites or update entries.
5. **Round trip.** The full home → work and work → home cycle must run every day driven by the
   clock. People must end the day back in their house.
6. **Use real home/work targets, not random.** Replace the random-destination behavior for commuting
   people with their actual `home`/`workplace` buildings. (Random wandering may remain for manually
   spawned test people/cars, but employed residents commute to real targets.)
7. The game builds (`npm run dev`) and `npm test` passes. Extend/repurpose
   `test/personTravel.test.ts` to cover the now-complete state machine including car spawn/despawn.

## Out of scope

- Traffic congestion, parking capacity limits, carpooling, and pedestrian-only commutes
  optimization. (A simple "always spawn one car per commuter" model is acceptable initially.)
- Hiring logic and business generation (see `007-business-generation.md`) — assume people already
  have jobs/workplaces assigned.
- Realistic departure staggering / traffic spreading beyond a basic implementation.

## Acceptance criteria

- An employed resident leaves their house around shift start, walks to a freshly spawned car, drives
  to their workplace, walks in, and the car despawns; the reverse happens at shift end.
- No orphaned vehicles or sprites remain after commutes; `Field.vehicles` stays consistent.
- Commuters target their real home/workplace, not random buildings.
- `npm test` passes, including updated travel-state-machine coverage.

## Notes

- Coordinate ordering with `005` (needs shift times + day/time events) and ideally
  `007` (assigns jobs/workplaces). If `007` is not yet merged, a temporary fixture that assigns a
  workplace to a resident is acceptable for testing, but the production path must use real
  assignments.
- Reuse `Field.spawnVehicle` for parking cars; ensure a matching despawn/removal helper exists.
- Watch the `Person.processTravel()` edge cases already present (vehicle tile resolution via
  `Game.pixelToTilePosition`, `setDestinationTile`) and the partial wiring noted above.
