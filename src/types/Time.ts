// A point in in-game time. `absoluteDay` is the canonical genealogy tick: the integer day index counted
// from the Year 1 epoch (day 0 = the first day of Year 1). See docs/tasks/005-clock-and-calendar-system_DONE.md.
export interface Timestamp {
    year: number; // 1-based
    month: number; // 1..MONTHS_PER_YEAR
    day: number; // 1..DAYS_PER_MONTH
    hour: number; // 0..23
    minute: number; // 0..59
    absoluteDay: number; // 0-based day index since the Year 1 epoch (== the genealogy tick)
}

// Emitted whenever the displayed time-of-day (minute) advances.
export interface TimeChangedEvent {
    timestamp: Timestamp;
    tick: number; // absoluteDay, for convenience
}

// Emitted once per day rollover. The future life-event simulation (004d) subscribes to this.
export interface NewDayEvent {
    timestamp: Timestamp;
    tick: number; // the new absoluteDay
}
