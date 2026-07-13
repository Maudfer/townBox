// The habits ledger (task 095 / proposal G3): per-person vice counters, serialized (save v16 family), read
// closed-form — level(t) = level × 0.5^((t − updated)/halfLife). Practicing bumps (materialize-then-add,
// the needs/edges discipline); the level multiplies the vice's selection weight, so repeated coping
// escalates and abstinence cools. Deterministic, RNG-free.

import habitsConfig from 'json/habits.json';
import { PersonId } from 'types/Genealogy';
import { HabitsConfig, HabitsReader, HabitsState } from 'types/Habits';

export const HABITS_CONFIG = habitsConfig as unknown as HabitsConfig;

const TICKS_PER_DAY = 24;

export default class Habits implements HabitsReader {
    private state: HabitsState;
    private config: HabitsConfig;

    constructor(config: HabitsConfig = HABITS_CONFIG) {
        this.state = { people: {} };
        this.config = config;
    }

    levelOf(personId: PersonId, habit: string, tick: number): number {
        const record = this.state.people[personId]?.[habit];
        if (!record) {
            return 0;
        }
        const halfLifeTicks = this.config.halfLifeDays * TICKS_PER_DAY;
        return record.level * Math.pow(0.5, Math.max(0, tick - record.updatedAtTick) / halfLifeTicks);
    }

    practice(personId: PersonId, habit: string, tick: number): void {
        const cooled = this.levelOf(personId, habit, tick);
        const person = this.state.people[personId] ?? {};
        person[habit] = { level: Math.min(this.config.maxLevel, cooled + this.config.practiceBump), updatedAtTick: tick };
        this.state.people[personId] = person;
    }

    // The escalation multiplier a vice's selection weight picks up from its habit level.
    selectionMultiplier(personId: PersonId, habit: string | undefined, tick: number): number {
        if (!habit) {
            return 1;
        }
        return 1 + this.levelOf(personId, habit, tick) * this.config.escalationPerLevel;
    }

    removePerson(personId: PersonId): void {
        delete this.state.people[personId];
    }

    serialize(): HabitsState {
        const people: HabitsState['people'] = {};
        for (const [personId, habits] of Object.entries(this.state.people)) {
            people[personId] = Object.fromEntries(Object.entries(habits).map(([habit, record]) => [habit, { ...record }]));
        }
        return { people };
    }

    loadState(state: HabitsState | undefined): void {
        this.state = { people: {} };
        for (const [personId, habits] of Object.entries(state?.people ?? {})) {
            this.state.people[personId] = Object.fromEntries(Object.entries(habits).map(([habit, record]) => [habit, { ...record }]));
        }
    }
}
