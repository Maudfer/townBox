# [Feature] Proactive ride producers — carpools, group outings, and narrated return trips

- **Type:** Feature / Simulation
- **Labels:** `simulation`, `vehicles`, `joint-plans`, `brain`, `planner`, `routines`
- **Status:** 📋 Proposed follow-up to task 130 (awaiting maintainer purview before scheduling)

## Context

Task 130 landed the **mechanism** for coordinated ridesharing and the **reachable flagships**:

- On-demand cars (spawn as the driver leaves the origin, despawn as they enter the destination).
- A **multi-occupant** `Vehicle` (driver + passenger list, `SEAT_CAPACITY` 4) that ejects every occupant on
  despawn (`Field.removeVehicle`).
- `City.startGroupRide(driver, passengers, destination)` — one car, a board window, driver routes.
- `City.canDrive` + `City.electDriver` — the guards (kids/severely-ill can't drive; a non-driver bound far
  gets an available co-located adult to drive them; nobody stranded).
- **Narrated flagships** via `City.narrateRide`: a kid driven to a **school** building reads *"Drove {kid} to
  school"* / *"Got a lift to school"*; the ill driven to a **hospital** read *"Drove {relative} to the
  hospital"* / *"Was driven to the hospital"*; any other group ride reads *"Gave {target} a ride"* /
  *"Caught a ride"*. Six manual, effect-free texture events in `json/events.json`, invoked **live-only**.

