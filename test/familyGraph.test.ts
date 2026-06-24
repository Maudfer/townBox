import { buildGenealogyTree } from '../src/util/familyGraph';
import { GenPerson, PersonTable } from '../src/types/Genealogy';
import { Node } from '../src/types/FamilyTree';
import { Genders, Gender, Relationships } from '../src/types/Social';

const NOW = 0;
const TPY = 360;

function person(id: string, gender: Gender, ageYears: number, extra: Partial<GenPerson> = {}): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fam',
        gender,
        birthTick: NOW - ageYears * TPY,
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
        ...extra,
    };
}

// Deceased grandparents -> a parent couple -> two children (the subject household).
function buildPool(): PersonTable {
    const people = [
        person('gpa', Genders.Male, 80, { deathTick: NOW - 100 }),
        person('gma', Genders.Female, 78, { deathTick: NOW - 50 }),
        person('dad', Genders.Male, 40, { fatherId: 'gpa', motherId: 'gma', partnerships: [{ partnerId: 'mom', startTick: NOW - 15 * TPY, endTick: null }] }),
        person('mom', Genders.Female, 38, { partnerships: [{ partnerId: 'dad', startTick: NOW - 15 * TPY, endTick: null }] }),
        person('kidA', Genders.Male, 10, { fatherId: 'dad', motherId: 'mom' }),
        person('kidB', Genders.Female, 8, { fatherId: 'dad', motherId: 'mom' }),
    ];
    const pool: PersonTable = {};
    for (const p of people) {
        pool[p.id] = p;
    }
    return pool;
}

const byName = (nodes: Node[], name: string): Node | undefined => nodes.find(n => n.name === name);

describe('buildGenealogyTree', () => {
    const pool = buildPool();
    const placed = new Set(['dad', 'mom', 'kidA', 'kidB']);

    test('spans beyond the household to include deceased ancestors', () => {
        const tree = buildGenealogyTree(pool, ['kidA', 'kidB'], NOW, placed, 2);
        const names = tree.nodes.map(n => n.name.replace(' †', ''));
        expect(names).toEqual(expect.arrayContaining(['kidA', 'kidB', 'dad', 'mom', 'gpa', 'gma']));
    });

    test('flags alive / placed / subject correctly', () => {
        const tree = buildGenealogyTree(pool, ['kidA', 'kidB'], NOW, placed, 2);

        expect(byName(tree.nodes, 'kidA')!.isSubject).toBe(true);
        expect(byName(tree.nodes, 'gpa')!.isSubject).toBeFalsy();

        expect(byName(tree.nodes, 'gpa')!.alive).toBe(false); // deceased ancestor
        expect(byName(tree.nodes, 'dad')!.alive).toBe(true);

        expect(byName(tree.nodes, 'dad')!.placed).toBe(true);
        expect(byName(tree.nodes, 'gpa')!.placed).toBe(false); // dead, never housed
    });

    test('emits parent and spouse links, spouse de-duplicated', () => {
        const tree = buildGenealogyTree(pool, ['kidA', 'kidB'], NOW, placed, 2);
        const spouseLinks = tree.links.filter(l => l.label === Relationships.Spouse);
        expect(spouseLinks).toHaveLength(1); // dad<->mom once
        // kidA has a father link to dad.
        const idxOf = (name: string) => tree.nodes.findIndex(n => n.name.replace(' †', '') === name);
        const fatherLinks = tree.links.filter(l => l.label === Relationships.Father);
        expect(fatherLinks.some(l => l.source === idxOf('kidA') && l.target === idxOf('dad'))).toBe(true);
    });

    test('respects the depth bound', () => {
        // Depth 1 from the kids reaches parents/siblings but not grandparents.
        const tree = buildGenealogyTree(pool, ['kidA'], NOW, placed, 1);
        const names = tree.nodes.map(n => n.name.replace(' †', ''));
        expect(names).toEqual(expect.arrayContaining(['kidA', 'dad', 'mom', 'kidB']));
        expect(names).not.toContain('gpa');
        expect(names).not.toContain('gma');
    });
});
