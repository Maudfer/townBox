// Reactive Brain wakeups (LP-12 / proposal simulation-aliveness-2 M2, task 133). The Brain evaluates on
// the hourly flip; world mutations that happen BETWEEN flips — a business opening under the player's
// cursor, a closure, a bulldozed home — used to go unnoticed for up to an hour, and data cooldowns
// (job_hunting's 24 ticks, the 2-day job_seeking routine) stretched that into days. A wake enqueues the
// affected people; City drains the queue on the next minute boundary, clears the wake kind's matching
// cooldown class (so the re-evaluation can actually choose the thing that changed), and runs a bounded
// Brain pass for the woken people only.
//
// Determinism: player mutations are already non-deterministic inputs to the sim; a wake pass is
// deterministic GIVEN the mutation (Brain hooks fork their usual per-(tick, person) streams). Bootstrap
// and the generator simply never enqueue — wakes are an input channel, not a mode branch. The queue is
// transient (not serialized): a wake pending across a save is re-derived by the next flip anyway.

import { PersonId } from 'types/Genealogy';

export type WakeKind = 'businessOpened' | 'businessClosed' | 'homeLost';

// Which action recencies a wake clears (the cooldown class): clearing job_hunting reopens both the
// action's own selection cooldown and the job_seeking routine's cadence read (both read the same
// aggregate). Kept in code while the vocabulary is small; the wake-trigger catalogue's data-driven form
// (json/arbitration vocabulary) comes with the later content passes.
export const WAKE_CLEARS: Record<WakeKind, string[]> = {
    businessOpened: ['job_hunting'],
    businessClosed: ['job_hunting'],
    homeLost: [],
};

export interface WakeRecord {
    kind: WakeKind;
    // Explicit ids captured at enqueue time (e.g. the closed business's employees), or null for
    // scope-resolved-at-drain kinds (businessOpened → the currently unemployed adults).
    personIds: PersonId[] | null;
}

export default class BrainWakeQueue {
    private queue: WakeRecord[] = [];

    enqueue(kind: WakeKind, personIds: PersonId[] | null = null): void {
        this.queue.push({ kind, personIds });
    }

    hasPending(): boolean {
        return this.queue.length > 0;
    }

    drain(): WakeRecord[] {
        const drained = this.queue;
        this.queue = [];
        return drained;
    }
}
