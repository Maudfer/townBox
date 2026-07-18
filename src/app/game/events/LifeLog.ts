// The shared append-only life log (tasks 040/043): ONE globally monotonic commit sequence across both
// record kinds — life Events (EventEngine) and Actions (ActionEngine) — so same-tick records are totally
// ordered and causation chains cross system boundaries (an Action's 'started' entry is the causation of the
// Event it triggers, and vice versa). Both engines hold a reference to the same instance.

import { PersonId } from 'types/Genealogy';
import { ActionLogEntry, EventLogEntry, EventLogTable, PersonLogEntry } from 'types/LifeEvent';
import { SeededRandom, hashStringToSeed } from 'util/random';

// The intra-tick cadence salt (LP-11): minute stamping forks the world seed per (tick, person) so it never
// perturbs the event/action/brain streams.
export const CADENCE_SALT = 0x1c;
export const MINUTES_PER_TICK = 60;

export default class LifeLog {
    private table: EventLogTable;
    private nextSeq: number;
    // Per-person LIVE floor (LP-1 / proposal simulation-aliveness-2 P0-1): the first seq that belongs to
    // live play, set when a person's PRE-GAME asset entries are installed (max installed seq + 1). The
    // save serializes only entries at/above the floor — a 100k-entry hydrated past made JSON.stringify
    // throw RangeError and would never fit localStorage; the pre-game past is a hydration-time view,
    // re-installed from the asset on load, never save payload. Not serialized itself: load() resets the
    // floors and the post-load re-hydration re-establishes them by installing again.
    private liveFloors: Record<PersonId, number>;
    // Appends awaiting their minute stamp (LP-11) — transient, cleared by stampMinutes/drain/load. Holds
    // ENTRY REFERENCES, never indices: hydration prepends pre-game entries, which would shift positions.
    private pendingStamps: { personId: PersonId; entry: PersonLogEntry }[];

    constructor() {
        this.table = {};
        this.nextSeq = 0;
        this.liveFloors = {};
        this.pendingStamps = [];
    }

    // Appends an entry (assigning the global seq) to the person's log and returns the seq.
    append(personId: PersonId, entry: Omit<EventLogEntry, 'seq'> | Omit<ActionLogEntry, 'seq'>): number {
        const seq = this.nextSeq++;
        const entries = this.table[personId] ?? [];
        const stored = { ...entry, seq } as PersonLogEntry;
        entries.push(stored);
        this.table[personId] = entries;
        this.pendingStamps.push({ personId, entry: stored });
        return seq;
    }

