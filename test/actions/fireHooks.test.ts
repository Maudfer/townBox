import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import { evacuationHook } from 'game/actions/FireResponse';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import CityIncidents from 'game/economy/CityIncidents';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { WorldAdapter } from 'types/Execution';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// The fire hooks (task 102 / proposal H4, dispatch task 110): evacuation is the survival-band showcase —
// a fire at the building you are PHYSICALLY in interrupts anything and puts you on the street (your own
// home included: the hook reads objectLocationOf, not the 'home' wart) — and on-duty firefighters are
// DISPATCHED to the oldest burning building, where they stay and fight instead of being chased back out.

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const FIREFIGHTER: JobFacts = {
    jobKey: 'firefighter',
    shiftStart: 8 * 60, shiftEnd: 17 * 60,
    daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workplaceKey: '9-9',
    continuousActions: [{ action: 'keeping_watch' }],
    discreteActions: [],
};

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

function harness(jobOf: (id: string) => JobFacts | null, incidents: CityIncidents) {
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    world.register('resident');
    world.register('fighter');
    const makeDeps = (tick: number): BrainDeps => ({
        state: (() => {
            const people: Record<string, GenPerson> = { resident: person('resident'), fighter: person('fighter') };
            return { worldSeed: 23, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 } as PopulationState;
        })(),
        tick, ticksPerYear: TPY,
        ctx: { mode: 'bootstrap', world, markets: { incidents } },
        eventEngine: engine, inventory, jobOf,
    });
    return { engine, actions, brain, world, makeDeps };
}

describe('evacuation (survival band)', () => {
    test('a fire at MY building interrupts whatever I was doing; escaped_a_fire lands on completion', () => {
        const incidents = new CityIncidents();
        const { engine, actions, brain, world, makeDeps } = harness(() => null, incidents);
        // Put the resident inside a building, mid-leisure.
        world.requestTransition('resident', { kind: 'building', key: '5-5' }, 5, null);
        brain.processTick(['resident'], makeDeps(10), [], result());
        expect(actions.activeInstanceOf('resident')).toBeTruthy(); // doing something ordinary

        incidents.report('fire', 11, 'building:5-5', null, 0);
        brain.processTick(['resident'], makeDeps(12), [], result());
        expect(actions.activeInstanceOf('resident')?.defId).toBe('evacuating');
        expect(world.locationOf('resident')).toEqual({ kind: 'outside' }); // out the door

        // The run completes → the record lands.
        for (let tick = 13; tick <= 16 && actions.activeInstanceOf('resident'); tick++) {
            actions.advance(makeDeps(tick));
        }
        expect(engine.getPersonLog('resident').some(e => e.kind === 'event' && e.defId === 'escaped_a_fire')).toBe(true);
    });

    test('no fire at my building → no evacuation (someone else\'s fire is not my emergency)', () => {
        const incidents = new CityIncidents();
        incidents.report('fire', 5, 'building:7-7', null, 0);
        const { actions, brain, world, makeDeps } = harness(() => null, incidents);
        world.requestTransition('resident', { kind: 'building', key: '5-5' }, 5, null);
        brain.processTick(['resident'], makeDeps(10), [], result());
        expect(actions.activeInstanceOf('resident')?.defId).not.toBe('evacuating');
    });

    test('the hook reads PHYSICAL presence: a resident whose locationOf says \'home\' still flees their own burning house (110)', () => {
        // Mimic LiveWorld's at-home resident: logical place 'home', physical building 5-5. The 102 hook
        // read locationOf and silently skipped the family whose own house was burning.
        const incidents = new CityIncidents();
        incidents.report('fire', 5, 'building:5-5', null, 0);
        const { brain, makeDeps } = harness(() => null, incidents);
        const atHome = {
            locationOf: () => ({ kind: 'home' }),
            objectLocationOf: () => ({ kind: 'building', key: '5-5' }),
            peopleAt: () => [],
        } as unknown as WorldAdapter;
        const deps = makeDeps(10);
        deps.ctx = { ...deps.ctx, world: atHome };
        const intents = evacuationHook.propose({ personId: 'resident', deps, brain });
        expect(intents.map(intent => intent.actionId)).toEqual(['evacuating']);
    });
});

describe('the firefighter dispatch (task 110)', () => {
    test('an on-duty firefighter is dispatched TO the oldest burning building; off-duty stays put', () => {
        const incidents = new CityIncidents();
        incidents.report('fire', 5, 'building:7-7', null, 0);
        const { actions, brain, world, makeDeps } = harness(id => (id === 'fighter' ? FIREFIGHTER : null), incidents);
        brain.processTick(['fighter'], makeDeps(10), [], result()); // Monday 10:00, on shift
        expect(actions.activeInstanceOf('fighter')?.defId).toBe('responding_to_fire');
        // Bootstrap transitions resolve immediately — the crew is physically AT the fire.
        expect(world.locationOf('fighter')).toEqual({ kind: 'building', key: '7-7' });

        const sunday = 6 * 24 + 10;
        const rested = harness(id => (id === 'fighter' ? FIREFIGHTER : null), incidents);
        rested.brain.processTick(['fighter'], rested.makeDeps(sunday), [], result());
        expect(rested.actions.activeInstanceOf('fighter')?.defId).not.toBe('responding_to_fire');
    });

    test('the responding crew is not chased back out by the evacuation alarm', () => {
        const incidents = new CityIncidents();
        incidents.report('fire', 5, 'building:7-7', null, 0);
        const { actions, brain, makeDeps } = harness(id => (id === 'fighter' ? FIREFIGHTER : null), incidents);
        brain.processTick(['fighter'], makeDeps(10), [], result());
        expect(actions.activeInstanceOf('fighter')?.defId).toBe('responding_to_fire');
        // Inside the burning building on purpose: the next tick must NOT flip them to 'evacuating'.
        brain.processTick(['fighter'], makeDeps(11), [], result());
        expect(actions.activeInstanceOf('fighter')?.defId).toBe('responding_to_fire');
    });

    test('a fire with no building address falls back to the generic outside run', () => {
        const incidents = new CityIncidents();
        incidents.report('fire', 5, 'outside', null, 0);
        const { actions, brain, makeDeps } = harness(id => (id === 'fighter' ? FIREFIGHTER : null), incidents);
        brain.processTick(['fighter'], makeDeps(10), [], result());
        expect(actions.activeInstanceOf('fighter')?.defId).toBe('rushing_to_the_fire');
    });
});
