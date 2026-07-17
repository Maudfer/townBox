// The mood ledger (task 091 / proposal G1): per-person morale, serialized (save v16 family), driven by
// event VALENCE impulses and read closed-form — mood(t) = clamp(baseline + Σ impulse·0.5^((t−at)/halfLife)).
// Magnitude picks the half-life: a ±1 ripple fades in days, a ±3 blow (a spouse's death) shadows months.
// The impulse list is bounded (strongest-surviving), so state stays small and reads stay O(few).

import moodConfig from 'json/mood.json';
import { PersonId } from 'types/Genealogy';
import { MoodConfig, MoodReader, MoodState, PersonMood } from 'types/Mood';

export const MOOD_CONFIG = moodConfig as unknown as MoodConfig;

const TICKS_PER_DAY = 24;

export default class Mood implements MoodReader {
    private state: MoodState;
    private config: MoodConfig;

    constructor(config: MoodConfig = MOOD_CONFIG) {
        this.state = { people: {} };
        this.config = config;
    }

    // The decayed mood (0–100). People with no recorded impulses sit at the baseline.
    moodOf(personId: PersonId, tick: number): number {
        const person = this.state.people[personId];
        let mood = this.config.baseline;
        for (const impulse of person?.impulses ?? []) {
            mood += impulse.amount * Math.pow(0.5, Math.max(0, tick - impulse.atTick) / impulse.halfLifeTicks);
        }
        return Math.min(100, Math.max(0, mood));
    }

    // Lands a valence impulse (−3…+3, non-integers scale linearly; 0 is a no-op). Prunes decayed dust and
    // keeps only the strongest few — one meter, bounded state.
    impulse(personId: PersonId, valence: number, tick: number): void {
        if (valence === 0) {
            return;
        }
        const magnitude = String(Math.min(3, Math.max(1, Math.round(Math.abs(valence))))) as '1' | '2' | '3';
        const halfLifeTicks = this.config.halfLifeDays[magnitude] * TICKS_PER_DAY;
        const person: PersonMood = this.state.people[personId] ?? { impulses: [] };
        person.impulses.push({ amount: valence * this.config.impulseScale, atTick: tick, halfLifeTicks });
        // Prune dust, then keep the strongest by CURRENT contribution (deterministic tie-break by atTick).
        const contribution = (impulse: typeof person.impulses[number]): number =>
            Math.abs(impulse.amount) * Math.pow(0.5, Math.max(0, tick - impulse.atTick) / impulse.halfLifeTicks);
        person.impulses = person.impulses
            .filter(impulse => contribution(impulse) >= this.config.pruneBelow)
            .sort((a, b) => contribution(b) - contribution(a) || a.atTick - b.atTick)
            .slice(0, this.config.maxActiveImpulses);
        this.state.people[personId] = person;
    }

    removePerson(personId: PersonId): void {
        delete this.state.people[personId];
    }

    serialize(): MoodState {
        const people: MoodState['people'] = {};
        for (const [personId, person] of Object.entries(this.state.people)) {
            people[personId] = { impulses: person.impulses.map(impulse => ({ ...impulse })) };
        }
        return { people };
    }

    loadState(state: MoodState | undefined): void {
        this.state = { people: {} };
        for (const [personId, person] of Object.entries(state?.people ?? {})) {
            this.state.people[personId] = { impulses: person.impulses.map(impulse => ({ ...impulse })) };
        }
    }
}
