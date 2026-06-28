# [Feature] Clock & calendar system

- **Type:** Feature / Core systems
- **Labels:** `feature`, `simulation`, `time`, `ui`

## Summary

Implement an in-game **clock and calendar**. Each in-game **day takes one hour of real time**.
Display the current **date and time** in the UI. Count **years starting from Year 1**. The clock
must be **compatible with the save/load system**, and **jobs gain shift start/end times** so other
systems (commutes, businesses) can react to time of day.

## Background / current state

- **Tick source:** `MainScene.update(time, timeDelta)` emits the `update` event each frame with
  `{ time, timeDelta }` (`types/Events.ts` → `UpdateEvent`). `Field.update()` consumes it to move
  people/vehicles. This is the natural place to advance the clock.
- There is currently **no time, date, clock, or scheduling system** anywhere in the codebase.
- **Jobs:** `types/Work.ts` defines `JobPosition` (`title`, `salary`, `requirements`). `Workplace`
  seeds 10 `Constructor` jobs. There are **no shift times** today.
- **UI:** the React HUD (`Hud.tsx`) and toolbar exist. There is no place that currently shows time.
- **Save/load** is being added in `003-save-load-system_DONE.md`; the clock state must be part of the
  serialized snapshot.

## Goals / Requirements

1. **Time model.** Implement a clock that advances in-game time from the `update` event's
   `timeDelta`. **1 in-game day = 1 real-world hour.** Derive the in-game time-of-day, day, month
   (decide and document the calendar model — e.g. days→months→years), and year from elapsed real
   time since the game (save) started. **Years start at Year 1.**
2. **Single source of truth.** Encapsulate time in one system/class (e.g. `Clock` in `game/`) that
   exposes the current timestamp (year/month/day/hour/minute) and is the only place that advances
   time. Other systems read from it; they must not each re-derive time.
3. **Events.** Emit time signals other systems can subscribe to via the `GameManager` event bus
   (add to `types/Events.ts` `EventPayloads`). At minimum provide a way to react to **time-of-day
   changes** and **day rollovers** (e.g. a `timeChanged` and/or `newDay` event), so the commute and
   business systems can hook in.
4. **UI display.** Show the current **date and time** in the React HUD (a small persistent
   widget/clock). It must update live and read from the clock via the event bus, not by polling game
   internals.
5. **Jobs get shifts.** Extend `JobPosition` (`types/Work.ts`) with **shift start and end times**
   (time-of-day). Update the seeded jobs in `Workplace` accordingly. (Wiring commutes to these
   shifts is `006-job-commute-pathfinding_DONE.md`; this task only adds the data and sensible defaults.)
6. **Save/load compatibility.** Clock state (elapsed in-game time / current timestamp and the epoch)
   must serialize and restore correctly with the save system so loading resumes at the saved time.
   Coordinate with `003-save-load-system_DONE.md`.
7. **Tests.** Add unit tests for time math (real-time → in-game date/time conversion, day rollover,
   year counting from Year 1). `npm test` passes.

