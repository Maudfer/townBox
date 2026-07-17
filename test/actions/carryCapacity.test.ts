import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { BrainDeps, INVENTORY_CONFIG } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import Needs from 'game/population/Needs';
import actionsConfig from 'json/actions.json';
import eventsConfig from 'json/events.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Carry budgets, stow & fetch (task 088 / proposal F1–F2): the acquisitive hook is capacity-gated and
// curiosity-demoted (the audit's median-553-carried hoard), deposits at home over the stow threshold, and
// fetches pantry ingredients when hungry — the storage loop objects were missing.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

// Real archetypes resolved by property, so the test survives data churn.
const archetypes = Object.entries(DEFAULT_OBJECT_ARCHETYPES);
const bulkyId = archetypes.find(([, a]) => (a.flags as { carryable?: boolean; pocketable?: boolean }).carryable
    && !(a.flags as { pocketable?: boolean }).pocketable && (a.weightGrams ?? 0) > 500)?.[0];
const ingredientId = archetypes.find(([, a]) => (a.tags ?? []).includes('ingredient'))?.[0];
const heavyId = archetypes.filter(([, a]) => (a.flags as { carryable?: boolean }).carryable)
    .sort(([, x], [, y]) => (y.weightGrams ?? 0) - (x.weightGrams ?? 0))[0]?.[0];

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const needs = new Needs();
    const state: PopulationState = { worldSeed: 11, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.register('a');
    const deps: BrainDeps & ActionDeps = { state, tick: 500, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { needs } }, eventEngine: engine, inventory };
    return { engine, actions, brain, needs, world, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

function carry(inventory: Inventory, personId: string, archetypeId: string, tick = 0): void {
    inventory.createInstance({ archetypeId, owner: { kind: 'person', personId }, container: { kind: 'possessions', personId }, tick });
}

function grabsAcross(harnessed: ReturnType<typeof harness>, ticks: number): number {
    const { brain, deps, engine } = harnessed;
    for (let tick = 500; tick < 500 + ticks; tick++) {
        brain.processTick(['a'], { ...deps, tick }, [], result());
        brain.getActionEngine().advance({ ...deps, tick });
    }
    return engine.getPersonLog('a').filter(entry => entry.kind === 'action'
        && (entry.defId === 'grab' || entry.defId === 'pocketed_small_object')).length;
}

describe('curiosity demotion & capacity (F1)', () => {
    test('pickups are a rare impulse now, not every idle tick', () => {
        expect(bulkyId).toBeDefined();
        const run = harness();
        // A pile of free-to-take bulky objects at home; pre-088 the hook grabbed EVERY tick.
        for (let i = 0; i < 10; i++) {
            run.deps.inventory!.createInstance({ archetypeId: bulkyId!, owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        }
        const grabs = grabsAcross(run, 40);
        // ≈ curiosityChancePerTick (0.04) × 40 idle ticks — a handful at most, and dedup by carried archetype
        // means at most ONE of the same bulky thing.
        expect(grabs).toBeLessThanOrEqual(3);
    });

    test('over the weight budget, nothing more is picked up', () => {
        expect(heavyId).toBeDefined();
        const run = harness();
        // Fill the person past the budget with heavy carried objects.
        while (run.deps.inventory!.carriedWeightGrams('a') < INVENTORY_CONFIG.maxCarriedWeightGrams) {
            carry(run.deps.inventory!, 'a', heavyId!);
        }
        // Keep them AWAY from home so the stow branch can't fire (stow only happens at home).
        run.world.requestTransition('a', { kind: 'building', key: '5-5' }, 500, null);
        run.deps.inventory!.createInstance({ archetypeId: bulkyId!, owner: { kind: 'none' }, container: { kind: 'location', key: '5-5' }, tick: 0 });
        expect(grabsAcross(run, 60)).toBe(0);
    });
});

describe('stow & fetch (F2)', () => {
    test('over the stow threshold at home, the hook deposits (put_down) instead of hoarding', () => {
        const run = harness();
        while (run.deps.inventory!.carriedWeightGrams('a') <= INVENTORY_CONFIG.maxCarriedWeightGrams * INVENTORY_CONFIG.stowAboveFraction) {
            carry(run.deps.inventory!, 'a', heavyId!);
        }
        const before = run.deps.inventory!.carriedWeightGrams('a');
        for (let tick = 500; tick < 560; tick++) {
            run.brain.processTick(['a'], { ...run.deps, tick }, [], result());
            run.brain.getActionEngine().advance({ ...run.deps, tick });
        }
        expect(run.deps.inventory!.carriedWeightGrams('a')).toBeLessThan(before);
        expect(run.engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'put_down')).toBe(true);
    });

    test('hungry at home with a pantry: the hook fetches an ingredient so cooking becomes reachable', () => {
        expect(ingredientId).toBeDefined();
        const run = harness();
        run.needs.satisfy('a', { food: -100 }, 500, 11); // starve → below pantryFetchBelowFood
        run.deps.inventory!.createInstance({ archetypeId: ingredientId!, owner: { kind: 'person', personId: 'a' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        let fetched = false;
        for (let tick = 500; tick < 520 && !fetched; tick++) {
            run.brain.processTick(['a'], { ...run.deps, tick }, [], result());
            run.brain.getActionEngine().advance({ ...run.deps, tick });
            fetched = run.deps.inventory!.carriedInstances('a').some(instance => instance.archetypeId === ingredientId);
        }
        expect(fetched).toBe(true);
    });
});
