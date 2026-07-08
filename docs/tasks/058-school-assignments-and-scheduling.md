# [Feature] School assignments, scheduling & weekend behavior

- **Type:** Feature / Simulation
- **Labels:** `school`, `brain`, `calendar`, `progression-arc`
- **Depends on:** [057](057-calendar-weekdays-and-weekends.md) (`isWeekend`), [056](056-progression-arc-discovery-baseline_DONE.md)
- **Blocks:** [063](063-school-day-skill-progression.md) (progression needs completed school days), [055](055-history-asset-pipeline.md) (offline world must include logical schools)

## Goal

Children aged **7 through 17** attend school on **weekdays** when they hold a **valid school assignment** at a
**reachable school**; they stop at **18** and become job-search eligible; children with no valid assignment
follow normal free-time Brain behavior (and receive **no** school skill progression). Same behavior in live and
bootstrap execution.

## Background (verified)

Nothing schedulable exists today: `Brain.ts` has zero age logic (obligation = has-job + `isOnShiftAtTick`;
children have no job so they idle into free time); education events are effect-free manual texture
(`started_school`, `graduated_school`, …); there is **no attend-school action** in `actions.json`. The `school`
business blueprint exists (`businesses.json`: manager/teacher/janitor, education demand category) — schools are
real map buildings with a size. `venue:` locations have no live map backing (`LiveWorld.targetBuilding` → null),
so live attendance must target `building:<anchorKey>`. Live commutes are car-based (`City.startCommute` walks
to a car and drives); **children can't drive** — this task needs a walking commute. `get_job` already gates on
`age >= 18`, so job-search eligibility at 18 aligns for free once the school obligation stops.

**Design decision (ratified in 056): school is NOT modeled as a Job.** It shares scheduling shape (a weekday
window) but differs in rank progression, compensation, and skill awarding. It gets its own assignment contract
and its own market adapter, mirroring the `JobMarket`/`HousingMarket` pattern.

## Requirements

### Data — `json/schools.json` (new, registered schema)

- School day schedule: `dayStart`/`dayEnd` (minutes since midnight, e.g. 08:00–14:00), `daysOfWeek`
  (weekdays; validator rejects weekend days for now), enrollment ages (`minAge: 7`, `maxAge: 17`), and a
  **capacity curve** over school business size (same `Curve` substrate as blueprints — a size-8 school seats
  more students than a size-1). Register structural + semantic validators (039 registry) with invalid fixtures.
- A `isSchoolDay(tick)` helper (schedule × `isWeekend`) becomes the single source of school-day truth — the
  extension point 057 reserved for future holidays/vacations.

### School assignments — `SchoolMarket` + registry

- A `SchoolAssignment` record: `{ personId, schoolKey, assignedAtTick }` — validity and the schedule are
  **derived**, not stored (an assignment is valid iff the school building still exists with an active school
  business and the person is 7–17): no stale flags to maintain. Assignments live in a personId-keyed registry
  (the `Inventory`/`LifeLog` pattern — works off-map), serialized (new optional `WorldSnapshot` section +
  `SAVE_VERSION` bump with defaulting migration).
- A `SchoolMarket` adapter (mirror `JobMarket`: interface in `types/LifeEvent.ts`, optional slot in
  `SimulationMarkets`, constructed per tick in `City.handleTick`): deterministic nearest-school-with-a-free-seat
  assignment (distance = Manhattan home↔school like `JobMarket`; ties by anchor key; **no RNG**).
- Enrollment sweeps (deterministic, day-cadence): on turning 7 or materializing at 7–17 → try to enroll; on a
  new school opening → enroll unassigned children; on school closure (bankruptcy 021 / bulldoze 025) →
  assignments to it become invalid, children re-enroll elsewhere if a seat exists. Invoke the existing manual
  `started_school` texture event on first enrollment (causation = the assignment) for narrative value.
- Turning 18 (or death/despawn): assignment released; seat freed.

### Brain — the school obligation

- A new `schoolObligationHook` (onTick, registered alongside `jobOrchestratorHook`): person aged 7–17 + valid
  assignment + `isSchoolDay(tick)` + within the school window → propose the continuous **`attend_school`**
  action (new, `category: 'obligation'` — first real use of that category) with
  `locationOverride: 'building:<schoolKey>'`, priority/necessity matching the work obligation (required,
  `mayInterrupt: true`); outside the window or off-days → request completion of a running instance (same
  pattern as `JobOrchestrator`'s off-shift interrupt).
- `attend_school` declares lifecycle events: `onComplete` → a new manual **`completed_school_day`** event with
  `limit: { once: 'perDay' }` (the seam [063](063-school-day-skill-progression.md) hooks; mirrors
  `stopped_working`'s per-day close). An automated `afterEvent` fallback (042 pattern) guarantees the day
  closes if the instance is never resolved.
- No valid assignment / no reachable school / weekend / age out of band ⇒ the hook proposes nothing and the
  child falls through to normal free-time selection. **No silent auto-schooling.**
- At 18 the obligation disappears and the existing `get_job` event (age ≥ 18) takes over — verify the handoff
  (a fresh 18-year-old with no job starts rolling `get_job`); wire `graduated_school` (manual, exists) on
  age-out while validly enrolled.

### Live-mode travel — children walk

- Extend the commute path so a person without car access **walks**: a walking-only `TravelStep` sequence
  (exit building → walk → enter destination) driven by the existing pedestrian pathfinding (curb waypoints,
  crosswalks). `LiveWorld.requestTransition` stays unchanged — only `City.startCommute` picks walk vs. drive
  (minors always walk). Without this, `attend_school` would block forever in live mode.

### Execution boundary

- All of the above runs inside `TickRunner` phases via Brain/markets — **no** `if (mode === 'bootstrap')`.
  In bootstrap, transitions resolve instantly through `BootstrapWorld`; note that off-map schools don't exist
  until 055's logical world — the code must be mode-agnostic and simply find no school when none is registered.

## Non-goals

School skill progression (063). Preschool/daycare simulation. Holidays/vacations (057 non-goal). Grades,
classrooms, per-teacher assignment. Modeling school as a job. Remote learning. Child job-holding rules beyond
the existing `get_job` age gate.

## Testing

- Weekday attendance: enrolled 10-year-old attends mon–fri within the window, never on sat/sun; the action
  runs at the school building; exactly one `completed_school_day` per calendar day (interrupt/resume same day
  does not double-fire).
- Age gates: 6-year-old never enrolled; enrollment on 7th birthday; obligation ends and `get_job` becomes
  rollable on the 18th birthday.
- No-school fallback: a town without a school (or with a full one) leaves children in free-time behavior; a
  school built later picks them up on the next sweep.
- Closure: school bankruptcy/bulldoze invalidates assignments and re-enrolls where possible.
- Capacity: seats bound by the curve; deterministic assignment order.
- Live walking commute: a minor walks to school and arrives (no car involved); bootstrap resolves instantly
  with identical lifecycle records (extend `test/executionBoundary.test.ts`).
- Save/load round-trip of assignments; determinism across two same-seed runs.