What 130 **did not** build — because none of these has an existing trigger, and each needs a new *proactive*
producer (a Brain hook / Planner path / routine that forms the ride before anyone sets off), plus in most
cases the N-person generalization of the joint-plan machinery and a defined return trip. Task 130 delivers
the *reactive* cases (a non-driver's located transition elects a driver at the seam); this task delivers the
*proactive* ones (a plan that says "let's all go together" up front).

## The uncovered R-cases (from task 130 Pass 1)

| # | Scenario | Why it needs a proactive producer |
|---|---|---|
| R2 | **Police carpool patrol** | `patrolling` (`actions.json`) is a solo ambulatory walk; `driving_route` is a solo work action. Nothing elects one of ≥2 on-shift officers at a station as the driver and carries the rest. Lives in `JobOrchestrator` (the on-shift work-action source). |
| R3 | **Group trip to a venue** (dinner, cinema, beach, gym, park, shopping) | Venue leisure actions (`eating_out`, `night_at_the_cinema`, `visiting_beach`, `working_out_at_the_gym`, …) are solo free-time/routine picks. No producer forms a *group* outing among co-located household members / friends. |
| R5 | **Carpool to work** | Two employed co-resident adults with co-directional workplaces + overlapping shift starts each `startCommute` their own car. No producer pairs them. |
| R6 | **Date night / couple's outing** | `taking_a_walk_together` binds no partner and no car. A partnered venue outing by car has no producer. |
| R7 | **Drive a friend home** after a hosted visit | A `visiting_*`/`hosting_a_friend_visit` scene (`Planner` ~119) concludes with the guest walking/commuting home solo; no "drive them home if far" beat. |
| R9 | **Whole-household weekend outing** | No household-outing routine forms a group ride (with a second car when the household exceeds one car's seats). |
| — | **Narrated return trips** | The school pickup (R1 PM), the hospital discharge home, and the outing return all currently ride the reactive election seam *behaviorally* but are **not narrated** as return trips (no *"Picked up {kid} from school"* / *"Drove {relative} home"*). |

## Foundations to build on

- **The joint-plan / mirrored-agenda pattern.** `Planner` (`game/actions/Planner.ts` ~119–140) already
  installs a `linkId`-linked pair — the visitor gets `locationOverride: 'person:<host>'`, the host a mirrored
  `hosting_a_friend_visit` at `home`, both in the same window. `Consequences.planJointActivity`
  (`game/events/Consequences.ts` ~541) is the reusable primitive. **Both pair exactly TWO people** — the core
  extension this task needs is a **general N-person group plan** (one initiator + N mirrored followers +
  optional shared return), and a variant whose shared travel is **one car** (`startGroupRide`) rather than N
  solo commutes.
- **`City.startGroupRide`** is the ride installer; the producers call it (or a thin `installRidePlan` wrapper
  that also enqueues the mirrored agenda entries + the return).
- **`JobOrchestrator`** (`game/actions/JobOrchestrator.ts`) is the on-shift work-action source — the natural
  home for R2 (elect a driver among co-located on-shift officers, carry the rest, patrol from the car).
- **`routines.json`** (`weekly_shopping`, `gym_habit`, `weekly_service`, `dinner_out`, …) is where the R3/R9
  household-outing + R6 couple routines are authored; each routine already carries `cadenceDays`, `window`,
  `adoption`, `requires`.
- **`City.narrateRide`** already derives ride narration from the destination + riders — extend it (or its
  callers) with the return-trip variants (`picked_up_kids_from_school`, `drove_relative_home`, …).

## Requirements (acceptance)

1. A **general N-person group-plan** primitive (generalizing the Planner's 2-person mirrored-entry code),
   with an optional **car** variant that installs ONE `startGroupRide` for the co-located participants and an
   optional **shared return**. A test proves one car per group (never one per participant) and that a no-show
   participant never blocks the plan (the 130 board window).
2. **R2 police carpool** — ≥2 on-shift officers at one station ⇒ one elected driver, the rest ride, patrol
   runs from the car; one car, not one per officer.
3. **R3/R9 group/household venue outing** — a producer/routine forms a group ride to a venue among co-located
   household members (and/or co-located friends), with a defined return so no one is stranded at the venue
   after the driver leaves; a second car when the group exceeds one car's seats.
4. **R5 work carpool** and **R6 couple outing** — co-directional/partnered trips share one car when far.
5. **R7 drive-a-friend-home** — a concluding hosted visit optionally drives a far-living guest home.
6. **Narrated return trips** — school pickup, hospital discharge, and outing returns read truthfully in the
   per-person log (and, where it's not noise, the feed).
7. Every new action is `interaction`-contracted + consent-gated where it targets a person (tasks 072/073);
   every driving action wires `onStart`/complete lifecycle events so the log narrates.
8. **Determinism + bootstrap/asset parity:** keep the producers live-map glue (or gate them off-map) so the
   offline generator's RNG stream is unchanged and **no regeneration is forced**; if any authored
   event/action changes the off-map stream, state the regeneration explicitly (as 121/136 did).
9. Guards from 130 hold throughout (`canDrive`, accompaniment, open-map/non-enterable destinations don't
   spawn an enter-a-building car); the W8 `auditSprites` invariants stay all-zero across the new multi-rider
   flows; the `arcScenarios` live↔bootstrap keystone stays green.
10. Tests for every new producer + the N-person primitive; revert-dance any bug fix.

## Open questions for the planning pass (do NOT pre-decide here)

- **Return-trip modeling:** a second scheduled ride vs. the passengers finding their own way — per case.
- **Co-location at departure:** does a group plan only form among the already-co-located, or does a passenger
  first walk to the pickup? (130 chose "already co-located"; friends joining an outing may need the former.)
- **Second car** for a household that exceeds one car's seats (R9): two drivers, or two trips.
- **Perf:** the group-plan co-location scans must stay behind cheap gates (only when ≥2 co-located
  participants share a plan), and the perf gates re-checked if the generator path is touched.

## References

`game/City.ts` (`startGroupRide`, `narrateRide`, `canDrive`, `electDriver`, `startCommute`),
`game/actions/Planner.ts` (~119–140 mirrored linkId entries), `game/events/Consequences.ts`
(`planJointActivity` ~541), `game/actions/JobOrchestrator.ts` (on-shift work-action source),
`game/actions/Agenda.ts` (linkId), `game/agents/Vehicle.ts` (occupancy + board window),
`json/actions.json`, `json/events.json`, `json/routines.json`, `test/agents/commute.test.ts`,
`test/execution/arcScenarios.test.ts`, `TestHarness.auditSprites`.
