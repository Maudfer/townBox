# [Framework] Calendar weekday & weekend support

- **Type:** Framework / Simulation
- **Labels:** `calendar`, `time`, `progression-arc`
- **Depends on:** [056](056-progression-arc-discovery-baseline_DONE.md) (decision ratification)
- **Blocks:** [058](058-school-assignments-and-scheduling_DONE.md) (weekday school), [063](063-school-day-skill-progression_DONE.md) (eligible-day counting)

## Goal

Promote the day-of-week that already exists as raw math into a first-class calendar concept with a **weekend**,
consumed by Brain/school scheduling. The week is 7 days, Saturday and Sunday are weekend days, and the calendar
must expose: absolute simulation day, in-game hour, day of week, `isWeekend`, and year/age progression — most of
which already exist and only need surfacing.

## Background (verified)

`util/time.ts` already has `DAYS_PER_WEEK = 7`, `WEEKDAY_NAMES = ['mon'..'sun']` (**day 0 = Monday**), and
`dayOfWeekOfTick(tick)` (`absolute day % 7`, negative-safe — bootstrap runs on negative ticks). `Timestamp`
(built by `timestampFromElapsed`) has `{year, month, day, hour, minute, absoluteDay}` but **no `dayOfWeek`**;
`Clock` exposes no weekday accessor; there is no weekend helper anywhere. The only consumer of weekday math is
`util/shifts.ts` (`isOnShiftAt`/`isOnShiftAtTick`), driven by per-job `daysOfWeek` from `json/jobs.json`.

**Ratified decision (056):** per-job authored `daysOfWeek` (045) is **kept** — jobs keep their off-days; the
vision doc's "adults work 7 days" simplification is superseded by shipped, richer data. The weekend concept
introduced here gates **school** (058), not jobs.

## Requirements

- `util/time.ts`: add `WEEKEND_DAYS` (`[5, 6]` = sat/sun given day 0 = Monday), `isWeekendDay(dayOfWeek)`, and
  `isWeekendTick(tick)`. Add `dayOfWeek` to the `Timestamp` type and populate it in `timestampFromElapsed`
  (pure; `types/Time.ts` update).
- `Clock`: `getDayOfWeek(): number` (derives via `dayOfWeekOfTick(getCurrentTick())`) and
  `isWeekend(): boolean`. Clock stays a thin deriver — no new state, no save change.
- The helpers must be stable across the whole tick axis: negative (bootstrap pre-history) ticks, year
  boundaries (360-day years are not divisible by 7 — weekday drifts across years by design, matching the
  documented "deliberately unaligned with the 30-day month" convention), and coarse `ticksPerStep` strides.
- HUD nicety (small): the clock widget (`hud/Clock.tsx`) shows the weekday name (from `WEEKDAY_NAMES` via the
  `timeChanged` payload / timestamp). Keep it presentation-only.
- Leave `util/shifts.ts` and job data untouched (jobs already handle weekdays); school scheduling (058) becomes
  the first consumer of `isWeekend`.
- Design must not preclude future holidays / school vacations / PTO / shift rotation — keep "is this a school
  day?" answerable by composition (weekday check now, calendar-exception layers later), don't hardcode
  `!isWeekend` deep inside consumers. A single `isSchoolDay(tick)`-style helper (naturally living with 058's
  school config) should be the extension point.

## Non-goals

Holidays, vacations, PTO, shift rotation, reduced workweeks (explicitly out of scope; must merely not be
prevented). No weekday drivers in the event grammar (`hourOfDay` remains the only intra-day probabilistic
driver; a `dayOfWeek` driver is a possible future, not this task). No changes to job scheduling.

## Testing

- Weekday rollover across multiple years, including the 360/7 drift (e.g. day 0 = mon ⇒ day 360 = tue, etc.).
- Negative-tick weekdays match the positive-axis cycle (continuity through tick 0).
- `isWeekendTick` ↔ `dayOfWeekOfTick` consistency; `Timestamp.dayOfWeek` agrees with `dayOfWeekOfTick` for the
  same elapsed time.
- Coarse-stride sanity: stepping N ticks never skips a weekend/weekday misclassification (pure-function tests).
- Existing `test/time.test.ts` / `test/shifts.test.ts` untouched and green.
