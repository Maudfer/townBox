// The shared append-only life log (tasks 040/043): ONE globally monotonic commit sequence across both
// record kinds — life Events (EventEngine) and Actions (ActionEngine) — so same-tick records are totally
// ordered and causation chains cross system boundaries (an Action's 'started' entry is the causation of the
// Event it triggers, and vice versa). Both engines hold a reference to the same instance.

import { ActionLogEntry, EventLogEntry, EventLogTable, PersonLogEntry } from 'types/LifeEvent';
import { PersonId } from 'types/Genealogy';

export default class LifeLog {
    private table: EventLogTable;
    private nextSeq: number;

    constructor() {
        this.table = {};
        this.nextSeq = 0;
    }

    // Appends an entry (assigning the global seq) to the person's log and returns the seq.
    append(personId: PersonId, entry: Omit<EventLogEntry, 'seq'> | Omit<ActionLogEntry, 'seq'>): number {
        const seq = this.nextSeq++;
        const entries = this.table[personId] ?? [];
        entries.push({ ...entry, seq } as PersonLogEntry);
        this.table[personId] = entries;
        return seq;
    }

    getTable(): EventLogTable {
        return this.table;
    }

    getPersonLog(personId: PersonId): PersonLogEntry[] {
        return this.table[personId] ?? [];
    }

    getNextSeq(): number {
        return this.nextSeq;
    }

    // Restores the log (save/load). `nextSeq` persists explicitly; when absent (defensive), derive it from
    // the highest stored seq so future commits never collide.
    load(table: EventLogTable, nextSeq?: number): void {
        this.table = table ?? {};
        if (nextSeq !== undefined) {
            this.nextSeq = nextSeq;
        } else {
            let max = -1;
            for (const entries of Object.values(this.table)) {
                for (const entry of entries) {
                    max = Math.max(max, entry.seq);
                }
            }
            this.nextSeq = max + 1;
        }
    }
}
