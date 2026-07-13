// The shared append-only life log (tasks 040/043): ONE globally monotonic commit sequence across both
// record kinds — life Events (EventEngine) and Actions (ActionEngine) — so same-tick records are totally
// ordered and causation chains cross system boundaries (an Action's 'started' entry is the causation of the
// Event it triggers, and vice versa). Both engines hold a reference to the same instance.

import { PersonId } from 'types/Genealogy';
import { ActionLogEntry, EventLogEntry, EventLogTable, PersonLogEntry } from 'types/LifeEvent';

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

    // Recent-action count for the shared log (task 097): how many times the person committed the given
    // action at or after `sinceTick`. Entries are append-ordered, so the backwards scan bails at the first
    // entry older than the window — cheap even on asset-hydrated logs with tens of thousands of entries.
    countRecentActions(personId: PersonId, defId: string, sinceTick: number): number {
        const entries = this.table[personId] ?? [];
        let count = 0;
        for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index]!;
            if (entry.tick < sinceTick) {
                break;
            }
            if (entry.kind === 'action' && entry.defId === defId) {
                count += 1;
            }
        }
        return count;
    }

    // The event twin (task 111): recent EVENT commits in the window (recentlyTreated reads
    // was_treated_by_doctor through it). Same backwards bail-out scan.
    countRecentEvents(personId: PersonId, defId: string, sinceTick: number): number {
        const entries = this.table[personId] ?? [];
        let count = 0;
        for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index]!;
            if (entry.tick < sinceTick) {
                break;
            }
            if (entry.kind === 'event' && entry.defId === defId) {
                count += 1;
            }
        }
        return count;
    }

    // Installs a person's PRE-GAME log entries from the history asset (lazy hydration, task 012 follow-up).
    // Asset entries predate anything committed live, so they go BEFORE any existing entries, and `nextSeq` is
    // raised past the installed seqs so future commits never collide. (Loops, not spreads — a person's
    // pre-game log can hold tens of thousands of entries and spreading them would overflow the call stack.)
    installPersonEntries(personId: PersonId, entries: PersonLogEntry[]): void {
        if (entries.length === 0) {
            return;
        }
        const existing = this.table[personId] ?? [];
        const merged: PersonLogEntry[] = [];
        for (const entry of entries) {
            merged.push(entry);
            if (entry.seq >= this.nextSeq) {
                this.nextSeq = entry.seq + 1;
            }
        }
        for (const entry of existing) {
            merged.push(entry);
        }
        this.table[personId] = merged;
    }

    // Hands back the accumulated entries and RESETS the table to empty, keeping `nextSeq` (task 077 streaming):
    // the offline generator flushes the full log to disk shards periodically so it never holds the whole
    // centuries-long log in RAM. The aggregate history (EventEngine.history) is separate and unaffected, so the
    // sim's hasEvent queries keep working after a drain — the full log is write-only during generation.
    drain(): EventLogTable {
        const drained = this.table;
        this.table = {};
        return drained;
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
