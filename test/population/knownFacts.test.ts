import KnownFacts, { FACT_CAP, FACT_MEMORY_TICKS } from 'game/population/KnownFacts';
import { consentProbability } from 'game/actions/Consent';
import { KnownFact } from 'types/Reputation';

// Reputation & gossip (task 104 / proposal O): the bounded, decaying known-facts memory (O1), and the one
// restrained reputation read (O3) — consent gets harder for someone the target remembers badly.

function fact(aboutId: string, seq: number, valence: number, learnedAtTick = 0): KnownFact {
    return { aboutId, seq, eventId: 'test_event', valence, learnedAtTick, viaWitness: true };
}

describe('the memory (O1)', () => {
    test('learn/dedup/cap/decay/round-trip', () => {
        const facts = new KnownFacts();
        facts.learn('a', fact('b', 1, -2));
        facts.learn('a', fact('b', 1, -2)); // dedup by (about, seq)
        expect(facts.factsOf('a', 10)).toHaveLength(1);

        // FIFO cap: the oldest story makes room.
        for (let seq = 2; seq <= FACT_CAP + 5; seq++) {
            facts.learn('a', fact('c', seq, 1));
        }
        expect(facts.factsOf('a', 10)).toHaveLength(FACT_CAP);
        expect(facts.factsOf('a', 10).some(known => known.seq === 1)).toBe(false); // the first fell off

        // Decay: past the memory window the town forgives.
        expect(facts.factsOf('a', FACT_MEMORY_TICKS + 1)).toHaveLength(0);

        const restored = new KnownFacts();
        restored.loadState(facts.serialize());
        expect(restored.factsOf('a', 10)).toHaveLength(FACT_CAP);
        restored.removePerson('a');
        expect(restored.factsOf('a', 10)).toHaveLength(0);
        expect(facts.factsOf('a', 10)).toHaveLength(FACT_CAP); // deep copy
        restored.loadState(undefined);
        expect(restored.factsOf('a', 10)).toEqual([]);
    });

    test('negativeCountAbout counts only remembered negative facts about that person', () => {
        const facts = new KnownFacts();
        facts.learn('a', fact('b', 1, -2));
        facts.learn('a', fact('b', 2, 2));
        facts.learn('a', fact('c', 3, -1));
        expect(facts.negativeCountAbout('a', 'b', 10)).toBe(1);
        expect(facts.negativeCountAbout('a', 'c', 10)).toBe(1);
        expect(facts.negativeCountAbout('a', 'b', FACT_MEMORY_TICKS + 1)).toBe(0); // forgiven
    });
});

describe('the reputation read (O3)', () => {
    test('what the target remembers makes a yes harder — capped, never a ban', () => {
        const base = { actionId: 'hugged_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 0, worldSeed: 1 };
        const clean = consentProbability(base);
        const oneStory = consentProbability({ ...base, targetKnowsNegative: 1 });
        const infamous = consentProbability({ ...base, targetKnowsNegative: 10 });
        expect(oneStory).toBeLessThan(clean);
        expect(infamous).toBeLessThan(oneStory);
        expect(infamous).toBeCloseTo(clean - 0.12, 6); // the cap: three stories' worth, no more
        expect(infamous).toBeGreaterThan(0); // dented, never damned
    });
});
