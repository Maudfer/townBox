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
- **Save/load** is being added in `003-save-load-system.md`; the clock state must be part of the
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
   shifts is `006-job-commute-pathfinding.md`; this task only adds the data and sensible defaults.)
6. **Save/load compatibility.** Clock state (elapsed in-game time / current timestamp and the epoch)
   must serialize and restore correctly with the save system so loading resumes at the saved time.
   Coordinate with `003-save-load-system.md`.
7. **Tests.** Add unit tests for time math (real-time → in-game date/time conversion, day rollover,
   year counting from Year 1). `npm test` passes.

## Out of scope

- Pause / fast-forward / time-scaling controls (can be a follow-up).
- Aging, births, and death driven by the calendar (related to
  `004-household-generation-redesign.md`; out of scope here).
- The actual commute scheduling (handled in `006`).

## Acceptance criteria

- In-game time advances such that one real hour equals one in-game day.
- The HUD shows a live, correct date and time; years count from Year 1.
- `JobPosition` carries shift start/end times with sensible defaults on seeded jobs.
- A day-rollover (and time-of-day) signal is available on the event bus.
- Clock state survives save → load.
- `npm test` passes with new time-math tests.

## Notes

- Make the time math pure and unit-testable (a function from elapsed real ms → in-game timestamp),
  independent of Phaser, so it can be tested without a scene.
- Decide the calendar granularity (how many days per month/year) and document it; keep it simple and
  consistent. Define real-time→in-game scale precisely (1 day = 3600 real seconds).
- Prevent `Ctrl+S` (save) and the time widget from interfering; coordinate ordering with `003`.
