# [Feature] Retire debug/random spawning; source all spawning from the simulation

- **Type:** Feature / Gameplay loop
- **Labels:** `feature`, `cleanup`, `gameplay-loop`, `framework-followup`
- **Depends on:** 013 (households materialize people), 015 (employment), 006 (commute spawns cars)

## Summary

Turn off the **tech-demo spawning paths** so that people and cars only exist because the *simulation* put
them there. Today people can be conjured with the `P` key, cars with the `V` key, and idle people/vehicles
pick **random** building destinations and wander — none of which belongs in a real gameplay loop. After this
task, residents come from households (013), employees commute because they have jobs (006/015), and the
keyboard/random behaviours are removed or gated behind a debug flag.

## Background / current state (verified)

- `MainScene.create()` (`src/app/game/MainScene.ts`) binds `P` → `personSpawnRequest` at the cursor and
  `V` → `vehicleSpawnRequest` at the cursor. `G` toggles the grid (keep that).
- `Person.updateDestination()` and `Vehicle.updateDestination()` pick a **random** key from
  `Field.destinations` (`Phaser.Math.RND.pick`) whenever idle — placeholder wandering, explicitly called out
  as not-the-real-loop in `CLAUDE.md` §4.6.
- `Field.update()` calls `person.update(...)` and `vehicle.updateDestination(...)` every frame; people without
  a `destinationBuilding` fall through to `walk` + `updateDestination` (the random wander).
- Real spawning already exists: `City.setupHousehold` materializes residents on `houseBuilt`;
  `City.materializeNewborns` on births. Cars are intended to spawn per-commute (006).
- `json/config.json` has a `debug` section (`masterSwitch`, `autoLoad`) — the natural home for a debug-spawn
  toggle.

## Goals / Requirements

1. **Gate the `P`/`V` keyboard spawns behind a debug flag** (e.g. `config.debug.spawnKeys`), default **off**.
   Don't delete them outright — they're useful for debugging — but they must not be part of normal play.
2. **Remove random-destination wandering for simulation entities.** Residents/employees move only with
   purpose (commute via 006, or future errands). `Person.updateDestination`/`Vehicle.updateDestination`'s
   random pick should be removed or likewise debug-gated, not run for real residents. Decide whether idle
   residents simply stay indoors (recommended until errands exist) vs. wander.
3. **Confirm the real spawn sources are the only ones in normal play:** household materialization (013),
   newborns (013), and commute cars (006). No entity should appear without a simulation reason.
4. **Don't break tests.** `test/personTravel.test.ts` exercises the travel machine; keep a supported path to
   spawn/drive entities under test (the debug-gated helpers or direct `Field.loadPerson`/`spawnPerson`).

## Out of scope

- The commute loop itself (006) and hiring (015).
- Removing `Field.spawnPerson`/`spawnVehicle` — they remain the materialization primitives; only the
  *keyboard triggers* and *random wandering* are retired.

## Acceptance criteria

- With debug spawn flags off, `P`/`V` do nothing and no resident wanders to a random building.
- People on the map are exactly those the simulation placed (residents, newborns, commuters).
- `npm test` passes.

## Notes

- This is the explicit "stop being a tech demo where people spawn from keyboard keys" cleanup. Pairs with 006
  (the first *purposeful* movement) — land 006 first or together so the map isn't lifeless after the cut.
