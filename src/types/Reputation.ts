// Reputation & gossip (task 104 / proposal O): a per-person, capacity-capped memory of REFERENCES to other
// people's notable log entries — witnessed directly (C4) or heard through gossip (O2). Deliberately NOT a
// beliefs/deception system (the O4 restraint clause): facts point at real commits, are bounded (FIFO cap),
// and decay (the town forgives, slowly). Serialized (v16 family).

import { PersonId } from 'types/Genealogy';

export interface KnownFact {
    aboutId: PersonId;
    seq: number; // the log entry this fact references — ground truth, never a fabrication
    eventId: string;
    valence: number; // the referenced event's authored valence (juiciness = |valence| × recency)
    learnedAtTick: number;
    viaWitness: boolean; // saw it happen vs heard it around
}

export interface KnownFactsState {
    people: Record<PersonId, KnownFact[]>;
}

// The surface engines consult through SimulationMarkets.knownFacts.
export interface KnownFactsAccess {
    learn(observerId: PersonId, fact: KnownFact): void;
    factsOf(observerId: PersonId, tick: number): KnownFact[];
    negativeCountAbout(observerId: PersonId, aboutId: PersonId, tick: number): number;
}
