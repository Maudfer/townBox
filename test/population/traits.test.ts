import { consentProbability } from 'game/actions/Consent';
import Traits, { TRAITS_CONFIG, traitConsentShift } from 'game/population/Traits';
import { GenPerson, PersonTable } from 'types/Genealogy';
import { TRAIT_IDS } from 'types/Traits';
import { Genders } from 'types/Social';

// Traits & temperament (task 087 / proposal M): derived-never-stored axes, one-generation heritability,
// affinity selection multipliers, consent shifts, and the inspector prose.

const TPY = 8640;

function gen(id: string, fatherId: string | null = null, motherId: string | null = null): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId, motherId, partnerships: [] };
}

function service(people: PersonTable, worldSeed = 42): Traits {
    return new Traits(() => ({ worldSeed, people }));
}

describe('derivation (M1)', () => {
    test('deterministic per (worldSeed, personId); every axis in [0, 100]; no serialization needed', () => {
        const people = { p1: gen('p1') };
        const a = service(people).traitsOf('p1');
        const b = service(people).traitsOf('p1');
        expect(a).toEqual(b);
        for (const trait of TRAIT_IDS) {
            expect(a[trait]).toBeGreaterThanOrEqual(0);
            expect(a[trait]).toBeLessThanOrEqual(100);
        }
        expect(service(people, 43).traitsOf('p1')).not.toEqual(a); // the seed matters
    });

    test('heritability: a child leans toward the parents; unrelated people do not', () => {
        const people: PersonTable = {
            dad: gen('dad'), mom: gen('mom'),
            kid: gen('kid', 'dad', 'mom'),
            orphanTwin: gen('kid'), // same id, no parents → the pure base roll
        };
        const traits = service(people);
        const kid = traits.traitsOf('kid');
        // Reconstruct the expected blend: parents' base average × h + own base × (1−h).
        const own = service({ kid: gen('kid') }).traitsOf('kid');
        const dadBase = service({ dad: gen('dad') }).traitsOf('dad');
        const momBase = service({ mom: gen('mom') }).traitsOf('mom');
        const h = TRAITS_CONFIG.heritability;
        for (const trait of TRAIT_IDS) {
            const expected = ((dadBase[trait] + momBase[trait]) / 2) * h + own[trait] * (1 - h);
            expect(kid[trait]).toBeCloseTo(expected, 9);
        }
    });
});

describe('integration seams (M2)', () => {
    test('affinity multipliers scale with the axis and stay within the authored range', () => {
        const people = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`p${i}`, gen(`p${i}`)]));
        const traits = service(people);
        // Find a highly-social and a lowly-social person; the 'social' tag must order their multipliers.
        const ids = Object.keys(people);
        const high = ids.reduce((top, id) => traits.traitsOf(id).sociability > traits.traitsOf(top).sociability ? id : top);
        const low = ids.reduce((bottom, id) => traits.traitsOf(id).sociability < traits.traitsOf(bottom).sociability ? id : bottom);
        expect(traits.affinityMultiplier(high, ['social'])).toBeGreaterThan(traits.affinityMultiplier(low, ['social']));
        // Negative-weight tags invert: the solitary tag favors the low-sociability person.
        expect(traits.affinityMultiplier(low, ['solitary'])).toBeGreaterThan(traits.affinityMultiplier(high, ['solitary']));
        // Unknown tags are inert; empty affinity is exactly 1.
        expect(traits.affinityMultiplier(high, ['no_such_tag'])).toBe(1);
        expect(traits.affinityMultiplier(high, undefined)).toBe(1);
    });

    test('consent shifts by the TARGET temperament: sociable up, hot-tempered down', () => {
        const sociable = { sociability: 100, industriousness: 50, temper: 0, riskAppetite: 50, orderliness: 50, hedonism: 50 };
        const grumpy = { sociability: 0, industriousness: 50, temper: 100, riskAppetite: 50, orderliness: 50, hedonism: 50 };
        expect(traitConsentShift(sociable)).toBeGreaterThan(traitConsentShift(grumpy));
        const base = { actionId: 'hugged_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 0, worldSeed: 1 };
        expect(consentProbability({ ...base, targetTraits: sociable })).toBeGreaterThan(consentProbability({ ...base, targetTraits: grumpy }));
    });

    test('inspector prose names only the axes past their bands (M3)', () => {
        const people = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, gen(`p${i}`)]));
        const traits = service(people);
        for (const id of Object.keys(people)) {
            const description = traits.describe(id);
            const values = traits.traitsOf(id);
            const extremes = TRAIT_IDS.filter(trait => values[trait] <= 25 || values[trait] >= 75).length;
            expect(description.split(', ').filter(Boolean)).toHaveLength(description ? extremes : 0);
        }
    });
});
