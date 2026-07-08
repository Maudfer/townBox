import Brain, { JobFacts } from '../src/app/game/Brain';
import ActionEngine, { DEFAULT_ACTION_MANIFEST } from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from '../src/app/game/Inventory';
import { runTick } from '../src/app/game/TickRunner';

import { ActionLogEntry } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';
import jobsConfig from '../src/json/jobs.json';
import { JobTable } from '../src/types/Business';

// The actions backfill (task 051): catalog floors + a multi-day life smoke over the real data — people
// sleep at night, work their shifts, fill free time with varied activities, and accumulate possessions.

const TPY = 8640;
const JOBS = jobsConfig as unknown as JobTable;

describe('catalog floors (task 051)', () => {
    const manifest = DEFAULT_ACTION_MANIFEST;

    test('the catalog is substantially expanded', () => {
        const all = Object.values(manifest);
        expect(all.length).toBeGreaterThanOrEqual(200);
        expect(all.filter(def => def.type === 'continuous').length).toBeGreaterThanOrEqual(50);
        expect(all.filter(def => def.type === 'discrete').length).toBeGreaterThanOrEqual(140);
        // Every behavior category is populated.
        for (const category of ['work', 'leisure', 'social', 'recovery', 'maintenance'] as const) {
            expect(all.some(def => def.category === category)).toBe(true);
        }
    });

    test('person-targeted social actions exist (target parameters)', () => {
        const targeted = Object.values(manifest).filter(def => def.parameters?.['target']?.type === 'person');
        expect(targeted.length).toBeGreaterThanOrEqual(10);
    });

    test('free-time continuous actions carry selection metadata with modifiers', () => {
        const freeTime = Object.entries(manifest).filter(([, def]) =>
            def.type === 'continuous' && def.category !== 'work' && def.category !== 'obligation' && (def.selection?.weight ?? 0) > 0);
        expect(freeTime.length).toBeGreaterThanOrEqual(20);
        expect(freeTime.filter(([, def]) => (def.selection?.modifiers?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(12);
    });

    test('every job declares at least 2 continuous and 5 discrete work actions', () => {
        for (const [id, job] of Object.entries(JOBS)) {
            expect({ id, cont: job.workActions.continuous.length >= 2 }).toEqual({ id, cont: true });
            expect({ id, disc: job.workActions.discrete.length >= 5 }).toEqual({ id, disc: true });
        }
    });
});

describe('multi-day life smoke (task 051)', () => {
    function person(id: string, ageYears: number): GenPerson {
        return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
    }

    test('five days of the shared lifecycle: sleep at night, work on shift, varied free time, possessions grow', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const state: PopulationState = {
            worldSeed: 1234,
            people: { worker: person('worker', 35), kid: person('kid', 9), retiree: person('retiree', 70) },
            drawSeed: 1, placedIds: [], nextSeq: 500, lastSimulatedYear: 0,
        };
        // Something pocketable lying around at home feeds the inventory-opportunity hook.
        inventory.createInstance({ archetypeId: 'coin', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0, quantity: 3 });
        inventory.createInstance({ archetypeId: 'book', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });

        const clerk = JOBS['checkout_clerk']!;
        const jobOf = (id: string): JobFacts | null => (id === 'worker' ? {
            shiftStart: clerk.shiftStart, shiftEnd: clerk.shiftEnd, daysOfWeek: clerk.daysOfWeek,
            workplaceKey: '9-9',
            continuousActions: clerk.workActions.continuous,
            discreteActions: clerk.workActions.discrete,
        } : null);

        const agents = ['worker', 'kid', 'retiree'];
        let workingObserved = 0;
        let sleepingAtNight = 0;
        for (let tick = 0; tick < 5 * 24; tick++) {
            await runTick({
                engine, actionEngine: actions, brain,
                state, agentIds: agents, tick, ticksPerYear: TPY,
                ctx: { mode: 'bootstrap', world },
                inventory, jobOf,
            });
            if (brain.statusOf('worker').status === 'working') {
                workingObserved += 1;
            }
            const hour = tick % 24;
            if (hour >= 23 || hour <= 4) {
                for (const id of agents) {
                    if (brain.statusOf(id).status === 'sleeping') {
                        sleepingAtNight += 1;
                    }
                }
            }
        }

        // The worker attended their Mon–Sat 8–16 shifts (5 days × 8 on-shift ticks observed post-start).
        expect(workingObserved).toBeGreaterThanOrEqual(25);
        // Nights are mostly for sleeping across the household.
        expect(sleepingAtNight).toBeGreaterThanOrEqual(30);

        // Everyone lived a varied life: multiple distinct actions per person, nobody idle-locked.
        for (const id of agents) {
            const performedIds = new Set(engine.getPersonLog(id)
                .filter((e): e is ActionLogEntry => e.kind === 'action')
                .map(e => e.defId));
            expect({ id, variety: performedIds.size >= 5 }).toEqual({ id, variety: true });
        }
        // Somebody pocketed something along the way (inventory-opportunity / wandering pools).
        const carriedTotal = agents.reduce((sum, id) => sum + inventory.possessionsOf(id).length, 0);
        expect(carriedTotal).toBeGreaterThan(0);
    }, 30000);
});

// Action reachability (task 076/M3): the inverse of the dead-action scan — every authored action must be
// proposable by SOME runtime path, or it is dead data. Paths: a Brain hook that binds it directly, the social
// hook (interaction actions), free-time selection (continuous non-work/obligation with weight>0), a job work
// repertoire, or a pool/sequence child of a continuous action.
describe('action reachability (task 076/M3)', () => {
    const manifest = DEFAULT_ACTION_MANIFEST;
    // Actions a Brain hook proposes by id (see Brain.ts / SchoolOrchestrator.ts). Keep in sync with the hooks.
    const DIRECTLY_HOOKED = new Set([
        'attend_school',                                                    // schoolObligationHook
        'pocketed_small_object', 'grab', 'use_object', 'put_down', 'discard_object', // inventoryOpportunityHook
    ]);

    test('every action is reachable via some proposal path', () => {
        const childRefs = new Set<string>();
        for (const def of Object.values(manifest)) {
            const children = (def as { children?: { entries?: { action?: string }[]; steps?: { action?: string }[] } }).children;
            for (const entry of children?.entries ?? []) if (entry.action) childRefs.add(entry.action);
            for (const step of children?.steps ?? []) if (step.action) childRefs.add(step.action);
        }
        const jobRefs = new Set<string>();
        for (const job of Object.values(JOBS)) {
            const collect = (wa?: { continuous?: { action: string }[]; discrete?: { action: string }[] }) => {
                for (const entry of wa?.continuous ?? []) jobRefs.add(entry.action);
                for (const entry of wa?.discrete ?? []) jobRefs.add(entry.action);
            };
            collect((job as { workActions?: { continuous?: { action: string }[]; discrete?: { action: string }[] } }).workActions);
            for (const rank of (job as { ranks?: { workActions?: { continuous?: { action: string }[]; discrete?: { action: string }[] } }[] }).ranks ?? []) collect(rank.workActions);
        }

        const reachable = (id: string): boolean => {
            const def = manifest[id]!;
            if (DIRECTLY_HOOKED.has(id)) return true;
            if (def.interaction) return true; // socialOpportunityHook
            if (def.type === 'continuous' && def.category !== 'work' && def.category !== 'obligation' && (def.selection?.weight ?? 0) > 0) return true; // free-time
            if (jobRefs.has(id)) return true;
            if (childRefs.has(id)) return true;
            return false;
        };

        const dead = Object.keys(manifest).filter(id => !reachable(id)).sort();
        expect(dead).toEqual([]);
    });
});
