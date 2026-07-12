// The agenda (task 085 / proposal D1): persisted per-person planned intents, serialized in the save (v16
// family). Producers enqueue entries (routines, social planning, joint-activity invitations); the
// plannerHook proposes them inside their window; fulfillment and expiry are detected LAZILY on read — no
// sweeps, the closed-form discipline of needs/edges. A fulfilled entry vanishes (the action happened, however
// it happened); an expired one vanishes too (a plan that quietly fell through — abandonment log entries land
// with the pause/resume task).

import { AgendaEntry, AgendaState, AgendaWriter } from 'types/Agenda';
import { PersonId } from 'types/Genealogy';
import { HasEventQuery } from 'types/Simulation';

export type HasActionQuery = (actionId: string, query?: HasEventQuery) => boolean;

export default class Agenda implements AgendaWriter {
    private state: AgendaState;

    constructor() {
        this.state = { entries: {}, nextSeq: 0 };
    }

    enqueue(entry: Omit<AgendaEntry, 'id'>): AgendaEntry {
        const record: AgendaEntry = { ...entry, id: `g${this.state.nextSeq++}` };
        this.state.entries[record.id] = record;
        return record;
    }

    // The person's entries due at `tick`, oldest window first. Prunes fulfilled entries (the action occurred
    // since enqueueing — organically or via the plan) and expired ones as it reads.
    dueEntriesOf(personId: PersonId, tick: number, hasAction: HasActionQuery): AgendaEntry[] {
        const due: AgendaEntry[] = [];
        for (const entry of Object.values(this.state.entries)) {
            if (entry.personId !== personId) {
                continue;
            }
            const sinceEnqueue = tick - entry.enqueuedAtTick;
            if (sinceEnqueue > 0 && hasAction(entry.actionId, { withinTicks: sinceEnqueue })) {
                delete this.state.entries[entry.id]; // fulfilled (organically or via the plan)
                continue;
            }
            if (tick > entry.latestTick) {
                delete this.state.entries[entry.id]; // expired — the plan fell through
                continue;
            }
            if (tick >= entry.earliestTick) {
                due.push(entry);
            }
        }
        due.sort((a, b) => a.earliestTick - b.earliestTick || a.id.localeCompare(b.id));
        return due;
    }

    // Whether a routine already has a pending (unexpired) entry for this person — the one-pending-per-routine
    // dedup producers rely on.
    hasPendingRoutine(personId: PersonId, routineId: string, tick: number): boolean {
        return Object.values(this.state.entries).some(entry =>
            entry.personId === personId && entry.routineId === routineId && tick <= entry.latestTick);
    }

    // Pending (unexpired) entries sharing a joint-plan link (D3) — lets one side see the other's commitment.
    entriesByLink(linkId: string): AgendaEntry[] {
        return Object.values(this.state.entries)
            .filter(entry => entry.linkId === linkId)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    removeEntry(id: string): void {
        delete this.state.entries[id];
    }

    removePerson(personId: PersonId): void {
        for (const [id, entry] of Object.entries(this.state.entries)) {
            if (entry.personId === personId) {
                delete this.state.entries[id];
            }
        }
    }

    serialize(): AgendaState {
        return {
            entries: Object.fromEntries(Object.entries(this.state.entries).map(([id, entry]) => [id, { ...entry }])),
            nextSeq: this.state.nextSeq,
        };
    }

    loadState(state: AgendaState | undefined): void {
        this.state = { entries: {}, nextSeq: state?.nextSeq ?? 0 };
        for (const [id, entry] of Object.entries(state?.entries ?? {})) {
            this.state.entries[id] = { ...entry };
        }
    }
}
