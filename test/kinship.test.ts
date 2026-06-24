import {
    parentsOf,
    childrenOf,
    siblingsOf,
    grandparentsOf,
    grandchildrenOf,
    unclesAuntsOf,
    nephewsNiecesOf,
    cousinsOf,
    isAliveAt,
    ageAt,
    spouseAt,
    relationshipLabel,
} from '../src/util/kinship';
import { GenPerson, PersonTable, Partnership } from '../src/types/Genealogy';
import { Genders, Relationships } from '../src/types/Social';

const TICKS_PER_YEAR = 10;

function person(overrides: Partial<GenPerson> & Pick<GenPerson, 'id' | 'gender'>): GenPerson {
    return {
        firstName: overrides.id,
        familyName: 'Test',
        birthTick: 0,
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
        ...overrides,
    };
}

function partnership(partnerId: string, startTick: number, endTick: number | null = null): Partnership {
    return { partnerId, startTick, endTick };
}

// Three-generation fixture plus two unrelated roommates.
//
//   gf ── gm            (grandparents)
//     │
//   ┌─┴───┐
//   pa ── sc   ab       (pa & ab are siblings; pa married sc)
//     │        │
//   ┌─┴──┐     │
//  older minor cousin   (older & minor are siblings; cousin is ab's child)
//
//   r1   r2             (unrelated — roommates)
function buildPool(): PersonTable {
    const people: GenPerson[] = [
        person({ id: 'gf', gender: Genders.Male, birthTick: 0, deathTick: 700 }),
        person({ id: 'gm', gender: Genders.Female, birthTick: 20, deathTick: 720 }),
        person({ id: 'pa', gender: Genders.Male, birthTick: 250, deathTick: 600, fatherId: 'gf', motherId: 'gm', partnerships: [partnership('sc', 460)] }),
        person({ id: 'ab', gender: Genders.Female, birthTick: 270, fatherId: 'gf', motherId: 'gm' }),
        person({ id: 'sc', gender: Genders.Female, birthTick: 260, deathTick: 600, partnerships: [partnership('pa', 460)] }),
        person({ id: 'older', gender: Genders.Male, birthTick: 470, fatherId: 'pa', motherId: 'sc' }),
        person({ id: 'minor', gender: Genders.Male, birthTick: 590, fatherId: 'pa', motherId: 'sc' }),
        person({ id: 'cousin', gender: Genders.Female, birthTick: 480, motherId: 'ab' }),
        person({ id: 'r1', gender: Genders.Female, birthTick: 500 }),
        person({ id: 'r2', gender: Genders.Male, birthTick: 505 }),
    ];

    const pool: PersonTable = {};
    for (const p of people) {
        pool[p.id] = p;
    }
    return pool;
}

const pool = buildPool();
const at = (id: string): GenPerson => pool[id]!;

describe('primary edges', () => {
    test('parentsOf resolves both parents that exist', () => {
        expect(parentsOf(pool, 'minor').sort()).toEqual(['pa', 'sc']);
        expect(parentsOf(pool, 'cousin')).toEqual(['ab']); // only mother set
        expect(parentsOf(pool, 'r1')).toEqual([]);
    });

    test('childrenOf finds all children', () => {
        expect(childrenOf(pool, 'pa').sort()).toEqual(['minor', 'older']);
        expect(childrenOf(pool, 'ab')).toEqual(['cousin']);
        expect(childrenOf(pool, 'r1')).toEqual([]);
    });
});

