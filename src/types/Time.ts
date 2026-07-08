// A point in in-game time. `absoluteDay` is the calendar day index counted from the Year 1 epoch (day 0 =
// the first day of Year 1). The canonical simulation tick is the in-game HOUR (task 040) — see util/time.ts
// (`absoluteTickFromElapsed`, TICKS_PER_DAY) and Clock.getCurrentTick().
export interface Timestamp {
    year: number; // 1-based
    month: number; // 1..MONTHS_PER_YEAR
    day: number; // 1..DAYS_PER_MONTH
    hour: number; // 0..23
    minute: number; // 0..59
    absoluteDay: number; // 0-based day index since the Year 1 epoch
    dayOfWeek: number; // 0 = Monday .. 6 = Sunday (task 057; see util/time WEEKDAY_NAMES / isWeekendDay)
}

// Emitted whenever the displayed time-of-day (minute) advances.
export interface TimeChangedEvent {
    timestamp: Timestamp;
    tick: number; // the current hour tick (Clock.getCurrentTick()), for convenience
}

// Emitted once per hour rollover — the canonical simulation tick (task 040). The event engine (and later
// the Action engine / Brain) run from this.
export interface NewTickEvent {
    timestamp: Timestamp;
    tick: number; // the new hour tick
}

// Emitted once per day rollover. Day-cadence consumers (coarse pool sim, monthly economy gate) subscribe
// to this; the detailed simulation runs on `newTick`.
export interface NewDayEvent {
    timestamp: Timestamp;
    tick: number; // the hour tick at the day rollover (== absoluteDay * TICKS_PER_DAY)
}
