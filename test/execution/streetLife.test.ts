import LiveWorld from 'game/execution/LiveWorld';
import Person from 'game/agents/Person';
import Building from 'game/world/Building';
import actionsConfig from 'json/actions.json';
import { ActionManifest } from 'types/Action';

// Street life (task 093 / proposal E1–E2): live-mode OUTSIDE transitions step the person out the door
// (pre-093 they cancelled and every outdoor action blocked), the ambulatory flag drives visible roaming,
// and the outdoor repertoire is authored with proper gates (the skateboard rule).

const ACTIONS = actionsConfig as unknown as ActionManifest;

function fakeBuilding(key: string, entrance: { x: number; y: number } | null = { x: 100, y: 200 }): Building {
    return { getIdentifier: () => key, getEntrance: () => entrance } as unknown as Building;
}

interface FakePersonState {
    building: Building | null;
    indoors: boolean;
    position: { x: number; y: number };
}

function fakePerson(personId: string, home: Building, state: FakePersonState): Person {
    return {
        social: { getPersonId: () => personId, getHome: () => home },
        getCurrentBuilding: () => state.building,
        setCurrentBuilding: (building: Building | null) => { state.building = building; },
        setIndoors: (indoors: boolean) => { state.indoors = indoors; },
        setPosition: (x: number, y: number) => { state.position = { x, y }; },
    } as unknown as Person;
}

describe('stepping outside (E1)', () => {
    test('an OUTSIDE transition resolves immediately: out the door, visible, at the entrance', () => {
        const home = fakeBuilding('1-1');
        const state: FakePersonState = { building: home, indoors: true, position: { x: 0, y: 0 } };
        const person = fakePerson('p1', home, state);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });

        const handle = world.requestTransition('p1', { kind: 'outside' }, 100, null);
        expect(handle.status).toBe('arrived');
        expect(state.building).toBeNull();
        expect(state.indoors).toBe(false);
        expect(state.position).toEqual({ x: 100, y: 200 });
        expect(world.locationOf('p1')).toEqual({ kind: 'outside' });
    });

    test('already outside: arrived with nothing to do', () => {
        const home = fakeBuilding('1-1');
        const state: FakePersonState = { building: null, indoors: false, position: { x: 5, y: 5 } };
        const person = fakePerson('p1', home, state);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });

        const handle = world.requestTransition('p1', { kind: 'outside' }, 100, null);
        expect(handle.status).toBe('arrived');
        expect(state.position).toEqual({ x: 5, y: 5 }); // untouched
    });
});

describe('the ambulatory flag (E1)', () => {
    test('setAmbulatory enables the wander machinery and clears cleanly', () => {
        const person = new Person(0, 0);
        expect(person.isAmbulatory()).toBe(false);
        person.setAmbulatory(true);
        expect(person.isAmbulatory()).toBe(true);
        person.setAmbulatory(false);
        expect(person.isAmbulatory()).toBe(false);
    });
});

describe('the outdoor repertoire (E2)', () => {
    test('the street set is authored: outside, gaited, and properly gated', () => {
        for (const id of ['jogging', 'riding_skateboard', 'cleaning_the_sidewalk', 'evening_stroll', 'street_games', 'window_shopping', 'taking_a_walk_together']) {
            const def = ACTIONS[id]!;
            expect(def.location).toBe('outside');
            expect(def.type).toBe('continuous');
        }
        // The skateboard rule (the brief's example): no board carried, no skating.
        const skate = JSON.stringify(ACTIONS['riding_skateboard']!.requirements);
        expect(skate).toContain('skateboard');
        // Sidewalk cleaning needs the broom; street games are for children.
        expect(JSON.stringify(ACTIONS['cleaning_the_sidewalk']!.requirements)).toContain('broom');
        expect(JSON.stringify(ACTIONS['street_games']!.requirements)).toContain('14');
        // The existing walks gained gaits.
        expect(ACTIONS['taking_a_walk']!.ambulatory).toBe('stroll');
        expect(ACTIONS['jogging']!.ambulatory).toBe('jog');
    });
});
