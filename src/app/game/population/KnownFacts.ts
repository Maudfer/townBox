// The known-facts store (task 104 / proposal O1): what each person knows about the others' notable moments.
// Bounded (FIFO cap), deduplicated by the referenced commit, and decaying — reads lazily filter facts past
// the memory window, so old gossip genuinely fades without a sweep. Deterministic, RNG-free.

import { PersonId } from 'types/Genealogy';
import { KnownFact, KnownFactsAccess, KnownFactsState } from 'types/Reputation';

export const FACT_CAP = 20;
export const FACT_MEMORY_TICKS = 90 * 24; // ~3 months, then the town forgives

export default class KnownFacts implements KnownFactsAccess {
    private state: KnownFactsState;

    constructor() {
        this.state = { people: {} };
    }

    learn(observerId: PersonId, fact: KnownFact): void {
        const facts = this.state.people[observerId] ?? [];
        if (facts.some(known => known.aboutId === fact.aboutId && known.seq === fact.seq)) {
            return; // already knows this one
        }
        facts.push({ ...fact });
        while (facts.length > FACT_CAP) {
            facts.shift(); // FIFO: the oldest story makes room
        }
        this.state.people[observerId] = facts;
    }

    factsOf(observerId: PersonId, tick: number): KnownFact[] {
        return (this.state.people[observerId] ?? []).filter(fact => tick - fact.learnedAtTick < FACT_MEMORY_TICKS);
    }

    negativeCountAbout(observerId: PersonId, aboutId: PersonId, tick: number): number {
        return this.factsOf(observerId, tick).filter(fact => fact.aboutId === aboutId && fact.valence < 0).length;
    }

    removePerson(personId: PersonId): void {
        delete this.state.people[personId];
        for (const facts of Object.values(this.state.people)) {
            // Facts about the departed stay — the town remembers the dead — but nothing new accrues.
            void facts;
        }
    }

    serialize(): KnownFactsState {
        return { people: Object.fromEntries(Object.entries(this.state.people).map(([id, facts]) => [id, facts.map(fact => ({ ...fact }))])) };
    }

    loadState(state: KnownFactsState | undefined): void {
        this.state = { people: {} };
        for (const [id, facts] of Object.entries(state?.people ?? {})) {
            this.state.people[id] = facts.map(fact => ({ ...fact }));
        }
    }
}
