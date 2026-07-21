# [Feature] On-demand cars + coordinated ridesharing — revert persistent cars, share the ride

- **Type:** Feature / Simulation + Visual
- **Labels:** `simulation`, `vehicles`, `joint-plans`, `brain`, `sprites`, `school`, `health`
- **Status:** ✅ Done (agreed subset) — the on-demand + shared-ride mechanism, the guards, and the narrated
  reachable flagships (R1 school run, R4 hospital drive, R10 accompaniment) are landed on
  `task/simulation-aliveness-4`. The speculative proactive-producer catalog (R2 patrol carpool, R3/R6/R9
  group/couple/household outings, R5 work carpool, R7 drive-a-friend-home) is scoped as
  [task 131](131-proactive-ride-producers_DONE.md) rather than invented here — none has an existing trigger, and building them means new routines +
  N-person group-plan machinery + return-trip coordination, an initiative-sized effort that would be
  speculative content under §5.6. Progress:
  - ✅ **A — revert 129:** cars are on-demand again (spawn as the driver leaves the origin building, despawn
    as they enter the destination); no persistent parked cars. V1's walk-vs-drive/origin-truth kept.
  - ✅ **B — multi-occupant Vehicle:** a driver + passenger list (SEAT_CAPACITY 4); `Field.removeVehicle`
    ejects EVERY occupant (sprite restored, link cleared) so nobody vanishes inside a car; the W8
    occupied-driverless invariant is `isOccupied() && !hasDriver()`.
  - ✅ **C — the shared-ride primitive:** `City.startGroupRide(driver, passengers, destination)` spawns ONE
    car; passengers board the same car (`setVehicle(car, false)`), only the driver routes it, and the car
    waits at the curb (a board window) until everyone's aboard before departing (a no-show never strands it).
  - ✅ **E — canDrive gate + driver election:** `City.canDrive` (adult, not detained, not severely ill);
    `startCommute` routes a drive-distance trip by eligibility — a non-driver bound FAR (a child, the ill)
    gets an available co-located adult to drive them (a group ride), else walks. Delivers the guards: kids
    can't drive, kids can't reach a far school alone, the severely ill are driven, never stranded.
  - ✅ **D — narrated collective actions (flagships):** a group ride now writes truthful per-person log
    entries derived from the destination + riders — a minor bound for a school building narrates
    "Drove {kid} to school" / "Got a lift to school"; anyone bound for a hospital narrates
    "Drove {relative} to the hospital" / "Was driven to the hospital"; else a plain "Gave {target} a ride" /
    "Caught a ride". Six manual, effect-free texture events (`events.json`), invoked live-only from
    `City.narrateRide` (bootstrap/the generator never call `startGroupRide`, so the off-map RNG stream and
    the committed asset are untouched — NO regeneration forced). The narration rides the SAME election path
    that already forms the ride (E), so no separate proactive producer is needed for the reachable cases to
    read. The speculative producers (patrol carpool, group/household outings, work carpool) → [task 131](131-proactive-ride-producers_DONE.md).
  - ✅ **F — school/treatment already coherent:** the far-school preference is the enrollment sweep's
    existing nearest-first scoring (task 058 `SchoolRegistry`: Manhattan home→school, ties by anchor key), so
    a child rides only when nearer seats are full; `receiving_treatment`'s located transition already elects a
    relative-driver through the E gate for the severely ill (health < `MIN_DRIVE_HEALTH`) while the mildly ill
    self-drive. The outing/couple routines belong with the D producers → [task 131](131-proactive-ride-producers_DONE.md).
  - Gaps handled: eject-all on despawn (B), one-car-not-N (C), board window / no-show (C), canDrive +
    election + far-school net (E), narrated flagships (D), open-map/non-enterable destinations (the `outside`
    transition resolves immediately with no car; `startCommute` guards `!destEntrance`), bootstrap/asset
    parity (live-only narration). Return trips (school/hospital home) ride the same election seam
    behaviorally; their narration + the proactive outing/carpool producers → [task 131](131-proactive-ride-producers_DONE.md).

  Originally: reverts task 129, builds the shared-ride subsystem. Bundled into the current aliveness-4
  follow-up PR (branch `task/simulation-aliveness-4`).
