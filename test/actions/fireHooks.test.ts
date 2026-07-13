import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import CityIncidents from 'game/economy/CityIncidents';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// The fire hooks (task 102 / proposal H4): evacuation is the survival-band showcase — a fire at YOUR
// building interrupts anything and puts you on the street — and on-duty firefighters drop the station
// routine to rush the alarm. Both end in escaped_a_fire / visible ambulatory runs.

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
});

describe('the firefighter rush', () => {
    test('an on-duty firefighter drops the station routine for any open fire; off-duty stays put', () => {
        const incidents = new CityIncidents();
        incidents.report('fire', 5, 'building:7-7', null, 0);
        const { actions, brain, makeDeps } = harness(id => (id === 'fighter' ? FIREFIGHTER : null), incidents);
        brain.processTick(['fighter'], makeDeps(10), [], result()); // Monday 10:00, on shift
        expect(actions.activeInstanceOf('fighter')?.defId).toBe('rushing_to_the_fire');

        const sunday = 6 * 24 + 10;
        const rested = harness(id => (id === 'fighter' ? FIREFIGHTER : null), incidents);
        rested.brain.processTick(['fighter'], rested.makeDeps(sunday), [], result());
        expect(rested.actions.activeInstanceOf('fighter')?.defId).not.toBe('rushing_to_the_fire');
    });
});
