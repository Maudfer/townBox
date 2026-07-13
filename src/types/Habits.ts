// Habits (task 095 / proposal G3): per-person, per-vice counters with closed-form cooling — the escalation
// substrate. Practicing a vice bumps its habit; the habit multiplies the vice's selection weight (the
// positive-feedback loop that makes addiction emerge from the same selection math as everything else); left
// alone, it cools with a long half-life. Coping → escalation → (maybe) recovery, zero scripting.

export interface HabitRecord {
    level: number;        // as of updatedAtTick
    updatedAtTick: number;
}

export interface HabitsState {
    people: Record<string, Record<string, HabitRecord>>;
}

export interface HabitsConfig {
    halfLifeDays: number;        // cooling half-life for an unpracticed habit
    escalationPerLevel: number;  // selection-weight bonus per habit level
    practiceBump: number;        // level gained per practice
    maxLevel: number;
}

// The surface engines consult through SimulationMarkets.
export interface HabitsReader {
    levelOf(personId: string, habit: string, tick: number): number;
    practice(personId: string, habit: string, tick: number): void;
    selectionMultiplier(personId: string, habit: string | undefined, tick: number): number;
    removePerson(personId: string): void;
}
