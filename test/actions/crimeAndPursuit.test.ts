import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import CityIncidents from 'game/economy/CityIncidents';
import Economy from 'game/economy/Economy';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Crime & the chase (task 099 / proposal G4): the covert theft mechanics (stolen goods keep their true
// owner; the pickpocket's covert contract skips consent but fires the victim's counterpart), and the
// pursuit hook proposing flee (survival) / give-chase (obligation) intents on wanted–officer co-location.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    ids.forEach(id => (people[id] = person(id)));
    return { worldSeed: 17, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

const OFFICER_JOB: JobFacts = {
    jobKey: 'police_officer',
    shiftStart: 8 * 60, shiftEnd: 17 * 60,
    daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workplaceKey: '9-9',
    continuousActions: [{ action: 'patrolling' }],
    discreteActions: [],
};

describe('the covert theft mechanics', () => {
    test('pocketed merchandise keeps its true owner — a theft is never a purchase', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('thief');
        const deps = { state: pool(['thief']), tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world }, eventEngine: engine, inventory };
        // Shop stock at the thief's location: business-owned, pocketable.
        const home = world.objectLocationOf('thief');
        const stock = inventory.createInstance({ archetypeId: 'apple', owner: { kind: 'business', key: '5-5' }, container: { kind: 'location', key: home.kind === 'building' ? home.key : 'home' }, tick: 0 });

        const start = actions.startAction('thief', 'pocketed_merchandise', {}, { source: 'brain', causationId: null }, deps, result());
        expect(start.ok).toBe(true);
        const instance = inventory.getInstance(stock.id)!;
        expect(instance.container).toEqual({ kind: 'possessions', personId: 'thief' }); // carried now…
        expect(instance.owner).toEqual({ kind: 'business', key: '5-5' }); // …but never theirs
        // The record + the incident beacon.
        expect(engine.getPersonLog('thief').some(e => e.kind === 'event' && e.defId === 'committed_shoplifting')).toBe(true);
    });

    test('pickpocketing skips consent (covert), moves the money, and the victim logs the counterpart', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('thief');
        world.register('mark');
        const economy = new Economy();
        economy.adjustPerson('thief', 10); // broke enough to pass the money gate
        economy.adjustPerson('mark', 500);
        const deps = {
            state: pool(['thief', 'mark']), tick: 10, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap' as const, world, markets: { ledger: economy } }, eventEngine: engine, inventory,
        };
        const start = actions.startAction('thief', 'pickpocketed_someone', { target: 'mark' }, { source: 'brain', causationId: null }, deps, result());
        expect(start.ok).toBe(true); // no consent roll — covert
        expect(economy.getPersonBalance('thief')).toBe(25);
        expect(economy.getPersonBalance('mark')).toBe(485);
        expect(engine.getPersonLog('mark').some(e => e.kind === 'event' && e.defId === 'got_pickpocketed')).toBe(true);
        // The covert contract is declared, never askFirst (the validator enforces the exclusion).
        expect(ACTIONS['pickpocketed_someone']!.interaction!.covert).toBe(true);
        expect(ACTIONS['pickpocketed_someone']!.interaction!.askFirst).toBe(false);
    });
});

describe('the pursuit hook', () => {
    function harness(jobOf: (id: string) => JobFacts | null, incidents: CityIncidents) {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('officer');
        world.register('runner');
        const makeDeps = (tick: number): BrainDeps => ({
            state: pool(['officer', 'runner']), tick, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { incidents } },
            eventEngine: engine, inventory, jobOf,
        });
        return { engine, actions, brain, world, makeDeps };
    }

    test('wanted + on-duty officer co-located → the suspect flees (survival) and the officer chases', () => {
        const incidents = new CityIncidents();
        incidents.report('shoplifting', 5, 'home', 'runner', 2); // witnessed → wanted
        const { brain, makeDeps } = harness(id => (id === 'officer' ? OFFICER_JOB : null), incidents);
        // Tick 10 = Monday 10:00, on shift; both register at 'home' in the bootstrap world (co-located).
        brain.processTick(['officer', 'runner'], makeDeps(10), [], result());
        expect(brain.getActionEngine().activeInstanceOf('runner')?.defId).toBe('fleeing_the_police');
        expect(brain.getActionEngine().activeInstanceOf('officer')?.defId).toBe('chasing_a_suspect');
    });

    test('no chase without a witness, off shift, or without the incidents market', () => {
        // Unwitnessed → not wanted → nobody moves.
        const unseen = new CityIncidents();
        unseen.report('shoplifting', 5, 'home', 'runner', 0);
        const a = harness(id => (id === 'officer' ? OFFICER_JOB : null), unseen);
        a.brain.processTick(['officer', 'runner'], a.makeDeps(10), [], result());
        expect(a.brain.getActionEngine().activeInstanceOf('runner')?.defId).not.toBe('fleeing_the_police');

        // Witnessed but the officer is off shift (Sunday) → the suspect keeps their nerve.
        const witnessed = new CityIncidents();
        witnessed.report('shoplifting', 5, 'home', 'runner', 2);
        const b = harness(id => (id === 'officer' ? OFFICER_JOB : null), witnessed);
        const sunday = 6 * 24 + 10;
        b.brain.processTick(['officer', 'runner'], b.makeDeps(sunday), [], result());
        expect(b.brain.getActionEngine().activeInstanceOf('runner')?.defId).not.toBe('fleeing_the_police');
        expect(b.brain.getActionEngine().activeInstanceOf('officer')?.defId).not.toBe('chasing_a_suspect');
    });

    test('the fleeing action fires chase_concluded on completion — the outcome beacon City resolves', () => {
        expect(ACTIONS['fleeing_the_police']!.events!.onComplete).toBe('chase_concluded');
        expect(ACTIONS['fleeing_the_police']!.ambulatory).toBe('run');
        expect(ACTIONS['chasing_a_suspect']!.ambulatory).toBe('run');
    });
});

describe('field work (the beat walk)', () => {
    test('an ambulatory outdoor work action keeps its own location — no workplace override', () => {
        const incidents = new CityIncidents();
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('officer');
        const deps: BrainDeps = {
            state: pool(['officer']), tick: 10, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { incidents } },
            eventEngine: engine, inventory, jobOf: id => (id === 'officer' ? OFFICER_JOB : null),
        };
        brain.processTick(['officer'], deps, [], result());
        const active = actions.activeInstanceOf('officer')!;
        expect(active.defId).toBe('patrolling');
        expect(active.locationOverride).toBeUndefined(); // outside, on the street — not inside the station
    });
});
