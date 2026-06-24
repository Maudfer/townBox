import { PersonId, GenPerson, PersonTable } from 'types/Genealogy';
import { Relationship, Relationships, Genders } from 'types/Social';

// Pure derivation of kinship and life state from a genealogy PersonTable. These replace the stateful,
// scene-coupled passes in the old Family.assignExtendedRelationships(): every relation here is a
// deterministic function of the stored parent/partnership edges, so it is directly unit-testable with a
// plain fixture pool (no Phaser, no RNG).
//
// Note on performance: childrenOf() scans the table, so chained queries are O(n) per call. Pools are
// small in tests and early gameplay; a precomputed child index can be added later if profiling warrants
// it (the call sites would pass it through unchanged in spirit).

function get(pool: PersonTable, id: PersonId): GenPerson | null {
    return pool[id] ?? null;
}

function unique(ids: PersonId[]): PersonId[] {
    return [...new Set(ids)];
}

// --- Primary edges ---------------------------------------------------------

export function parentsOf(pool: PersonTable, id: PersonId): PersonId[] {
    const person = get(pool, id);
    if (!person) {
        return [];
    }
    const parents: PersonId[] = [];
    if (person.fatherId && pool[person.fatherId]) {
        parents.push(person.fatherId);
    }
    if (person.motherId && pool[person.motherId]) {
        parents.push(person.motherId);
    }
    return parents;
}

export function childrenOf(pool: PersonTable, id: PersonId): PersonId[] {
    const children: PersonId[] = [];
    for (const person of Object.values(pool)) {
        if (person.fatherId === id || person.motherId === id) {
            children.push(person.id);
        }
    }
    return children;
}

// --- Derived kinship -------------------------------------------------------

// Shares at least one parent with the subject; excludes the subject itself.
export function siblingsOf(pool: PersonTable, id: PersonId): PersonId[] {
    const parents = parentsOf(pool, id);
    const siblings: PersonId[] = [];
    for (const parent of parents) {
        for (const child of childrenOf(pool, parent)) {
            if (child !== id) {
                siblings.push(child);
            }
        }
    }
    return unique(siblings);
}

export function grandparentsOf(pool: PersonTable, id: PersonId): PersonId[] {
    const grandparents: PersonId[] = [];
    for (const parent of parentsOf(pool, id)) {
        grandparents.push(...parentsOf(pool, parent));
    }
    return unique(grandparents);
}

export function grandchildrenOf(pool: PersonTable, id: PersonId): PersonId[] {
    const grandchildren: PersonId[] = [];
    for (const child of childrenOf(pool, id)) {
        grandchildren.push(...childrenOf(pool, child));
    }
    return unique(grandchildren);
}

// Siblings of the subject's parents.
export function unclesAuntsOf(pool: PersonTable, id: PersonId): PersonId[] {
    const result: PersonId[] = [];
    for (const parent of parentsOf(pool, id)) {
        result.push(...siblingsOf(pool, parent));
    }
    return unique(result);
}

// Children of the subject's siblings.
export function nephewsNiecesOf(pool: PersonTable, id: PersonId): PersonId[] {
    const result: PersonId[] = [];
    for (const sibling of siblingsOf(pool, id)) {
        result.push(...childrenOf(pool, sibling));
    }
    return unique(result);
}

// Children of the subject's uncles/aunts.
export function cousinsOf(pool: PersonTable, id: PersonId): PersonId[] {
    const result: PersonId[] = [];
    for (const uncleAunt of unclesAuntsOf(pool, id)) {
        result.push(...childrenOf(pool, uncleAunt));
    }
    return unique(result);
}

// --- Life state ------------------------------------------------------------

// Alive at `tick` means already born and not yet dead. deathTick is exclusive (you are dead from the tick
// of death onward).
export function isAliveAt(person: GenPerson, tick: number): boolean {
    if (tick < person.birthTick) {
        return false;
    }
    return person.deathTick === null || tick < person.deathTick;
}

// Age in whole years at `tick`. ticksPerYear keeps this independent of the (not-yet-built) clock's
// calendar granularity; callers supply the conversion.
export function ageAt(person: GenPerson, tick: number, ticksPerYear: number): number {
    if (ticksPerYear <= 0) {
        return 0;
    }
    return Math.max(0, Math.floor((tick - person.birthTick) / ticksPerYear));
}

// The partner the person is in a partnership with at `tick` (ongoing at that tick), or null.
export function spouseAt(pool: PersonTable, id: PersonId, tick: number): PersonId | null {
    const person = get(pool, id);
    if (!person) {
        return null;
    }
    for (const partnership of person.partnerships) {
        const started = partnership.startTick <= tick;
        const ongoing = partnership.endTick === null || tick < partnership.endTick;
        if (started && ongoing && pool[partnership.partnerId]) {
            return partnership.partnerId;
        }
    }
    return null;
}

// --- Labeling --------------------------------------------------------------

// How `other` relates to `subject` (i.e. "other is subject's ___"), gender-aware, for family-tree link
// labels. Returns null when the pair has no first-degree label in the Relationships enum (e.g. cousins).
export function relationshipLabel(pool: PersonTable, subjectId: PersonId, otherId: PersonId): Relationship | null {
    const other = get(pool, otherId);
    if (!other || subjectId === otherId) {
        return null;
    }

    if (parentsOf(pool, subjectId).includes(otherId)) {
        return other.gender === Genders.Male ? Relationships.Father : Relationships.Mother;
    }
    if (childrenOf(pool, subjectId).includes(otherId)) {
        return Relationships.Child;
    }
    if (spousePartnerIds(pool, subjectId).includes(otherId)) {
        return Relationships.Spouse;
    }
    if (siblingsOf(pool, subjectId).includes(otherId)) {
        return Relationships.Sibling;
    }
    if (grandparentsOf(pool, subjectId).includes(otherId)) {
        return other.gender === Genders.Male ? Relationships.Grandfather : Relationships.Grandmother;
    }
    if (grandchildrenOf(pool, subjectId).includes(otherId)) {
        return Relationships.Grandchild;
    }
    if (unclesAuntsOf(pool, subjectId).includes(otherId)) {
        return other.gender === Genders.Male ? Relationships.Uncle : Relationships.Aunt;
    }
    if (nephewsNiecesOf(pool, subjectId).includes(otherId)) {
        return other.gender === Genders.Male ? Relationships.Nephew : Relationships.Niece;
    }
    return null;
}

// Every partner across all partnership episodes (regardless of tick), for labeling.
function spousePartnerIds(pool: PersonTable, id: PersonId): PersonId[] {
    const person = get(pool, id);
    if (!person) {
        return [];
    }
    return person.partnerships.map(partnership => partnership.partnerId).filter(partnerId => !!pool[partnerId]);
}
