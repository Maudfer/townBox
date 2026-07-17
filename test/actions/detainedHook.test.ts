import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// The detained hook (task 100 / proposal G5): detention is LIVED — the person runs `serving_time` at the
// facility, and the cell outranks the shift through normal arbitration (the job is simply missed).

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const CLERK: JobFacts = {
    shiftStart: 9 * 60, shiftEnd: 17 * 60,
    daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workplaceKey: '4-4',
    continuousActions: [{ action: 'attending_customers' }],
    discreteActions: [],
};

function harness(detained: boolean) {
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    world.register('a');
    const state: PopulationState = { worldSeed: 7, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
    const deps: BrainDeps = {
        state, tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory,
        jobOf: () => CLERK,
        detentionOf: () => (detained ? { locationKey: '9-9' } : null),
    };
    return { brain, actions, world, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('the detained hook', () => {
    test('a detained person serves time AT the facility — the shift is missed', () => {
        const { brain, actions, world, deps } = harness(true);
        brain.processTick(['a'], deps, [], result());
        const active = actions.activeInstanceOf('a')!;
        expect(active.defId).toBe('serving_time');
        expect(active.locationOverride).toBe('building:9-9');
        // The transition genuinely put them at the facility (bootstrap resolves immediately).
        expect(world.locationOf('a')).toEqual({ kind: 'building', key: '9-9' });
    });

    test('a free person works their shift as always', () => {
        const { brain, actions, deps } = harness(false);
        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('attending_customers');
    });
});
