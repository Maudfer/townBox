// Aggregate per-agent / per-phase cost view of the generation spine (perf module).
//
// One profiled run of the shared tick spine (game/execution/TickRunner — what the offline generator drives
// per step) yields, via the task-079 SubProfiler, a per-phase / per-hook / per-advance-sub-phase breakdown.
// Averaged over thousands of agent-steps and taken as the min over several fresh runs, these costs are far
// steadier than a micro-bench. We normalize each against an in-run calibration (perfHarness — so a uniform
// machine slowdown cancels), LOG the full table every run (watch the trend at a glance), and fail if any
// bucket exceeds its committed baseline by more than COST_TOLERANCE.
//
// This is the broad net: it covers as many moving parts of a step as the profiler exposes, so the sum stands
// in for benchmarking the whole flow. The TIGHT, 5%-strict, flake-free protection of the specific 078/079
// wins (agent-list gating, the caches, predicate precompilation, instance pruning) lives in
// regressionGuards.test.ts as deterministic + within-run-ratio checks. Re-baseline: see perfHarness.

import ActionEngine from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick, TickProfiler } from 'game/execution/TickRunner';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import SkillBook from 'game/skills/SkillBook';
import SkillProgression from 'game/skills/SkillProgression';

import { TICKS_PER_YEAR } from 'util/time';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';

import { calibrationCostPerUnit, gateNormalized, formatResults, COST_TOLERANCE, UPDATE_BASELINES, ENFORCE_COST_GATE } from './perfHarness';

jest.setTimeout(120_000);

function gen(id: string, birthTick: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(people: GenPerson[], worldSeed = 21): PopulationState {
    return { worldSeed, people: Object.fromEntries(people.map(p => [p.id, p])), drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

// The full bootstrap spine over N agents, exercised for a warm-up window then a measured window; returns each
// profiler bucket's per-agent-step ms. Fresh engines every call so min-of-R across calls is a clean signal.
function profiledRun(agents: number, warmupTicks: number, windowTicks: number): Record<string, number> {
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const people: GenPerson[] = [];
    for (let i = 0; i < agents; i++) {
        people.push(gen(`p${i}`, -(18 + (i % 45)) * TICKS_PER_YEAR)); // a spread of ages: children, adults, elderly
        world.register(`p${i}`);
    }
    const state = pool(people);
    const skillBook = new SkillBook();
    const service = new SkillProgression(skillBook);
    const agentIds = people.map(p => p.id);
    const tickPlan = (tick: number, profiler?: TickProfiler) => ({
        engine, actionEngine: actions, brain, inventory, state, agentIds, tick,
        ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap' as const, world }, skillProgression: service,
        ...(profiler ? { profiler } : {}),
    });

    for (let tick = 0; tick < warmupTicks; tick++) {
        void runTick(tickPlan(tick)); // runTick resolves synchronously here (no onCommitted → no await point)
    }
    const profiler: TickProfiler = { actions: 0, events: 0, progression: 0, brain: 0, sub: { brainHooks: {}, brainResolve: 0, actionsAdvance: {} } };
    for (let tick = warmupTicks; tick < warmupTicks + windowTicks; tick++) {
        void runTick(tickPlan(tick, profiler));
    }

    const agentSteps = agents * windowTicks;
    const sub = profiler.sub!;
    const out: Record<string, number> = {
        'total': (profiler.actions + profiler.events + profiler.progression + profiler.brain) / agentSteps,
        'phase.actions': profiler.actions / agentSteps,
        'phase.events': profiler.events / agentSteps,
        'phase.brain': profiler.brain / agentSteps,
        'brain.resolveIntents': sub.brainResolve / agentSteps,
    };
    for (const [k, v] of Object.entries(sub.brainHooks)) {
        out[`brain.${k}`] = v / agentSteps;
    }
    for (const [k, v] of Object.entries(sub.actionsAdvance)) {
        out[`advance.${k}`] = v / agentSteps;
    }
    return out;
}

// The dominant, reliably-fired buckets we gate (near-zero noise buckets are excluded — 20% of noise is noise).
const GATED_BUCKETS = [
    'total', 'phase.actions', 'phase.events', 'phase.brain', 'brain.resolveIntents',
    'brain.wokeUp', 'brain.idleFallback', 'brain.socialOpportunity', 'brain.inventoryOpportunity',
    'brain.freeTime:loop', 'brain.freeTime:requirements', 'brain.freeTime:modifiers',
    'advance.durationFinish', 'advance.finish:onCompleteEvent', 'advance.invoke:attempt', 'advance.pool',
];

describe('generation perf — aggregate per-agent / per-phase cost gates', () => {
    it('no profiled bucket exceeds its baseline beyond the noise tolerance (normalized)', () => {
        // Interleaved self-normalization: each of R runs measures its profiled buckets AND a calibration right
        // after, and normalizes by ITS OWN calibration — so a transient machine-load spike during a run
        // inflates both and cancels in the ratio. We then take the MIN ratio over R (the least-loaded run).
        // This is what makes the gate survive noisy shared runners (and a busy dev box).
        const R = 6;
        const perRun: Record<string, number>[] = [];
        const calibrations: number[] = [];
        for (let k = 0; k < R; k++) {
            const buckets = profiledRun(40, 24, 72);
            const calibration = calibrationCostPerUnit();
            calibrations.push(calibration);
            const norm: Record<string, number> = {};
            for (const label of GATED_BUCKETS) {
                if (Number.isFinite(buckets[label])) {
                    norm[label] = buckets[label]! / calibration;
                }
            }
            perRun.push(norm);
        }
        const measured: Record<string, number> = {};
        for (const label of GATED_BUCKETS) {
            const vals = perRun.map(n => n[label]).filter((v): v is number => v !== undefined);
            if (vals.length > 0) {
                measured[label] = Math.min(...vals);
            }
        }

        const results = gateNormalized(measured);
        const calibRange = `${Math.min(...calibrations).toExponential(2)}–${Math.max(...calibrations).toExponential(2)}`;
        const mode = UPDATE_BASELINES ? 'BASELINES UPDATED' : ENFORCE_COST_GATE ? `gating @${(COST_TOLERANCE * 100).toFixed(0)}%` : 'LOG-ONLY (set PERF_ENFORCE=1 + run --runInBand to gate)';
        console.info(`[generation perf] calibration ${calibRange} ms/unit · ${mode}\n${formatResults(results)}`);

        // Only fail in an isolated, enforced run (the CI `perf` job); under a parallel `npm test` this is
        // advisory (the memory-bound sim diverges from the compute calibration under sibling-worker load).
        const regressed = results.filter(r => r.regressed).map(r => `${r.label} (+${(((r.ratio ?? 1) - 1) * 100).toFixed(1)}%)`);
        if (ENFORCE_COST_GATE) {
            expect(regressed).toEqual([]);
        }
    });
});
