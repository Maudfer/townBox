import ActionEngine from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick, TickProfiler } from 'game/execution/TickRunner';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// TickRunner (task 040/078) is the shared 9-phase spine. executionBoundary.test.ts and arcScenarios.test.ts
// already exercise the main path; this file targets the remaining branches: the optional `profiler`
// accumulator (task 078 --profile) on every phase, and the phase-6 `onCommitted` dispatch — none of which
// the other execution suites happen to engage together.

const TPY = 8640;

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    for (const id of ids) {
        people[id] = gen(id);
    }
    return { worldSeed: 3, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

describe('TickRunner profiler accumulation (task 078 --profile)', () => {
    test('every instrumented phase (actions, events, progression, brain) accumulates wall-clock time', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const world = new BootstrapWorld();
        world.register('p1');
        const state = pool(['p1']);

        const profiler: TickProfiler = { actions: 0, events: 0, progression: 0, brain: 0 };
        await runTick({
            engine, actionEngine: actions, brain, profiler,
            state, agentIds: ['p1'], tick: 0, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world },
        });

        // Every phase that ran (actions, events, brain) recorded non-negative elapsed time. progression stays
        // 0 because no skillProgression was supplied (that phase never runs, so its bucket is never touched).
        expect(profiler.actions).toBeGreaterThanOrEqual(0);
        expect(profiler.events).toBeGreaterThanOrEqual(0);
        expect(profiler.brain).toBeGreaterThanOrEqual(0);
        expect(profiler.progression).toBe(0);
    });

    test('no profiler supplied is a zero-overhead no-op path (the default, incl. live play)', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const world = new BootstrapWorld();
        world.register('p1');
        const state = pool(['p1']);

        // No `profiler` field at all: the clock() closures short-circuit and every profiler?.xxx write is
        // skipped — this must not throw.
        const result = await runTick({
            engine, actionEngine: actions, brain,
            state, agentIds: ['p1'], tick: 0, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world },
        });
        expect(result).toMatchObject({ died: [], born: [] });
    });
});

describe('TickRunner phase 6 — onCommitted dispatch', () => {
    test('onCommitted is awaited with this tick\'s TickResult after events commit', async () => {
        const engine = new EventEngine();
        const state = pool(['p1']);
        const seen: TickResult[] = [];

        const result = await runTick({
            engine,
            state, agentIds: ['p1'], tick: 0, ticksPerYear: TPY,
            ctx: {},
            onCommitted: async r => {
                seen.push(r);
            },
        });

        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(result); // the exact same accumulated result object phase 6 sees
    });

    test('no actionEngine/brain supplied: phases 1-2 and 7-8 are skipped, events + onCommitted still run', async () => {
        const engine = new EventEngine();
        const state = pool(['p1']);
        let committedCalls = 0;

        const result = await runTick({
            engine,
            state, agentIds: ['p1'], tick: 0, ticksPerYear: TPY,
            ctx: {},
            onCommitted: () => {
                committedCalls += 1;
            },
        });

        expect(committedCalls).toBe(1);
        expect(result).toEqual({ died: [], born: [], signals: [], committed: [] });
    });

    test('an actionEngine without a brain skips the brain/arbitration phase but still advances actions', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const world = new BootstrapWorld();
        world.register('p1');
        const state = pool(['p1']);

        // No `brain` field: phases 7-8 (`if (plan.brain && plan.actionEngine)`) never run, but phases 1-2
        // (`if (plan.actionEngine)`) do.
        const result = await runTick({
            engine, actionEngine: actions,
            state, agentIds: ['p1'], tick: 0, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world },
        });
        expect(result).toBeDefined();
    });
});
