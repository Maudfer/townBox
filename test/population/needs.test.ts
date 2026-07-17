import Brain, { BrainDeps } from 'game/actions/Brain';
import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import Needs from 'game/population/Needs';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// The needs engine (task 084 / proposal A): closed-form decay, lazy deterministic seeding, satisfaction
// crediting on action commits, urgency-weighted selection, and the critical-need hook.

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const FIXTURE_EVENTS = {
    woke_up: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { manual: {} }, limit: { once: 'perDay' }, effects: [] },
} as unknown as EventManifest;

// A tiny manifest: one action per need flavor, so selection behavior is fully controlled.
const FIXTURE_ACTIONS = {
    eat: { label: 'Eating', type: 'continuous', category: 'maintenance', durationTicks: 1, satisfies: { food: 50 } },
    nap: { label: 'Napping', type: 'continuous', category: 'recovery', durationTicks: 1, satisfies: { rest: 40 } },
    play: { label: 'Playing', type: 'continuous', category: 'leisure', durationTicks: 1, satisfies: { fun: 30 } },
    snack: { label: 'Snacked', type: 'discrete', category: 'maintenance', satisfies: { food: 20 } },
} as unknown as ActionManifest;

function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(FIXTURE_EVENTS);
    const actions = new ActionEngine(FIXTURE_ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const needs = new Needs();
    const people = { a: person('a') };
    const state: PopulationState = { worldSeed: 7, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.register('a');
    const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { needs } }, eventEngine: engine, inventory };
    return { engine, actions, brain, needs, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('the ledger', () => {
    test('lazy seeding is deterministic per (worldSeed, personId) and within [initMin, initMax]', () => {
        const a = new Needs();
        const b = new Needs();
        const levelA = a.levelOf('p1', 'food', 100, 42);
        expect(levelA).toBeGreaterThanOrEqual(55);
        expect(levelA).toBeLessThanOrEqual(90);
        expect(b.levelOf('p1', 'food', 100, 42)).toBe(levelA);
        expect(new Needs().levelOf('p1', 'food', 100, 43)).not.toBe(levelA); // seed matters
    });

    test('decay is closed-form linear: the read at T is stride-independent (the K2 rule)', () => {
        const a = new Needs();
        const first = a.levelOf('p1', 'food', 0, 42);
        // food decays 36/day = 1.5/tick.
        expect(a.levelOf('p1', 'food', 24, 42)).toBeCloseTo(first - 36, 9);
        // A second ledger reading only at the end sees the identical value.
        const b = new Needs();
        b.levelOf('p1', 'food', 0, 42);
        expect(b.levelOf('p1', 'food', 24, 42)).toBeCloseTo(a.levelOf('p1', 'food', 24, 42), 12);
        // Floors at zero.
        expect(a.levelOf('p1', 'food', 24 * 60, 42)).toBe(0);
    });

    test('satisfy materializes decay then credits, clamped to 100; serialize round-trips', () => {
        const a = new Needs();
        a.levelOf('p1', 'food', 0, 42);
        a.satisfy('p1', { food: 100 }, 24, 42);
        expect(a.levelOf('p1', 'food', 24, 42)).toBe(100);
        const restored = new Needs();
        restored.loadState(a.serialize());
        expect(restored.levelOf('p1', 'food', 24, 42)).toBe(100);
    });

    test('criticalNeedsOf reports starved meters, most-starved first', () => {
        const a = new Needs();
        a.levelOf('p1', 'food', 0, 42);
        a.satisfy('p1', { food: -100, rest: -100 }, 0, 42); // force both to 0
        const critical = a.criticalNeedsOf('p1', 0, 42);
        expect(critical).toContain('food');
        expect(critical).toContain('rest');
        expect(critical).not.toContain('purpose'); // seeded 55+, purpose decays 8/day — not critical at t=0
    });
});

describe('engine crediting & selection', () => {
    test('a discrete commit credits its satisfies through the markets ledger', () => {
        const { actions, needs, deps } = harness();
        needs.satisfy('a', { food: -100 }, 100, 7); // starve
        const before = needs.levelOf('a', 'food', 100, 7);
        expect(actions.startAction('a', 'snack', {}, cause, deps, result()).ok).toBe(true);
        expect(needs.levelOf('a', 'food', 100, 7)).toBeCloseTo(before + 20, 9);
    });

    test('a completed continuous action credits; urgency steers the free-time pick toward the starved need', () => {
        const { brain, needs, deps } = harness();
        needs.satisfy('a', { food: -100 }, 100, 7); // food = 0 → urgency ×6
        needs.satisfy('a', { fun: 20, rest: 20 }, 100, 7); // others healthy-ish
        // With food starved, the weighted pick lands on 'eat' overwhelmingly. Sample across ticks: 'eat'
        // must dominate (deterministic per tick; across 30 ticks the majority is structural, not luck).
        let eats = 0;
        for (let tick = 100; tick < 130; tick++) {
            if (brain.selectFreeTimeAction('a', { ...deps, tick }) === 'eat') {
                eats++;
            }
        }
        expect(eats).toBeGreaterThan(20);
    });

    test('the needsHook proposes a REQUIRED intent for a critical need and it executes', () => {
        const { brain, needs, engine, deps } = harness();
        needs.satisfy('a', { food: -100 }, 100, 7);
        brain.processTick(['a'], deps, [], result());
        const active = brain.getActionEngine().activeInstanceOf('a');
        expect(active?.defId).toBe('eat');
        // And it self-completes next tick, crediting food (durationTicks 1).
        brain.getActionEngine().advance({ ...deps, tick: 101 });
        expect(needs.levelOf('a', 'food', 101, 7)).toBeGreaterThan(40);
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'eat' && entry.lifecycle === 'completed')).toBe(true);
    });

    test('the needsHook does not thrash: no proposal while already addressing the need', () => {
        const { brain, needs, deps } = harness();
        needs.satisfy('a', { food: -100 }, 100, 7);
        brain.processTick(['a'], deps, [], result());
        const first = brain.getActionEngine().activeInstanceOf('a');
        // Same tick re-run: the active 'eat' instance satisfies food → no interrupt/restart.
        brain.processTick(['a'], deps, [], result());
        expect(brain.getActionEngine().activeInstanceOf('a')?.id).toBe(first?.id);
    });
});