- **Depends on:** V1 (the trip planner — `City.startCommute`), 129 (to be reverted), the D3 joint-plan
  machinery (task 085: `Consequences.planJointActivity`, `Agenda` linkId-mirrored entries, `Planner`), the
  execution boundary (`LiveWorld.requestTransition` → `startCommute`).

## Goal & the desired visual

Cars are **on-demand, not persistent**. A car spawns on the street in front of a building **the moment a
person who intends to drive leaves that building** — the player watches them walk out, cross to the car, and
board (sprite vanishes into the car). On arrival the driver parks on the street in front of the destination,
steps out, and as they enter the destination the car **vanishes**. No parked cars accumulate; no "magic
pop-in/pop-out" at the wrong end (V1's origin-truth + walk-vs-drive smarts are KEPT).

On top of that: when a trip logically carries **more than one person** — a parent driving a kid to school,
two officers sharing a patrol car, a relative driving a sick person to the hospital, a household heading to
the beach together — **one** car is spawned and **all** of them ride it. Everyone's actions read the truth:
"Driving the kids to school", "Riding to the hospital with Dad". These are **coordinated collective actions**
(the joint-plan pattern), not coincidences — and they only fire when the participants genuinely exist (a kid
who needs school; a sick relative; a co-located passenger).

---

## Pass 1 — Every case that warrants a shared ride

The maintainer's four, plus the ones the same machinery should cover:

