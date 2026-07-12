import SocialGraph, { resolveStanding, pairKey } from 'game/population/SocialGraph';
import { GenPerson, PersonTable } from 'types/Genealogy';
import { Genders } from 'types/Social';

// The elective social graph (task 083 / proposal B1): closed-form decay, the authored kind ladder, hostile
// flips and reconciliation, the derived-standing resolution order, and persistence.

const TPY = 8640;

function gen(id: string, opts: { spouse?: string; fatherId?: string; motherId?: string } = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender: Genders.Female,
        birthTick: -30 * TPY, deathTick: null,
        fatherId: opts.fatherId ?? null, motherId: opts.motherId ?? null,
        partnerships: opts.spouse ? [{ partnerId: opts.spouse, startTick: -2 * TPY, endTick: null }] : [],
    };
}

describe('edges & decay', () => {
    test('adjust creates an acquaintance edge; strength decays closed-form by half-life', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 20, 0);
        expect(graph.edgeBetween('a', 'b', 0)).toEqual({ kind: 'acquaintance', strength: 20 });

        // acquaintance half-life = 120 days = 2880 ticks: exactly half after one half-life.
        const view = graph.edgeBetween('a', 'b', 2880)!;
        expect(view.strength).toBeCloseTo(10, 6);
        // Closed-form: the read at T is identical whether or not intermediate reads happened (K2 rule).
        const graph2 = new SocialGraph();
        graph2.adjust('a', 'b', 20, 0);
        graph2.edgeBetween('a', 'b', 1000);
        graph2.edgeBetween('a', 'b', 2000);
        expect(graph2.edgeBetween('a', 'b', 2880)!.strength).toBeCloseTo(view.strength, 12);
    });

    test('edges below pruneBelow read as gone and are physically pruned on adjust', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 2, 0);
        // 2 → below the 0.25 prune floor after 4 half-lives.
        expect(graph.edgeBetween('a', 'b', 2880 * 4)).toBeNull();
    });

    test('pair key is unordered: a→b and b→a address the same edge', () => {
        const graph = new SocialGraph();
        graph.adjust('b', 'a', 10, 0);
        expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
        expect(graph.edgeBetween('a', 'b', 0)!.strength).toBe(10);
    });
});

describe('the authored ladder', () => {
    test('acquaintance promotes to friend at 30, reporting the made_friend transition event', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 25, 0);
        const result = graph.adjust('a', 'b', 10, 1);
        expect(result.promoted).toEqual({ to: 'friend', onPromote: 'made_friend' });
        expect(graph.edgeBetween('a', 'b', 1)!.kind).toBe('friend');
    });

    test('friend promotes to close_friend at 65', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 40, 0); // promoted to friend at 30
        const result = graph.adjust('a', 'b', 30, 1); // 70 ≥ 65
        expect(result.promoted?.to).toBe('close_friend');
        expect(result.promoted?.onPromote).toBe('became_close_friends');
    });

    test('a faded close_friend reads as a friend (decay demotion), without mutation', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 70, 0); // close_friend
        expect(graph.edgeBetween('a', 'b', 0)!.kind).toBe('close_friend');
        // close_friend half-life = 600 days = 14400 ticks; after ~1.1 half-lives strength ≈ 32 < 35 floor.
        const later = graph.edgeBetween('a', 'b', 16500)!;
        expect(later.strength).toBeLessThan(35);
        expect(later.kind).toBe('friend');
    });
});

describe('hostility & reconciliation', () => {
    test('a friendly edge driven to zero by hostility flips to rival', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 5, 0);
        const result = graph.adjust('a', 'b', -10, 1);
        expect(result.flipped).toBe('rival');
        expect(graph.edgeBetween('a', 'b', 1)).toEqual({ kind: 'rival', strength: 15 });
    });

    test('positive deltas COOL a rivalry; cooled to zero it reconciles to acquaintance', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 5, 0);
        graph.adjust('a', 'b', -10, 1); // rival @ 15
        graph.adjust('a', 'b', 10, 1);  // heat 15 → 5 (same tick: no decay in between)
        expect(graph.edgeBetween('a', 'b', 1)).toEqual({ kind: 'rival', strength: 5 });
        const result = graph.adjust('a', 'b', 10, 1); // cooled through zero
        expect(result.flipped).toBe('acquaintance');
        expect(graph.edgeBetween('a', 'b', 1)).toEqual({ kind: 'acquaintance', strength: 5 });
    });

    test('negative deltas HEAT a rivalry', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 5, 0);
        graph.adjust('a', 'b', -10, 1); // rival @ 15
        graph.adjust('a', 'b', -10, 1); // heat 15 → 25 (same tick: no decay in between)
        expect(graph.edgeBetween('a', 'b', 1)!.strength).toBe(25);
    });
});

describe('explicit kinds, death & persistence', () => {
    test('setKind installs dating; removePerson clears every edge of the deceased', () => {
        const graph = new SocialGraph();
        graph.setKind('a', 'b', 'dating', 0, 40);
        graph.adjust('a', 'c', 10, 0);
        expect(graph.edgeBetween('a', 'b', 0)).toEqual({ kind: 'dating', strength: 40 });
        graph.removePerson('a');
        expect(graph.edgeBetween('a', 'b', 0)).toBeNull();
        expect(graph.edgeBetween('a', 'c', 0)).toBeNull();
    });

    test('serialize/loadState round-trips edges exactly', () => {
        const graph = new SocialGraph();
        graph.adjust('a', 'b', 45, 100);
        graph.setKind('c', 'd', 'ex_partner', 200, 25);
        const restored = new SocialGraph();
        restored.loadState(graph.serialize());
        expect(restored.edgeBetween('a', 'b', 100)).toEqual(graph.edgeBetween('a', 'b', 100));
        expect(restored.edgeBetween('c', 'd', 200)).toEqual({ kind: 'ex_partner', strength: 25 });
    });
});

describe('resolveStanding (the shared resolution rule)', () => {
    const people: PersonTable = {
        wife: gen('wife', { spouse: 'husband' }),
        husband: gen('husband', { spouse: 'wife' }),
        dad: gen('dad'),
        kid: gen('kid', { fatherId: 'dad' }),
        stranger: gen('stranger'),
    };

    test('spouse outranks any edge; edge outranks family; family outranks nothing', () => {
        const graph = new SocialGraph();
        graph.adjust('wife', 'husband', 50, 0);
        expect(resolveStanding(people, graph, 'wife', 'husband', 0)).toEqual({ kind: 'spouse', strength: 50 });
        // No edge but married → derived spouse with the default strength.
        expect(resolveStanding(people, null, 'wife', 'husband', 0)).toEqual({ kind: 'spouse', strength: 75 });
        // Parent/child derive as family.
        expect(resolveStanding(people, graph, 'kid', 'dad', 0)).toEqual({ kind: 'family', strength: 60 });
        // An edge between kin outranks the derived family standing.
        graph.adjust('kid', 'dad', 40, 0);
        expect(resolveStanding(people, graph, 'kid', 'dad', 0)!.kind).toBe('friend');
        // Strangers: nothing.
        expect(resolveStanding(people, graph, 'wife', 'stranger', 0)).toBeNull();
        // Self/unknown: nothing.
        expect(resolveStanding(people, graph, 'wife', 'wife', 0)).toBeNull();
        expect(resolveStanding(people, graph, 'wife', 'ghost', 0)).toBeNull();
    });
});
