import Brain, { BrainDeps, JobFacts } from '../src/app/game/Brain';
import ActionEngine from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from '../src/app/game/Inventory';
import { runTick } from '../src/app/game/TickRunner';

import { TickResult, ActionLogEntry } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';

// The Brain (task 046): obligation intents, the woke-up flow, deterministic free-time selection, intent
// arbitration, and the derived status enum — all over the REAL default manifests (events/actions/jobs data).

const TPY = 8640;

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    ids.forEach(id => (people[id] = person(id)));
    return { worldSeed: 77, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const CLERK_JOB: JobFacts = {
    shiftStart: 9 * 60,
    shiftEnd: 17 * 60,
    daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workplaceKey: '9-9',
    continuousActions: [{ action: 'attending_customers' }],
    discreteActions: [{ action: 'greeted_a_customer', chancePerTick: 0.5 }],
};

function harness(jobOf?: (id: string) => JobFacts | null) {
    const engine = new EventEngine(); // the real events.json (woke_up/started_working/stopped_working exist)
    const actions = new ActionEngine(undefined, engine.getLifeLog()); // the real actions.json
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const makeDeps = (tick: number): BrainDeps => ({
        state: pool(['a', 'b']), tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory, ...(jobOf ? { jobOf } : {}),
    });
    return { engine, actions, brain, world, inventory, makeDeps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('obligation hook', () => {
    // Tick 10 = Monday 10:00 (day 0 of the 7-day cycle) — inside the clerk shift.
    test('on shift → starts the job work action at the OWN workplace and derives status working', () => {
        const { engine, brain, makeDeps } = harness(id => (id === 'a' ? CLERK_JOB : null));
        brain.processTick(['a', 'b'], makeDeps(10), [], result());

        const status = brain.statusOf('a');
        expect(status.status).toBe('working');
        const instance = brain.getActionEngine().getInstance(status.activeActionInstanceId!)!;
        expect(instance.defId).toBe('attending_customers');
        expect(instance.locationOverride).toBe('building:9-9');
        // The lifecycle fired started_working through the manual-event pipeline with the start entry as cause.
        const started = engine.getPersonLog('a').find(e => e.kind === 'event' && e.defId === 'started_working')!;
        expect(started.triggerSource).toBe('action');
        // The unemployed person picked a free-time activity instead of idling (idle fallback).
        expect(brain.statusOf('b').status).not.toBe('idle');
    });

    test('obligations displace leisure (mayInterrupt), and shift end interrupts work', () => {
        const { engine, brain, makeDeps } = harness(id => (id === 'a' ? CLERK_JOB : null));
        // 05:00 Monday: off shift → free time.
        brain.processTick(['a'], makeDeps(5), [], result());
        expect(brain.statusOf('a').status).not.toBe('working');

        // 09:00 Monday: shift starts → the obligation interrupts whatever leisure was running.
        brain.processTick(['a'], makeDeps(9), [], result());
        expect(brain.statusOf('a').status).toBe('working');

        // 17:00 Monday: shift over → work interrupted; stopped_working fires via the lifecycle link.
        brain.processTick(['a'], makeDeps(17), [], result());
        expect(brain.statusOf('a').status).not.toBe('working');
        expect(engine.getPersonLog('a').some(e => e.kind === 'event' && e.defId === 'stopped_working')).toBe(true);
    });

    test('off days are honored: no work intent on Sunday', () => {
        const { brain, makeDeps } = harness(() => CLERK_JOB);
        const sundayTick = 6 * 24 + 10; // day 6 (Sunday) 10:00
        brain.processTick(['a'], makeDeps(sundayTick), [], result());
        expect(brain.statusOf('a').status).not.toBe('working');
    });
});

describe('woke-up flow', () => {
    test('sleep completes → woke_up commits → the wokeUp hook picks the next activity the same tick', async () => {
        const { engine, actions, brain, makeDeps, inventory, world } = harness();
        void inventory;
        // Put person a to sleep at 21:00 (night multiplier makes sleep dominate, but force it directly here).
        const deps21 = makeDeps(21);
        const start = actions.startAction('a', 'sleep', {}, { source: 'brain', causationId: null }, deps21, result());
        expect(start.ok).toBe(true);

        // Advance 8 running ticks through the SHARED TickRunner (the same spine live play uses).
        let woke = false;
        for (let tick = 22; tick <= 30 && !woke; tick++) {
            const tickResult = await runTick({
                engine, actionEngine: actions, brain,
                state: deps21.state, agentIds: ['a'], tick, ticksPerYear: TPY,
                ctx: { mode: 'bootstrap', world },
            });
            woke = tickResult.committed.some(commit => commit.eventId === 'woke_up');
            if (woke) {
                // The wokeUp hook reacted within the same tick: the person is doing something new already.
                expect(brain.statusOf('a').status).not.toBe('idle');
                const wokeEntry = engine.getPersonLog('a').find(e => e.kind === 'event' && e.defId === 'woke_up')!;
                const nextStart = engine.getPersonLog('a').filter(e => e.kind === 'action').map(e => e as ActionLogEntry)
                    .find(entry => entry.lifecycle === 'started' && entry.seq > wokeEntry.seq);
                expect(nextStart?.triggerSource).toBe('brain');
            }
        }
        expect(woke).toBe(true);
    });
});

describe('free-time selection', () => {
    test('deterministic per (seed, tick, person) and varied across people/ticks', () => {
        const { brain, makeDeps } = harness();
        const first = brain.selectFreeTimeAction('a', makeDeps(100));
        expect(brain.selectFreeTimeAction('a', makeDeps(100))).toBe(first);

        const picks = new Set<string>();
        for (let tick = 100; tick < 130; tick++) {
            const pick = brain.selectFreeTimeAction('a', makeDeps(tick));
            if (pick) {
                picks.add(pick);
            }
        }
        expect(picks.size).toBeGreaterThan(1); // not locked into one action
    });

    test('selection modifiers steer the distribution: night hours make sleep dominate', () => {
        const { brain, makeDeps } = harness();
        let sleepPicks = 0;
        const SAMPLES = 40;
        for (let i = 0; i < SAMPLES; i++) {
            const tick = 23 + i * 24; // 23:00 every night, varying the RNG stream
            if (brain.selectFreeTimeAction('a', makeDeps(tick)) === 'sleep') {
                sleepPicks += 1;
            }
        }
        expect(sleepPicks / SAMPLES).toBeGreaterThan(0.6); // weight 0.2 × 30 ≈ 6 vs ~2.3 total others
    });

    test('hard gates hold: read_book is never picked without a book in Possessions', () => {
        const { brain, makeDeps, inventory } = harness();
        for (let tick = 100; tick < 140; tick++) {
            expect(brain.selectFreeTimeAction('a', makeDeps(tick))).not.toBe('read_book');
        }
        inventory.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const picks = new Set<string>();
        for (let tick = 100; tick < 200; tick++) {
            const pick = brain.selectFreeTimeAction('a', makeDeps(tick));
            if (pick) picks.add(pick);
        }
        expect(picks.has('read_book')).toBe(true);
    });
});

describe('derived status', () => {
    test('idle / sleeping / performing_action derive from the active instance', () => {
        const { actions, brain, makeDeps } = harness();
        expect(brain.statusOf('a')).toEqual({ status: 'idle', activeActionInstanceId: null });

        const deps = makeDeps(21);
        const outcome = actions.startAction('a', 'sleep', {}, { source: 'brain', causationId: null }, deps, result());
        expect(brain.statusOf('a').status).toBe('sleeping');
        actions.interrupt((outcome as { instanceId: string }).instanceId, { source: 'brain', causationId: null }, deps, result());
        expect(brain.statusOf('a').status).toBe('idle');

        actions.startAction('a', 'rest', {}, { source: 'brain', causationId: null }, deps, result());
        expect(brain.statusOf('a').status).toBe('performing_action');
    });
});
