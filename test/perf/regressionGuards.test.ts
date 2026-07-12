// Deterministic (flake-free) regression guards for the specific 078/079 optimizations that must not regress.
// These assert ALGORITHMIC properties — exact operation COUNTS (util/perfMeter) and reference identity for the
// caches/pruning — so they're machine-independent and enforce exactly, everywhere. The SOLE exception is the
// predicate-precompilation guard at the bottom: precompilation does the same logical work as the interpreter
// (same node visits, same context reads), so no count can see it — only a within-run TIMING RATIO can, and a
// ratio is machine-independent (both paths timed in the same process). It is the only timing-based check left
// in the whole perf suite.

import { minMsPerOp } from './perfHarness';
import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick } from 'game/execution/TickRunner';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';

import { beginMeter, endMeter } from 'util/perfMeter';
import { evaluatePredicate, evaluatePredicateCached, Predicate } from 'util/predicate';
import { TICKS_PER_YEAR } from 'util/time';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';
import { SimulationContext, Value, HasEventQuery, ObjectQuery } from 'types/Simulation';


jest.setTimeout(60_000);

function gen(id: string, birthTick = -30 * TICKS_PER_YEAR): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(people: GenPerson[]): PopulationState {
    return { worldSeed: 21, people: Object.fromEntries(people.map(p => [p.id, p])), drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

function fixtureContext(): SimulationContext {
    const attrs: Record<string, Value> = { alive: true, age: 30, gender: 'female', marital: 'single', money: 500, health: 100 };
    const events: Record<string, { count: number; lastTick: number }> = { had_sex: { count: 1, lastTick: 700 } };
    const now = 1000;
    const match = (r: { count: number; lastTick: number } | undefined, q?: HasEventQuery) =>
        !!r && !(q?.minCount !== undefined && r.count < q.minCount) && !(q?.withinTicks !== undefined && now - r.lastTick > q.withinTicks);
    return {
        getAttr: (n: string) => attrs[n],
        hasEvent: (id: string, q?: HasEventQuery) => match(events[id], q),
        hasAction: () => false,
        carries: (_q: ObjectQuery) => false,
        objectAtLocation: (_q: ObjectQuery) => false,
        role: () => null,
    };
}

const MICRO_PREDICATE: Predicate = {
    all: [
        { attr: 'alive', op: '==', value: true },
        { attr: 'age', op: '>=', value: 18 },
        { any: [{ attr: 'marital', op: '==', value: 'single' }, { attr: 'money', op: '>', value: 100 }] },
        { not: { hasEvent: 'had_sex', withinTicks: 100 } },
    ],
};

describe('perf regression guards (deterministic)', () => {
    // Task 079: EventEngine.invoke must NOT rebuild the O(whole-pool) living-agent list for a subject-only
    // event (`woke_up` has no candidate-search role). The meter counts the pool entries invoke scans; gated,
    // it is exactly 0 at any pool size. Deterministic and machine-independent — no timing needed. If the
    // gating regresses (the pass-1 bug that let the subject role's `where` force the whole-pool build), this
    // jumps straight to the pool size.
    it('invoke of a subject-only event scans zero pool entries (agent-list gating)', () => {
        const invokeScan = (poolSize: number): number => {
            const engine = new EventEngine();
            const state = pool(Array.from({ length: poolSize }, (_, i) => gen(`p${i}`)));
            const meter = beginMeter();
            engine.invoke(state, 'woke_up', 'p0', 1000, TICKS_PER_YEAR, { source: 'action', causationId: null });
            endMeter();
            return meter.tally['event.invokeScan'] ?? 0;
        };
        expect(invokeScan(10)).toBe(0);
        expect(invokeScan(1000)).toBe(0); // 100× the pool, still 0 — flat, not O(pool)
    });

    // Task 079: predicate precompilation keeps evaluatePredicateCached a clear win over the interpreter. Both
    // are timed back-to-back in the same process, so the RATIO cancels machine/JIT/load state; the win is ~0.45
    // and losing it (compilation regressed to interpreter cost) sends the ratio toward 1.0.
    it('evaluatePredicateCached stays meaningfully faster than the interpreter (within-run ratio)', () => {
        const ctx = fixtureContext();
        const K = 100_000;
        const interpreted = minMsPerOp(() => { for (let i = 0; i < K; i++) { evaluatePredicate(MICRO_PREDICATE, ctx); } }, K, 12, 4);
        const cached = minMsPerOp(() => { for (let i = 0; i < K; i++) { evaluatePredicateCached(MICRO_PREDICATE, ctx); } }, K, 12, 4);
        const ratio = cached / interpreted;
        console.info(`[guard] predicate cached/interpreted ratio: ${ratio.toFixed(2)} (win ≈0.45, lost ≈1.0)`);
        expect(ratio).toBeLessThan(0.8);
    });

    // Task 079: Inventory.contentsOf returns a CACHED array between containment mutations, and a fresh one
    // after a mutation. Reference identity is deterministic — no timing.
    it('Inventory.contentsOf caches reads and invalidates on mutation', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const container = { kind: 'location' as const, key: '3-3' };
        const inst = inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'world' }, container, tick: 0 });

        const a = inventory.contentsOf(container);
        expect(inventory.contentsOf(container)).toBe(a); // cache hit → same array reference
        inventory.moveInstance(inst.id, { kind: 'possessions', personId: 'a' }); // containment mutation
        expect(inventory.contentsOf(container)).not.toBe(a); // invalidated → rebuilt (now empty)
    });

    // Task 079: ActionEngine.contextFor memoizes the proposal-phase context per (person, tick, backing) and
    // drops it at every mutation point. Reference identity again — deterministic.
    it('ActionEngine.contextFor shares the proposal-phase context and drops it on execution', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const state = pool([gen('a'), gen('b')]);
        const deps: ActionDeps = { state, tick: 1000, ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };

        const ctx = actions.contextFor('a', deps);
        expect(actions.contextFor('a', deps)).toBe(ctx);                        // same (person, tick, backing) → shared
        expect(actions.contextFor('b', deps)).not.toBe(ctx);                    // different person → fresh
        expect(actions.contextFor('a', { ...deps, tick: 1001 })).not.toBe(ctx); // different tick → fresh
    });

    // Task 078: terminal continuous-action instances are pruned from state.instances (children are discrete,
    // the LifeLog holds their history). Without pruning the set grows without bound over a run — the exact
    // failure the 078 active-instance index + pruning fixed. Deterministic given the seed: after many ticks
    // of free-time activity the live instance set stays ~one-active-per-person, not agents × ticks.
    it('finished action instances are pruned (state.instances stays bounded over a run)', async () => {
        const AGENTS = 30;
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const people: GenPerson[] = [];
        for (let i = 0; i < AGENTS; i++) {
            people.push(gen(`p${i}`, -(20 + (i % 40)) * TICKS_PER_YEAR));
            world.register(`p${i}`);
        }
        const state = pool(people);
        const agentIds = people.map(p => p.id);
        for (let tick = 0; tick < 80; tick++) {
            await runTick({ engine, actionEngine: actions, brain, inventory, state, agentIds, tick, ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap', world } });
        }
        const live = Object.keys(actions.getState().instances).length;
        console.info(`[guard] live action instances after 80 ticks × ${AGENTS} agents: ${live} (bounded; unpruned would be hundreds+)`);
        expect(live).toBeLessThanOrEqual(AGENTS * 2); // ~one active continuous per person, not accumulating
    });
});
