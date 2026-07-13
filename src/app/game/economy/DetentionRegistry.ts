// The detention registry (task 100 / proposal G5): who is serving time, where, and until when. The
// SchoolRegistry pattern — personId-keyed, serialized (v16 family), scene-free, RNG-free. City sentences
// into it (convictions of repeat offenders when a facility exists), the Brain's detained hook reads it to
// keep the person at the facility, and City's day sweep releases the served.

import { PersonId } from 'types/Genealogy';
import { DetentionRecord, DetentionState } from 'types/Detention';

export default class DetentionRegistry {
    private state: DetentionState;

    constructor() {
        this.state = { people: {} };
    }

    detain(personId: PersonId, untilTick: number, locationKey: string): void {
        this.state.people[personId] = { untilTick, locationKey };
    }

    detentionOf(personId: PersonId): DetentionRecord | null {
        return this.state.people[personId] ?? null;
    }

    isDetained(personId: PersonId, tick: number): boolean {
        const record = this.state.people[personId];
        return record !== undefined && tick < record.untilTick;
    }

    // Everyone whose sentence has lapsed as of `tick` (the release sweep's worklist), deterministic order.
    due(tick: number): PersonId[] {
        return Object.entries(this.state.people)
            .filter(([, record]) => tick >= record.untilTick)
            .map(([personId]) => personId)
            .sort();
    }

    release(personId: PersonId): void {
        delete this.state.people[personId];
    }

    removePerson(personId: PersonId): void {
        delete this.state.people[personId];
    }

    serialize(): DetentionState {
        return { people: Object.fromEntries(Object.entries(this.state.people).map(([id, record]) => [id, { ...record }])) };
    }

    loadState(state: DetentionState | undefined): void {
        this.state = { people: {} };
        for (const [id, record] of Object.entries(state?.people ?? {})) {
            this.state.people[id] = { ...record };
        }
    }
}
