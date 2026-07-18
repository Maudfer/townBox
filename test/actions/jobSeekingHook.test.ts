import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import { APPLYING_ACTION } from 'game/actions/JobSeeking';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory from 'game/objects/Inventory';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { JobMarket, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Physical job seeking (LP-13 / proposal simulation-aliveness-2 M3): the unemployed walk to the business
// the market scores for them, apply at the door, and the application's completion invokes get_job — hired
// at the counter, during business hours. The generic job_hunting stroll remains the no-openings texture.

const TPY = 8640;
const NINE_AM = 7 * 24 + 9; // an arbitrary day at 09:00

function gen(id: string, age = 30): GenPerson {
    return { id, firstName: id, familyName: 'F', gender: Genders.Male, birthTick: NINE_AM - age * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function market(overrides: Partial<JobMarket> = {}): JobMarket {
    return {
        isEmployed: () => false,
        canHire: () => true,
        hire: () => true,
        fire: () => {},
        bestOpeningKeyFor: () => '9-9',
        ...overrides,
    };
}

function harness(jobMarket: JobMarket, tick = NINE_AM) {
    const inventory = new Inventory();
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const world = new BootstrapWorld(inventory);
    world.register('a');
    const state: PopulationState = { worldSeed: 3, people: { a: gen('a') }, drawSeed: 1, placedIds: [], nextSeq: 9, lastSimulatedYear: 0 };
    const deps: BrainDeps = {
        state, tick, ticksPerYear: TPY,
        ctx: { mode: 'bootstrap', world, markets: { jobMarket } },
        eventEngine: engine, inventory,
    };
    const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
    return { engine, actions, brain, deps, result };
}

describe('the job-seeking hook (LP-13)', () => {
    test('an unemployed adult at business hours gets a located application trip at the scored opening', () => {
        const { actions, brain, deps, result } = harness(market());
        brain.processTick(['a'], deps, [], result());
        const active = actions.activeInstanceOf('a');
        expect(active?.defId).toBe(APPLYING_ACTION);
        expect(active?.params['employer']).toBe('9-9');
        expect(active?.locationOverride).toBe('building:9-9');
    });

    test('silent at night, silent with no opening, silent when employed', () => {
        const night = harness(market(), NINE_AM - 6); // 03:00
        night.brain.processTick(['a'], night.deps, [], night.result());
        expect(night.actions.activeInstanceOf('a')?.defId).not.toBe(APPLYING_ACTION);

        const closed = harness(market({ bestOpeningKeyFor: () => null }));
        closed.brain.processTick(['a'], closed.deps, [], closed.result());
        expect(closed.actions.activeInstanceOf('a')?.defId).not.toBe(APPLYING_ACTION);

        const employed = harness(market());
        employed.deps.jobOf = () => ({ shiftStart: 480, shiftEnd: 1080, workplaceKey: '9-9', continuousActions: [], discreteActions: [] });
        employed.brain.processTick(['a'], employed.deps, [], employed.result());
        expect(employed.actions.activeInstanceOf('a')?.defId).not.toBe(APPLYING_ACTION);
    });

    test('the counter-hire: completing the application invokes get_job through the market', () => {
        const hires: string[] = [];
        const { engine, actions, brain, deps, result } = harness(market({ hire: personId => { hires.push(personId); return true; } }));
        engine.bindMarkets(deps.ctx);
        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe(APPLYING_ACTION);
        // Advance: bootstrap transitions resolve instantly; the applied_for_a_job child (chance 1) commits
        // and its onComplete fires get_job — the acquireSlot effect hires through the market.
        for (let step = 1; step <= 3; step++) {
            actions.advance({ ...deps, tick: deps.tick + step });
        }
        engine.unbindMarkets();
        expect(hires).toEqual(['a']);
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'get_job')).toBe(true);
        // The application ATTEMPT is on record for the jobApplications attribute either way.
        expect(engine.getLifeLog().countRecentActions('a', 'applied_for_a_job', 0)).toBeGreaterThanOrEqual(1);
    });
});
