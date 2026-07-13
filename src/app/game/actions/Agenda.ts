// The agenda (task 085 / proposal D1): persisted per-person planned intents, serialized in the save (v16
// family). Producers enqueue entries (routines, social planning, joint-activity invitations); the
// plannerHook proposes them inside their window; fulfillment and expiry are detected LAZILY on read — no
// sweeps, the closed-form discipline of needs/edges. A fulfilled entry vanishes (the action happened, however
// it happened); an expired one vanishes too (a plan that quietly fell through — abandonment log entries land
// with the pause/resume task).
//
// Task 118: reads are indexed per person. hasPendingRoutine/dueEntriesOf run ~10× per person per tick in the
// generator's hot band, and the old whole-table Object.values scan was ~17% of the entire run. The index is
// pure bookkeeping (rebuilt on load, kept in sync by the two mutation points) — behavior is unchanged.

import { AgendaEntry, AgendaState, AgendaWriter } from 'types/Agenda';
import { PersonId } from 'types/Genealogy';
import { HasEventQuery } from 'types/Simulation';

export type HasActionQuery = (actionId: string, query?: HasEventQuery) => boolean;

export default class Agenda implements AgendaWriter {
    private state: AgendaState;
    // Entry ids per person, in enqueue order (insertion-ordered Set) — the read index.
    private byPerson: Map<PersonId, Set<string>>;

    constructor() {
        this.state = { entries: {}, nextSeq: 0 };
        this.byPerson = new Map();
    }

    private index(entry: AgendaEntry): void {
        let ids = this.byPerson.get(entry.personId);
        if (!ids) {
            ids = new Set();
            this.byPerson.set(entry.personId, ids);
        }
        ids.add(entry.id);
    }

    private drop(entry: AgendaEntry): void {
        delete this.state.entries[entry.id];
        this.byPerson.get(entry.personId)?.delete(entry.id);
    }

    private entriesOf(personId: PersonId): AgendaEntry[] {
        const ids = this.byPerson.get(personId);
        if (!ids || ids.size === 0) {
            return [];
        }
        const entries: AgendaEntry[] = [];
        for (const id of ids) {
            const entry = this.state.entries[id];
            if (entry) {
                entries.push(entry);
            }
        }
        return entries;
    }

    enqueue(entry: Omit<AgendaEntry, 'id'>): AgendaEntry {
        const record: AgendaEntry = { ...entry, id: `g${this.state.nextSeq++}` };
        this.state.entries[record.id] = record;
        this.index(record);
        return record;
    }

    // The person's entries due at `tick`, oldest window first. Prunes fulfilled entries (the action occurred
    // since enqueueing — organically or via the plan) and expired ones as it reads.
    dueEntriesOf(personId: PersonId, tick: number, hasAction: HasActionQuery): AgendaEntry[] {
        const due: AgendaEntry[] = [];
        for (const entry of this.entriesOf(personId)) {
            const sinceEnqueue = tick - entry.enqueuedAtTick;
            if (sinceEnqueue > 0 && hasAction(entry.actionId, { withinTicks: sinceEnqueue })) {
                this.drop(entry); // fulfilled (organically or via the plan)
                continue;
            }
            if (tick > entry.latestTick) {
                this.drop(entry); // expired — the plan fell through
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
        for (const entry of this.entriesOf(personId)) {
            if (entry.routineId === routineId && tick <= entry.latestTick) {
                return true;
            }
        }
        return false;
    }

    // Pending (unexpired) entries sharing a joint-plan link (D3) — lets one side see the other's commitment.
    // Rare (one per consented invitation), so the whole-table scan is fine here.
    entriesByLink(linkId: string): AgendaEntry[] {
        return Object.values(this.state.entries)
            .filter(entry => entry.linkId === linkId)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    removeEntry(id: string): void {
        const entry = this.state.entries[id];
        if (entry) {
            this.drop(entry);
        }
    }

    removePerson(personId: PersonId): void {
        for (const id of this.byPerson.get(personId) ?? []) {
            delete this.state.entries[id];
        }
        this.byPerson.delete(personId);
    }

    serialize(): AgendaState {
        return {
            entries: Object.fromEntries(Object.entries(this.state.entries).map(([id, entry]) => [id, { ...entry }])),
            nextSeq: this.state.nextSeq,
        };
    }

    loadState(state: AgendaState | undefined): void {
        this.state = { entries: {}, nextSeq: state?.nextSeq ?? 0 };
        this.byPerson = new Map();
        for (const [id, entry] of Object.entries(state?.entries ?? {})) {
            this.state.entries[id] = { ...entry };
            this.index(this.state.entries[id]!);
        }
    }
}