8. **Wire the clock into the genealogy / household-generation hooks (task `004`).** The
   household-generation foundation (`004`, phase `004a`, already on branch
   `task/household-generation-redesign`) introduced data and functions that are **time-relative** but
   currently take the time as an explicit parameter because no clock exists yet. This requirement makes
   the clock the single source of those values and connects every clock-dependent hook. **This is the
   integration layer only — the actual life-event _simulation_ (births/deaths/aging over time) remains
   `004d` and is out of scope here (see Out of scope).** Specifically:

   1. **Define the canonical genealogy tick = the absolute in-game day index.** The genealogy stores
      time as integer ticks (`birthTick`, `deathTick`, `Partnership.startTick`/`endTick` in
      `src/types/Genealogy.ts`). Adopt **one in-game day** as that tick unit (the finest calendar unit
      the clock rolls over), counted as an absolute day number from the Year 1 epoch (day 0 = the first
      day of Year 1). Document this in `CLAUDE.md` alongside the calendar granularity decision.
   2. **Expose the current tick and the year conversion from the `Clock`.** Add to the `Clock`
      (single source of truth, Requirement 2):
      - `getCurrentTick(): number` — the absolute in-game day index right now (what the genealogy calls
        "the current tick").
      - `getTicksPerYear(): number` — equals the calendar's **days-per-year** constant chosen in
        Requirement 1 / the Notes (`DAYS_PER_YEAR`). This is the `ticksPerYear` argument the genealogy
        age math expects.
      Other systems must read these from the `Clock`; they must not re-derive day counts from
      `timeDelta` themselves (Requirement 2).
   3. **Wire the clock-dependent pure hooks in `src/util/kinship.ts`.** These already exist and are
      unit-tested with explicit time arguments; their call sites must now pass the clock's values:
      - `ageAt(person, tick, ticksPerYear)` → call with `clock.getCurrentTick()` and
        `clock.getTicksPerYear()`.
      - `isAliveAt(person, tick)` → call with `clock.getCurrentTick()`.
      - `spouseAt(pool, id, tick)` → call with `clock.getCurrentTick()`.
      Do **not** change these functions' signatures (keeping the tick explicit is what makes them
      deterministic and testable); only the callers bind the clock.
   4. **Make `SocialLife` age derive from the clock.** Per the `004` proposal §6, `SocialLife` becomes a
      view over a genealogy record and `getAge()` must return `ageAt(record, clock.getCurrentTick(),
      clock.getTicksPerYear())` instead of a stored integer. The `Clock` must therefore be reachable
      from where `SocialLife.getAge()` is evaluated — expose it via `GameManager` (e.g. `game.clock`,
      mirroring `game.field`/`game.city`) so the view can read it without a Phaser scene. (If `004c`
      lands before this task, that PR will add the `personId`-view plumbing and a temporary
      fixed-epoch tick; this requirement replaces that fixed epoch with the live clock.)
   5. **Household draw uses the live tick.** The `houseBuilt` household draw (`004c`) selects who is
      **alive and of an appropriate age** at the moment of placement — it must use `clock.getCurrentTick()`
      (via the helpers above), not a hardcoded epoch, so households are coherent with the current date.
   6. **Provide the day-rollover hook `004d` will consume.** The `newDay`/`timeChanged` events from
      Requirement 3 are the triggers the future life-event simulation (`004d`) subscribes to in order to
      advance births/deaths/aging. This task only needs to **emit** them with the current tick available
      in the payload (e.g. include `tick`/the timestamp), so `004d` can hook in without further clock
      changes. Document the payload in `types/Events.ts`.
   7. **Tests.** Add a unit test asserting the tick contract: `getTicksPerYear()` equals
      `DAYS_PER_YEAR`, and that feeding `clock.getCurrentTick()`/`getTicksPerYear()` into `ageAt` yields
      the expected age for a person with a known `birthTick` (e.g. a record born `N` years before the
      current date reads as age `N`). Keep it scene-free.

## Out of scope

- Pause / fast-forward / time-scaling controls (can be a follow-up).
- The **life-event simulation itself** — births, deaths, and aging *progressing over time* — driven by
  the calendar. That is `004d` in `004-household-generation-redesign_DONE.md`. This task only provides the
  tick contract and the day-rollover signal `004d` consumes (Requirement 8), and wires the existing
  time-relative read hooks (`ageAt`/`isAliveAt`/`spouseAt`, derived `getAge()`); it does **not** mutate
  the population over time.
- The actual commute scheduling (handled in `006`).

## Acceptance criteria

- In-game time advances such that one real hour equals one in-game day.
- The HUD shows a live, correct date and time; years count from Year 1.
- `JobPosition` carries shift start/end times with sensible defaults on seeded jobs.
- A day-rollover (and time-of-day) signal is available on the event bus, carrying the current tick in
  its payload.
- Clock state survives save → load.
- The clock exposes `getCurrentTick()` (absolute in-game day index) and `getTicksPerYear()`
  (`= DAYS_PER_YEAR`); the genealogy hooks `ageAt`/`isAliveAt`/`spouseAt` (`src/util/kinship.ts`) and
  `SocialLife.getAge()` read time from the clock rather than a hardcoded epoch.
- `npm test` passes with new time-math tests (including the tick-contract/age-derivation test).

## Notes

- Make the time math pure and unit-testable (a function from elapsed real ms → in-game timestamp),
  independent of Phaser, so it can be tested without a scene.
- Decide the calendar granularity (how many days per month/year) and document it; keep it simple and
  consistent. Define real-time→in-game scale precisely (1 day = 3600 real seconds). The **days-per-year**
  value chosen here is reused directly as the genealogy `ticksPerYear` (Requirement 8), so pick it with
  realistic ages in mind (a person aged ~80 should span a sensible number of in-game days).
- The genealogy tick is the **absolute in-game day index from the Year 1 epoch** (Requirement 8); keep
  the clock's internal day counter compatible with that so `getCurrentTick()` is a direct read, not a
  conversion.
- Prevent `Ctrl+S` (save) and the time widget from interfering; coordinate ordering with `003`.
