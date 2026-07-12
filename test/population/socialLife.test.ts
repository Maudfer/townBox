import Clock from 'game/Clock';
import Person from 'game/agents/Person';
import SocialLife from 'game/population/SocialLife';
import House from 'game/world/House';
import { Genders, Relationships } from 'types/Social';

// SocialLife holds a person's identity/relationships/home and derives age either from a live shared Clock
// (genealogy-backed people) or from a stored fallback (manually created/test people, task per §4.8). It
// never touches its Person references beyond identity comparison, so plain fake objects stand in for them
// (mirrors the pattern in test/execution/executionBoundary.test.ts).

function fakePerson(id: string): Person {
    return { id } as unknown as Person;
}

function fakeHouse(key: string): House {
    return { getIdentifier: () => key } as unknown as House;
}

describe('SocialLife — identity & home', () => {
    test('starts with sensible empty defaults', () => {
        const social = new SocialLife();
        expect(social.getFullName()).toBe(' ');
        expect(social.getHome()).toBeNull();
        expect(social.getPersonId()).toBeNull();
        expect(social.getBirthTick()).toBeNull();
        expect(social.getGender()).toBe(Genders.Male);
        expect(social.getInfo()).toEqual({
            firstName: '',
            familyName: '',
            age: -1,
            gender: Genders.Male,
            relationships: {},
        });
    });

    test('setters round-trip through their getters', () => {
        const social = new SocialLife();
        social.setFirstName('Ada');
        social.setFamilyName('Lovelace');
        social.setGender(Genders.Female);
        social.setAge(34);
        social.setBirthTick(1200);
        social.setPersonId('pool-1');

        expect(social.getFullName()).toBe('Ada Lovelace');
        expect(social.getGender()).toBe(Genders.Female);
        expect(social.getBirthTick()).toBe(1200);
        expect(social.getPersonId()).toBe('pool-1');
        expect(social.getInfo().age).toBe(34);

        const house = fakeHouse('3-4');
        social.setHome(house);
        expect(social.getHome()).toBe(house);
        social.setHome(null);
        expect(social.getHome()).toBeNull();
    });
});

describe('SocialLife — relationships', () => {
    test('single-value relationships (father/mother/spouse) overwrite on repeated add', () => {
        const social = new SocialLife();
        const dad = fakePerson('dad');
        const stepDad = fakePerson('stepdad');

        expect(social.hasRelationship(Relationships.Father)).toBe(false);
        social.addRelationship(Relationships.Father, dad);
        expect(social.hasRelationship(Relationships.Father)).toBe(true);
        expect(social.hasRelationshipWith(Relationships.Father, dad)).toBe(true);
        expect(social.queryRelationship(Relationships.Father)).toBe(dad);

        // Re-adding overwrites rather than accumulating (single-value semantics).
        social.addRelationship(Relationships.Father, stepDad);
        expect(social.queryRelationship(Relationships.Father)).toBe(stepDad);
        expect(social.hasRelationshipWith(Relationships.Father, dad)).toBe(false);
    });

    test('array relationships (sibling) accumulate without duplicates', () => {
        const social = new SocialLife();
        const sib1 = fakePerson('sib1');
        const sib2 = fakePerson('sib2');

        social.addRelationship(Relationships.Sibling, sib1);
        social.addRelationship(Relationships.Sibling, sib2);
        social.addRelationship(Relationships.Sibling, sib1); // duplicate, ignored

        const siblings = social.queryRelationship(Relationships.Sibling) as Person[];
        expect(siblings).toHaveLength(2);
        expect(siblings).toEqual([sib1, sib2]);
        expect(social.hasRelationshipWith(Relationships.Sibling, sib1)).toBe(true);
        expect(social.hasRelationshipWith(Relationships.Sibling, fakePerson('stranger'))).toBe(false);
    });

    test('queryRelationship returns null for an unset relationship', () => {
        const social = new SocialLife();
        expect(social.queryRelationship(Relationships.Spouse)).toBeNull();
    });

    test('removeRelationship deletes a single-value relationship only when it matches', () => {
        const social = new SocialLife();
        const mom = fakePerson('mom');
        const other = fakePerson('other');
        social.addRelationship(Relationships.Mother, mom);

        // A non-matching removal is a no-op.
        social.removeRelationship(Relationships.Mother, other);
        expect(social.hasRelationship(Relationships.Mother)).toBe(true);

        social.removeRelationship(Relationships.Mother, mom);
        expect(social.hasRelationship(Relationships.Mother)).toBe(false);
        expect(social.queryRelationship(Relationships.Mother)).toBeNull();
    });

    test('removeRelationship splices a matching entry out of an array relationship', () => {
        const social = new SocialLife();
        const sib1 = fakePerson('sib1');
        const sib2 = fakePerson('sib2');
        social.addRelationship(Relationships.Sibling, sib1);
        social.addRelationship(Relationships.Sibling, sib2);

        // Removing someone never added is a no-op (index === -1 branch).
        social.removeRelationship(Relationships.Sibling, fakePerson('stranger'));
        expect(social.queryRelationship(Relationships.Sibling)).toHaveLength(2);

        social.removeRelationship(Relationships.Sibling, sib1);
        const remaining = social.queryRelationship(Relationships.Sibling) as Person[];
        expect(remaining).toEqual([sib2]);
    });

    test('getParents collects only the relationships that are set', () => {
        const social = new SocialLife();
        expect(social.getParents()).toEqual([]);

        const dad = fakePerson('dad');
        social.addRelationship(Relationships.Father, dad);
        expect(social.getParents()).toEqual([dad]);

        const mom = fakePerson('mom');
        social.addRelationship(Relationships.Mother, mom);
        expect(social.getParents()).toEqual([dad, mom]);
    });
});

describe('SocialLife — age derivation', () => {
    afterEach(() => {
        SocialLife.setClock(null);
    });

    test('falls back to the stored age when no clock is set', () => {
        const social = new SocialLife();
        social.setAge(42);
        expect(social.getAge()).toBe(42);
    });

    test('falls back to the stored age when birthTick is null even with a clock set', () => {
        const clock = new Clock();
        SocialLife.setClock(clock);
        const social = new SocialLife();
        social.setAge(7);
        expect(social.getBirthTick()).toBeNull();
        expect(social.getAge()).toBe(7);
    });

    test('derives age live from the shared clock once birthTick is known', () => {
        const clock = new Clock();
        SocialLife.setClock(clock);
        const social = new SocialLife();

        const ticksPerYear = clock.getTicksPerYear();
        social.setBirthTick(clock.getCurrentTick() - 5 * ticksPerYear);
        expect(social.getAge()).toBe(5);

        // Age tracks the clock as it advances (task 4.8: "age tracks the in-game clock").
        clock.advance(3 * ticksPerYear * 150_000); // 150s of real time per hour-tick in this project's saves
        expect(social.getAge()).toBeGreaterThanOrEqual(5);
    });

    test('clamps to zero for a birthTick in the future relative to the clock', () => {
        const clock = new Clock();
        SocialLife.setClock(clock);
        const social = new SocialLife();
        social.setBirthTick(clock.getCurrentTick() + 10 * clock.getTicksPerYear());
        expect(social.getAge()).toBe(0);
    });
});