    // The intra-tick cadence pass (LP-11 / proposal M1): stamps every entry appended since the last pass
    // with its materialization minute. Rules: a person's fresh entries spread evenly across the hour with
    // ±20%-of-slot jitter (deterministic per worldSeed/tick/person — the CADENCE_SALT stream, isolated
    // from every decision stream); an entry whose causation committed in the same pass inherits its
    // cause's minute (a gift and its received-counterpart land the same minute); minutes stay
    // non-decreasing per person so the inspector's seq order never reads backwards in time.
    stampMinutes(tick: number, worldSeed: number): void {
        if (this.pendingStamps.length === 0) {
            return;
        }
        const pending = this.pendingStamps;
        this.pendingStamps = [];

        // Slot sequences are keyed by (person, tick) — batch boundaries must never change a minute (the
        // generator stamps leftovers at flush time while an in-memory run stamps them a tick later, and
        // the streamed and in-memory assets must be identical), and all of one (person, tick)'s entries
        // always share a batch (the spine stamps every tick; leftovers only ever span COMPLETED ticks).
        const seqMinute = new Map<number, number>();
        const groupCounts = new Map<string, number>();
        for (const { personId, entry } of pending) {
            const key = `${personId}|${entry.tick ?? tick}`;
            groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
        }
        const slotState = new Map<string, { offsets: number[]; next: number; lastMinute: number }>();
        const slotsFor = (personId: PersonId, entryTick: number): { offsets: number[]; next: number; lastMinute: number } => {
            const key = `${personId}|${entryTick}`;
            let state = slotState.get(key);
            if (!state) {
                const count = groupCounts.get(key) ?? 1;
                const rng = new SeededRandom(worldSeed).fork(entryTick).fork(hashStringToSeed(personId)).fork(CADENCE_SALT);
                const slotWidth = MINUTES_PER_TICK / count;
                const offsets: number[] = [];
                for (let i = 0; i < count; i++) {
                    const center = (i + 0.5) * slotWidth;
                    const jitter = (rng.next() * 2 - 1) * 0.2 * slotWidth; // ±20% of the slot, the M1 spec
                    offsets.push(Math.min(MINUTES_PER_TICK - 1, Math.max(0, Math.round(center + jitter))));
                }
                state = { offsets, next: 0, lastMinute: 0 };
                slotState.set(key, state);
            }
            return state;
        };

        // Pending appends are in global seq order (append order), so causes stamp before their effects.
        for (const { personId, entry } of pending) {
            if (entry.minute !== undefined) {
                continue;
            }
            const state = slotsFor(personId, entry.tick ?? tick);
            const inherited = entry.causationId !== null && entry.causationId !== undefined
                ? seqMinute.get(entry.causationId)
                : undefined;
            let minute = inherited ?? state.offsets[Math.min(state.next, state.offsets.length - 1)]!;
            if (inherited === undefined) {
                state.next += 1;
            }
            minute = Math.max(minute, state.lastMinute); // per-(person, hour) monotonic in seq order
            state.lastMinute = minute;
            entry.minute = minute;
            seqMinute.set(entry.seq, minute);
        }
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
            // 'departed' is travel-toward, not a commit (LP-2) — recency counts commits only.
            if (entry.kind === 'action' && entry.defId === defId && entry.lifecycle !== 'departed') {
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
        // Idempotence guard (LP-1): a person's pre-game past installs at most once per log lifetime —
        // hydration and the post-load log re-hydration may both reach a person, and a second install
        // would duplicate tens of thousands of entries. load() resets the floors, so a freshly loaded
        // (live-only) log accepts the re-install.
        if (this.liveFloors[personId] !== undefined) {
            return;
        }
        const existing = this.table[personId] ?? [];
        const merged: PersonLogEntry[] = [];
        let maxInstalled = -1;
        for (const entry of entries) {
            merged.push(entry);
            if (entry.seq > maxInstalled) {
                maxInstalled = entry.seq;
            }
            if (entry.seq >= this.nextSeq) {
                this.nextSeq = entry.seq + 1;
            }
        }
        for (const entry of existing) {
            merged.push(entry);
        }
        this.table[personId] = merged;
        this.liveFloors[personId] = maxInstalled + 1;
    }

    // The live-era view (LP-1): every person's entries at/above their live floor — exactly what the save
    // serializes. People with no floor (cold-start, newborns, immigrants) serialize in full. The live
    // entries are the array's tail (installs prepend), so the backwards scan costs O(live entries).
    getLiveTable(): EventLogTable {
        const live: EventLogTable = {};
        for (const [personId, entries] of Object.entries(this.table)) {
            const floor = this.liveFloors[personId];
            if (floor === undefined) {
                live[personId] = entries;
                continue;
            }
            let firstLive = entries.length;
            while (firstLive > 0 && entries[firstLive - 1]!.seq >= floor) {
                firstLive -= 1;
            }
            live[personId] = entries.slice(firstLive);
        }
        return live;
    }

    // Hands back the accumulated entries and RESETS the table to empty, keeping `nextSeq` (task 077 streaming):
    // the offline generator flushes the full log to disk shards periodically so it never holds the whole
    // centuries-long log in RAM. The aggregate history (EventEngine.history) is separate and unaffected, so the
    // sim's hasEvent queries keep working after a drain — the full log is write-only during generation.
    // NOTE (LP-11): callers that drain mid-run (the generator's streaming flush) must only do so when the
    // pending-stamp queue is empty (i.e. right after a stamp pass) — a drain that split a (person, tick)
    // group across stamp batches would give streamed and in-memory runs different minutes. The generator
    // flushes immediately after runTick's phase 10 and stamps the tail explicitly before its final flush.
    drain(): EventLogTable {
        const drained = this.table;
        this.table = {};
        this.pendingStamps = [];
        return drained;
    }

    // Restores the log (save/load). `nextSeq` persists explicitly; when absent (defensive), derive it from
    // the highest stored seq so future commits never collide.
    load(table: EventLogTable, nextSeq?: number): void {
        this.table = table ?? {};
        this.liveFloors = {}; // a loaded log is live-only; re-hydration re-installs the past + floors
        this.pendingStamps = [];
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
