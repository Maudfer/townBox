import Brain, { BrainDeps, JobFacts } from '../src/app/game/Brain';
import ActionEngine from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from '../src/app/game/Inventory';
import { jobOrchestratorHook } from '../src/app/game/JobOrchestrator';

import { ActionManifest } from '../src/types/Action';
import { TickResult, ActionLogEntry } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';

// The Job Orchestrator (task 047): the job-context action source — continuous rotation, the on-duty discrete
// pool (chance/cooldown/interleave), shift-end completion requests, and employer-owned outputs landing in
// business inventory. Brain arbitrates; the orchestrator only proposes.

const TPY = 8640;

function pool(): PopulationState {
    const people: Record<string, GenPerson> = {
        a: { id: 'a', firstName: 'a', familyName: 'F', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
    };
    return { worldSeed: 91, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

// A crafting job: the continuous work action produces employer-owned widgets via a consequence.
const CRAFT_ACTIONS: ActionManifest = {
    assembling_widgets: { label: 'Assembling widgets', type: 'continuous', category: 'work' },
    inspecting_parts: { label: 'Inspecting parts', type: 'continuous', category: 'work' },
    stamped_a_widget: {
        label: 'Stamped a widget', type: 'discrete', category: 'work',
        consequences: [{ op: 'createObject', archetype: 'toy_car', owner: 'employer', container: 'possessions' }],
    },
    grumbled: { label: 'Grumbled', type: 'discrete', category: 'work' },
} as unknown as ActionManifest;

const CRAFT_JOB: JobFacts = {
    shiftStart: 8 * 60, shiftEnd: 16 * 60, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workplaceKey: '7-7',
    continuousActions: [{ action: 'assembling_widgets', chancePerTick: 3 }, { action: 'inspecting_parts', chancePerTick: 1 }],
    discreteActions: [
        { action: 'stamped_a_widget', chancePerTick: 0.8, maxPerTick: 2 },
        { action: 'grumbled', chancePerTick: 0.8, cooldownTicks: 3 },
    ],
};

function harness() {
    const engine = new EventEngine();
    const actions = new ActionEngine(CRAFT_ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const makeDeps = (tick: number): BrainDeps => ({
        state: pool(), tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory, jobOf: () => CRAFT_JOB, employerKeyOf: () => CRAFT_JOB.workplaceKey,
    });
    return { engine, actions, brain, inventory, makeDeps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('continuous rotation', () => {
    test('the on-shift proposal picks deterministically by weight and starts at the workplace', () => {
        const { brain, makeDeps } = harness();
        const intents = jobOrchestratorHook.propose({ personId: 'a', deps: makeDeps(10), brain });
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({ sourceHook: 'jobOrchestrator', necessity: 'required', mayInterrupt: true, locationOverride: 'building:7-7' });
        // Deterministic: same tick → same pick.
        expect(jobOrchestratorHook.propose({ personId: 'a', deps: makeDeps(10), brain })[0]!.actionId).toBe(intents[0]!.actionId);

        // Over many shift starts the rotation visits both activities, biased toward the heavier weight.
        const picks = { assembling_widgets: 0, inspecting_parts: 0 };
        for (let day = 0; day < 40; day++) {
            const tick = day * 24 + 10;
            const pick = jobOrchestratorHook.propose({ personId: 'a', deps: makeDeps(tick), brain })[0]?.actionId as keyof typeof picks | undefined;
            if (pick) picks[pick] += 1;
        }
        expect(picks.assembling_widgets).toBeGreaterThan(picks.inspecting_parts);
        expect(picks.inspecting_parts).toBeGreaterThan(0);
    });

    test('off shift → no proposals; still working past shift end → completion request (interrupt)', () => {
        const { brain, actions, makeDeps } = harness();
        expect(jobOrchestratorHook.propose({ personId: 'a', deps: makeDeps(20), brain })).toEqual([]); // 20:00 off

        // Start work, then cross the shift end: the hook interrupts.
        brain.processTick(['a'], makeDeps(10), [], result());
        expect(brain.statusOf('a').status).toBe('working');
        jobOrchestratorHook.propose({ personId: 'a', deps: makeDeps(16), brain }); // 16:00 = shift over
        expect(brain.statusOf('a').status).not.toBe('working');
        const interrupted = actions.getState();
        expect(Object.values(interrupted.instances).some(instance => instance.outcome === 'interrupted')).toBe(true);
    });
});

describe('the on-duty discrete pool', () => {
    test('proposals roll per tick, respect cooldowns, and interleave; Brain executes them as flavor', () => {
        const { engine, brain, makeDeps } = harness();
        brain.processTick(['a'], makeDeps(9), [], result()); // start the shift

        for (let tick = 10; tick <= 15; tick++) {
            brain.processTick(['a'], makeDeps(tick), [], result());
        }
        const performed = engine.getPersonLog('a')
            .filter((e): e is ActionLogEntry => e.kind === 'action' && e.lifecycle === 'performed')
            .map(e => ({ defId: e.defId, tick: e.tick, causationId: e.causationId }));

        // Widgets get stamped (high chance, 2 slots); grumbles are spaced by the 3-tick cooldown.
        expect(performed.filter(p => p.defId === 'stamped_a_widget').length).toBeGreaterThanOrEqual(3);
        const grumbles = performed.filter(p => p.defId === 'grumbled').map(p => p.tick);
        for (let i = 1; i < grumbles.length; i++) {
            expect(grumbles[i]! - grumbles[i - 1]!).toBeGreaterThanOrEqual(3);
        }
        // Flavor chains to the running work action's start entry.
        const workStart = engine.getPersonLog('a').filter((e): e is ActionLogEntry => e.kind === 'action').find(e => e.lifecycle === 'started')!;
        expect(performed[0]!.causationId).toBe(workStart.seq);
        // The person stays WORKING throughout — discrete flavor never displaces the continuous activity.
        expect(brain.statusOf('a').status).toBe('working');
    });

    test('employer-owned outputs land in the business inventory view', () => {
        const { brain, inventory, makeDeps } = harness();
        brain.processTick(['a'], makeDeps(9), [], result());
        for (let tick = 10; tick <= 14; tick++) {
            brain.processTick(['a'], makeDeps(tick), [], result());
        }
        const businessStock = inventory.instancesOwnedBy({ kind: 'business', key: '7-7' });
        expect(businessStock.length).toBeGreaterThan(0);
        expect(businessStock.every(instance => instance.archetypeId === 'toy_car')).toBe(true);
        // The worker carries them (business-owned, person-carried — 044's ownership/containment split).
        expect(inventory.possessionsOf('a').some(instance => instance.archetypeId === 'toy_car')).toBe(true);
    });
});