describe('derived kinship', () => {
    test('siblings share at least one parent and exclude self', () => {
        expect(siblingsOf(pool, 'minor')).toEqual(['older']);
        expect(siblingsOf(pool, 'pa')).toEqual(['ab']);
        expect(siblingsOf(pool, 'r1')).toEqual([]);
    });

    test('grandparents and grandchildren', () => {
        expect(grandparentsOf(pool, 'minor').sort()).toEqual(['gf', 'gm']);
        expect(grandchildrenOf(pool, 'gf').sort()).toEqual(['cousin', 'minor', 'older']);
    });

    test('uncles/aunts and nephews/nieces', () => {
        expect(unclesAuntsOf(pool, 'minor')).toEqual(['ab']);
        expect(nephewsNiecesOf(pool, 'pa')).toEqual(['cousin']);
    });

    test('cousins are children of uncles/aunts', () => {
        expect(cousinsOf(pool, 'minor')).toEqual(['cousin']);
        expect(cousinsOf(pool, 'cousin').sort()).toEqual(['minor', 'older']);
    });
});

describe('life state', () => {
    test('isAliveAt covers before-birth, alive, and after-death', () => {
        expect(isAliveAt(at('pa'), 200)).toBe(false); // before birth (250)
        expect(isAliveAt(at('pa'), 590)).toBe(true);
        expect(isAliveAt(at('pa'), 600)).toBe(false); // death is exclusive
        expect(isAliveAt(at('ab'), 100000)).toBe(true); // never dies
    });

    test('ageAt derives whole years from birthTick', () => {
        expect(ageAt(at('minor'), 650, TICKS_PER_YEAR)).toBe(6);
        expect(ageAt(at('minor'), 590, TICKS_PER_YEAR)).toBe(0);
        expect(ageAt(at('minor'), 500, TICKS_PER_YEAR)).toBe(0); // never negative
    });

    test('spouseAt returns the ongoing partner at a tick', () => {
        expect(spouseAt(pool, 'pa', 500)).toBe('sc');
        expect(spouseAt(pool, 'pa', 100)).toBeNull(); // before the partnership started
        expect(spouseAt(pool, 'r1', 500)).toBeNull();
    });
});

describe('scenario expressibility (task acceptance criteria)', () => {
    test('child living with adult sibling because parents are deceased', () => {
        const T = 650;

        // Both parents are dead at T...
        const parents = parentsOf(pool, 'minor');
        expect(parents.sort()).toEqual(['pa', 'sc']);
        expect(parents.every(id => !isAliveAt(at(id), T))).toBe(true);

        // ...while the minor and an adult sibling are alive.
        expect(isAliveAt(at('minor'), T)).toBe(true);
        expect(ageAt(at('minor'), T, TICKS_PER_YEAR)).toBeLessThan(18);

        const adultSiblings = siblingsOf(pool, 'minor').filter(
            id => isAliveAt(at(id), T) && ageAt(at(id), T, TICKS_PER_YEAR) >= 18
        );
        expect(adultSiblings).toEqual(['older']);
    });

    test('roommates: co-residents with no blood/marriage tie', () => {
        expect(parentsOf(pool, 'r1')).toEqual([]);
        expect(siblingsOf(pool, 'r1')).toEqual([]);
        expect(spouseAt(pool, 'r1', 600)).toBeNull();
        expect(relationshipLabel(pool, 'r1', 'r2')).toBeNull();
    });
});

describe('relationshipLabel', () => {
    test('labels first-degree relations gender-aware', () => {
        expect(relationshipLabel(pool, 'minor', 'pa')).toBe(Relationships.Father);
        expect(relationshipLabel(pool, 'minor', 'gm')).toBe(Relationships.Grandmother);
        expect(relationshipLabel(pool, 'minor', 'ab')).toBe(Relationships.Aunt);
        expect(relationshipLabel(pool, 'minor', 'older')).toBe(Relationships.Sibling);
        expect(relationshipLabel(pool, 'pa', 'cousin')).toBe(Relationships.Niece);
        expect(relationshipLabel(pool, 'pa', 'minor')).toBe(Relationships.Child);
        expect(relationshipLabel(pool, 'pa', 'sc')).toBe(Relationships.Spouse);
    });

    test('returns null for cousins and self', () => {
        expect(relationshipLabel(pool, 'minor', 'cousin')).toBeNull();
        expect(relationshipLabel(pool, 'minor', 'minor')).toBeNull();
    });
});