| # | Scenario | Driver | Passenger(s) | Trigger condition |
|---|---|---|---|---|
| R1 | **Drive the kid to school** (AM) + **pick up** (PM) | a co-resident adult | school-age child(ren) of the household | child assigned to a school beyond walking distance, on a school day |
| R2 | **Police carpool patrol** | one on-duty officer | 1+ on-duty officers at the same station | ≥2 officers on shift at one police station whose work needs the street |
| R3 | **Group trip to a venue** (shopping, dinner, beach, cinema, park, gym) | one adult | co-resident household members / co-located friends joining the same outing | a venue-located leisure/errand action chosen as a *group* plan |
| R4 | **Relative drives the ill to the hospital** | an available adult relative/household member | the severely-ill person (can't drive) | a person below the drive-health gate needs treatment and a driver exists |
| R5 | **Carpool to work** | one adult | co-resident adults whose workplaces are the same or on the way | ≥2 employed adults in a household with shifts starting together, workplaces co-directional |
| R6 | **Date night / couple's outing** | one partner | the other partner | a joint leisure plan between partners at a venue (the `taking_a_walk_together` sibling, but by car) |
| R7 | **Drive a friend home** after a hosted visit | the host or the departing guest | the other | a `visiting_*`/`hosting_*` scene concluding, guest lives beyond walking distance |
| R8 | **Drive an elderly/ill parent to a non-school appointment** (doctor, errands) | an adult child | the parent (may be a non-driver by health/age) | a dependent adult needs a located trip and can't drive |
| R9 | **Whole-household outing** (weekend) | one adult (two cars if the household exceeds one car's capacity) | the rest of the household | a household routine outing |
| R10 | **Guardian accompanies a young child on any car trip** (the 126 accompaniment deferral) | the guardian | the under-`VENUE_INDEPENDENCE_AGE` child | any legitimate located child trip that needs a car |

The unifying primitive: **one driver + N passengers + one car + one shared destination (and often a shared
return)**, installed as linked agenda entries so the participants' Brains all agree.

---

## Pass 2 — What collective-action coverage exists today (audit)

Grounded in the code, per scenario:

- **The joint-plan machinery EXISTS and is the foundation.** `Consequences.planJointActivity`
  (`events/Consequences.ts` ~541) installs **mirrored agenda entries** for two people (host `locationOverride:
  'home'`, guest `locationOverride: 'person:<host>'`) linked by a `linkId`, both in the same window.
  `Planner` (`actions/Planner.ts` ~117) does the same for `visiting_friends`/`visiting_relatives` →
  `hosting_a_friend_visit`. **BUT it links SOCIAL scenes, carries no notion of a shared car, and only ever
  pairs TWO people.** Each participant still commutes **solo** (each `startCommute` spawns its own car).
- **Vehicle is single-occupant.** `agents/Vehicle.ts`: `occupied` is a **boolean** (`board()`/`disembark()`
  flip it; `drive()` gates on it). There is **no passenger list** — a car physically cannot carry two people.
  This is the hard blocker for every R-case.
- **The commute is a solo, per-person mechanism.** `LiveWorld.requestTransition` → `City.startCommute(person,
  destination)` spawns **one car for one person**. Nothing coordinates two people onto one car.
- **R1 (kid to school): not covered.** `attend_school` (task 058) routes a minor to school on **foot**
  (`City.startCommute` `age < ADULT_AGE_YEARS` → `person.setDestination`, walk); the enrollment sweep
  (`SchoolRegistry`, task 058) picks the **nearest school with a free seat** but there is **no distance gate**
  — a child is walked to an arbitrarily distant school with no parent involvement. No `drive_kid_to_school`
  action, no pickup.
- **R2 (police carpool): not covered.** `patrolling` (`actions.json`, `location: outside`, ambulatory) is a
  **walking** patrol; `patrolling_the_floor` is indoor. No shared-car patrol; `driving_route` is a solo
  delivery-driver work action, not a rideshare.
- **R3/R6/R9 (group/couple/household trips): not covered.** Venue actions (`eating_out`, `shopping_trip`,
  `night_at_the_cinema`, `visiting_beach`, …) are **solo** free-time/routine picks. `taking_a_walk_together`
  exists (`location: outside`) but binds no partner and no car (V9 flagged it). No group-ride primitive.
- **R4/R8 (relative drives the ill/dependent): not covered.** `Treatment` (`actions/Treatment.ts`) sends the
  **sick person themselves** to a placed hospital (`receiving_treatment`, a located transition → they
  self-drive/walk). There is no `canDrive` gate, so a severely-ill person **drives themselves**. No
  relative-driver mechanism.
- **Guards partially exist.** Minors don't drive (`startCommute` age gate) — but they also can't be **driven**
  (no mechanism), and there is **no** severe-illness drive gate, **no** far-school gate, and the 126
  accompaniment piece was explicitly deferred.
- **129 persistence is the thing being removed.** `startCommute` reuses a parked car; `Person.processTravel`
  `Arrived` **parks** (keeps it linked+controlled) instead of despawning; `Person.releaseVehicle`,
  `Field.removePerson`'s car-despawn, and `SaveManager`'s restored-`controlled` flag all exist only to serve
  persistence.

**Conclusion:** the agenda/linkId joint-plan pattern is the right substrate, but ridesharing needs (a) a
multi-occupant Vehicle, (b) a shared-ride coordination primitive that puts a driver + passengers on **one**
car, and (c) the specific driving collective actions + guards, none of which exist.

---

## Pass 3 — The task (revert + build)

### A. Revert task 129 (persistent cars → on-demand)

Restore the V1 spawn-on-demand / despawn-on-arrival contract; **keep** V1's walk-vs-drive, origin-truth, and
no-zero-length-drive smarts (those are good and stay). Specifically:

1. `Person.processTravel` `TravelStep.Arrived`: **despawn** the car (`Field.removeVehicle` + unlink) instead
   of parking it (revert the 129 disembark-and-keep-linked change).
2. `City.startCommute`: remove the parked-car reuse/release block (revert to: spawn a fresh car when driving).
3. Remove `Person.releaseVehicle`, the `Field.removePerson` car-despawn, and the `SaveManager` restored-
   `controlled` line — all 129-only. (Keep the load path resetting in-flight travel to idle.)
4. Delete/rewrite the 129 tests (`personTravel` "arrival parks", `commute` reuse/removal) to the
   despawn-on-arrival contract. Mark `129-persistent-household-cars_REVERTED.md`.
5. **Verify** the spawn timing gives the desired visual: the car spawns as the driver EXITS the origin
   building (the existing `ExitingBuilding` → `WalkingToCar` sequence already does this) and despawns as they
   ENTER the destination (`Arrived`). Confirm no orphan cars (W8 `auditSprites` stays all-zero) across a
   multi-trip day.

### B. Multi-occupant Vehicle

`agents/Vehicle.ts`: replace the boolean `occupied` with an **occupant model** — a driver + a bounded
passenger list (a small seat capacity, e.g. 4). `board(personId, asDriver)`, `disembark(personId)`,
`getOccupants()`, `hasDriver()`. `drive()` gates on `hasDriver()`. **Despawn ejects ALL occupants**: every
occupant's Person is stepped out at the car's position with its sprite un-hidden (extend the W8
`abortTravel`/`removeVehicle` eject to loop over occupants), so no one is left invisible-inside a vanished
car. `SaveManager` serializes the occupant list (or resets rides to idle on load — decide, keeping the
save-version-additive rule).

### C. The shared-ride primitive (coordination glue)

A **ride** = one driver + N passengers + one car + one destination (+ optional shared return). Build it on the
joint-plan/agenda pattern:

- A **`RidePlan`** the driver's Brain/City installs: the driver runs a `driving_*` action (located to the
  destination) that spawns **one** car and boards as driver; each passenger runs a mirrored `riding_*` /
  `being_driven_*` action **linked** to the driver's, whose "travel" is to **board the driver's car** at the
  origin rather than spawn their own (a new travel path: `person.joinRide(vehicle)` instead of
  `startCommute`). The car departs when the driver + expected passengers are aboard (a short board window;
  a no-show passenger is left behind after the window, never blocking the driver forever).
- On arrival: the driver parks, all disembark, sprites restored, the car despawns once empty (A's contract,
  generalized to N occupants).
- The coordination rides the execution boundary (`LiveWorld`) so it's a live-map concept; **bootstrap/the
  off-map generator keep the abstract single-transition path** (the sanctioned seam — no sprites off-map, so
  a "ride" there is just the passengers arriving; no byte impact on the asset if the off-map path is
  unchanged — CONFIRM this so no regeneration is forced).

### D. New collective actions + events (data + glue)

Author in `actions.json`/`events.json` with `interaction` contracts + mirrored linkage:

- **R1:** `drive_kids_to_school` (parent, located to the school, carries the kid passengers) + `ride_to_school`
  (kid) — morning; `pick_up_kids_from_school` + `ride_home_from_school` — at school-end. A **school-run
  routine** for the parent; the kid's `attend_school` obligation stays, but its *arrival* is via the ride
  when the school is beyond walk distance.
- **R4/R8:** `drive_to_hospital` (relative) + `being_driven_to_hospital` (the ill). Wired from `Treatment`
  when the patient fails the `canDrive` gate and an adult relative/household member is available.
- **R2:** `carpool_patrol` — the Job Orchestrator, when ≥2 officers are on shift at one station, elects one
  driver; the others ride; the patrol work happens from the car's route. (One car, not one per officer.)
- **R3/R6/R9:** `group_outing_drive` + `along_for_the_ride`, installed by a group-plan producer (a household
  or friend cohort choosing a venue outing together) — generalize the Planner's mirrored-entry code from
  2-person to N-person.
- Every driving action wires `onStart`/complete lifecycle events so the log reads truthfully and the feed can
  narrate ("drove the kids to school"), and every passenger action is `interaction`-contracted and consent-
  gated where it targets a person (task 072/073).

### E. Guards (the `canDrive` gate + accompaniment)

- **`canDrive(person)`** = adult (`age ≥ ADULT_AGE_YEARS`) AND not severely ill (`health ≥ SEVERE_ILLNESS`
  band) AND not detained. Checked BEFORE a located transition requests a car. A person who **can't** drive
  and needs a car trip → find a driver (an available co-resident adult / relative who `canDrive`) and install
  a ride; if none, the trip **defers** (planner "go when a driver is free") or falls back (walk if within
  range) — never a severely-ill person self-driving.
- **Kids can't drive:** already the age gate; formalize via `canDrive`.
- **Kids can't reach a far school alone:** the enrollment sweep prefers a **walk-reachable** school; if only a
  distant school has a seat, the child rides with a parent (R1) — never walks across town. Add a distance
  consideration to `SchoolRegistry`'s scoring / the `attend_school` arrival.
- **Accompaniment (closes the 126 deferral):** an under-`VENUE_INDEPENDENCE_AGE` child's legitimate located
  car trip **joins a guardian's ride** (R10) — the child never travels solo.

### F. Amend existing to avoid loose ends

- `attend_school` / `SchoolOrchestrator`: far-school → ride; keep walk for near schools.
- `Treatment`: relative-drives-the-ill path; keep self-travel for the mildly ill who `canDrive`.
- `routines.json`: a school-run routine (parent), a household-outing routine.
- `taking_a_walk_together` / couple plans: bind the partner (V9 residual) and route by car when the venue is
  far (R6).
- `Planner` mirrored-entry code: generalize 2-person → N-person for group rides.
- Remove every dangling 129 reference (releaseVehicle callers, save flag, tests).

---

## Pass 4 — Gaps the maintainer may not have named (analysis of the on-demand + shared model)

Found by walking the spawn/despawn-without-persistence model against the current code:

1. **Who is the driver when the subject can't drive?** The `canDrive` gate must run *before* the transition
   spawns a car, and driver-election (nearest available co-resident adult / relative who `canDrive` and is
   free) is a real sub-problem — and it can **fail** (no eligible driver). Define the fallback (defer, walk-
   if-close, or the abstract off-map arrival) so a non-driver is never stranded or self-driving.
2. **Co-location at departure.** A ride needs the driver + passengers at the **same origin** when the car
   spawns. Kids leaving home with a parent: fine (same house). But a passenger elsewhere (a friend joining an
   outing) must first get to the pickup point — either the ride's origin is the driver's building and
   passengers walk/are-picked-up, or the plan only forms among the already-co-located. Pick one; a mismatched
   passenger must not block the driver's departure (the board window from C).
2b. **The board/no-show window.** The car can't wait forever for a passenger. Define the window and the
   "leave without them" behaviour, and make sure a left-behind passenger re-plans (walk / next ride) rather
   than stalling in `waiting_for_materialization`.
3. **Return trips.** A shared ride *out* (to school/hospital/venue) implies a way *back*. The kid at school
   all day is picked up (R1 PM); a hospital patient may be discharged and driven home; an outing returns
   together. Decide per case whether the return is a second scheduled ride or the passengers find their own
   way — and ensure no one is stranded at a venue after their driver leaves.
4. **Open-map / non-enterable destinations (the maintainer's flag).** A located action whose target is
   **outside** (an ambulatory/street target, a `venue:*` that resolved to a non-building, the town-wide
   `outside`) has **no building entrance** to park at or vanish into. The car system must detect this and
   NOT spawn a car that expects `getEntrance()`/`getAdjacentRoadTile()` — such trips are walked (they're the
   ambulatory street-life case), or the ride ends at the nearest road with the occupants stepping out onto the
   street (no "enter the destination → car vanishes" beat, because there's nothing to enter). Audit every
   `startCommute`/ride call site for a `Building` vs non-building destination.
5. **Despawn-with-occupants ordering.** The car should vanish only when it is **empty and its driver has
   entered the destination** — not the instant one passenger steps out. Multi-occupant despawn must eject
   everyone still aboard (crash/interrupt/bulldoze/owner-removed paths included) with sprites restored (W8),
   and the W8 `auditSprites` invariants must stay all-zero (no occupied-driverless, no orphan-controlled, no
   orphan sprites) across the new multi-rider flows.
6. **Interruptions mid-ride.** If the driver's intent dies mid-drive (an arrest, an emergency, a pause), the
   passengers must be handled (ejected onto the street / re-planned), not left inside a cancelled car — extend
   `abortTravel`/`cancelTransition` to the occupant list.
7. **One car, not N.** The core anti-goal: two people to the same place must **not** each `startCommute` a
   car. The ride primitive must intercept the passengers' located transitions and route them to the driver's
   car (`joinRide`), and a validator/test must prove one car per group ride.
8. **Determinism, bootstrap parity, and the ASSET.** Ridesharing is live-map glue; confirm the off-map
   generator path is unchanged (or the change is gated off-map) so **no regeneration is forced** — and if any
   authored event/action changes the off-map RNG stream, note the regeneration explicitly (like 121/136 did).
9. **Save/version.** Multi-occupant vehicle state + in-flight rides need a save story (serialize additively,
   or reset rides to idle on load). Follow the additive-optional-section rule; register any new schema.
10. **Perf.** Driver-election + co-location scans + N-occupant coordination add per-tick cost; keep it behind
    cheap gates (only when a non-driver needs a trip, only when ≥2 co-located participants share a plan) and
    re-check the perf gates if the generator path is touched.
11. **The empty-car-can't-move gate still holds.** `drive()` gating on `hasDriver()` means a ride with only
    passengers and no driver never moves — the driver-election must guarantee a driver, or the ride never
    forms.
12. **Feed/legibility.** The new collective actions should read in the inspector + feed ("Driving the kids to
    school", "Riding to the hospital with Ana") via the LP-14 entity-linked log; wire the labels/params.

---

## Requirements (acceptance)

1. Cars are on-demand: spawn as the driver leaves the origin building, despawn as the driver enters the
   destination; no persistent parked cars; W8 sprite invariants all-zero across a traced multi-trip day.
2. A multi-occupant Vehicle carries a driver + passengers; despawn ejects ALL occupants with sprites restored.
3. Each R-case (R1–R10, or the subset agreed) is a **coordinated collective action**: one car, mirrored
   linked plans, participants that genuinely exist (a kid who needs school; an ill relative; a co-located
   passenger). A validator/test proves **one car per group ride** and that passengers ride rather than
   self-spawn.
4. Guards: `canDrive` (adult + not severely ill + not detained) gates driving; kids can't drive and can't
   reach a far school alone (they ride with a parent); a severely-ill person is driven by a relative, never
   self-drives; under-`VENUE_INDEPENDENCE_AGE` children are accompanied (126 closed).
5. Edge cases handled: open-map/non-enterable destinations don't spawn an enter-a-building car; interruptions
   eject occupants; no rider is stranded (board window + return trips defined).
6. No loose ends: 129 fully reverted, no dangling references; existing school/treatment/routine flows amended;
   determinism + bootstrap parity preserved; the asset regeneration need is explicitly stated (ideally none).
7. Tests for every new behavior; revert-dance for the 129 removal; the live↔bootstrap `arcScenarios` keystone
   and the W8 sprite audit stay green.

## References

`City.startCommute` (~3136) + the 129 reuse block, `agents/Person.ts` (`processTravel` `Arrived`,
`setVehicle`/`abortTravel`/`releaseVehicle`, `joinRide` [new]), `agents/Vehicle.ts` (occupancy model),
`world/Field.ts` (`spawnVehicle`/`removeVehicle`/`removePerson`), `execution/LiveWorld.ts`
(`requestTransition`/`pump`/`departures`), `events/Consequences.ts` (`planJointActivity` ~541),
`actions/Planner.ts` (mirrored entries ~117), `actions/Agenda.ts` (linkId), `skills/SchoolRegistry.ts` +
`skills/SchoolOrchestrator.ts` (enrollment scoring + `attend_school` arrival), `actions/Treatment.ts`
(`canDrive` + relative-driver), `actions/JobOrchestrator.ts` (carpool patrol), `json/actions.json`,
`json/events.json`, `json/routines.json`, `save/SaveManager.ts`, `test/agents/commute.test.ts`,
`test/agents/personTravel.test.ts`, `test/execution/arcScenarios.test.ts`, `TestHarness.auditSprites`.
