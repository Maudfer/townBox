// Mood (task 091 / proposal G1): one per-person meter (0–100) that gives the whole event corpus mechanical
// meaning. Events declare a VALENCE (−3…+3); each commit lands an impulse whose magnitude picks its
// half-life — small ripples fade in days, grief takes months. Mood is read closed-form (baseline + the sum
// of decaying impulses; the K2 stride rule) and feeds consent, selection gates (the `mood` context
// attribute — vice/withdrawal data gates on it), and the inspector.

export interface MoodImpulse {
    amount: number;        // signed mood points at landing time
    atTick: number;
    halfLifeTicks: number;
}

export interface PersonMood {
    impulses: MoodImpulse[]; // bounded (maxActiveImpulses), strongest-surviving
}

export interface MoodState {
    people: Record<string, PersonMood>;
}

export interface MoodConfig {
    baseline: number;        // where mood rests with no active impulses
    impulseScale: number;    // mood points per |valence| unit
    // Half-life (in days) per |valence| magnitude — grief (|3|) outlives a stubbed toe (|1|) by months.
    halfLifeDays: Record<'1' | '2' | '3', number>;
    maxActiveImpulses: number;
    pruneBelow: number;      // impulses decayed below this are dropped
}

// The reader/writer surface engines consult through SimulationMarkets.
export interface MoodReader {
    moodOf(personId: string, tick: number): number;
    impulse(personId: string, valence: number, tick: number): void;
    removePerson(personId: string): void;
}
