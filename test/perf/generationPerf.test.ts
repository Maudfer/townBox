// Aggregate per-agent / per-phase cost view of the generation spine (perf module).
//
// One profiled run of the shared tick spine (game/execution/TickRunner — what the offline generator drives per
// step) yields, via the task-079 SubProfiler, a per-phase / per-hook / per-advance-sub-phase breakdown. We turn
// each bucket into its SHARE OF A TICK — bucket / (total − bucket) — and take the median over several fresh
// runs. That fraction is dimensionless and JITTER-IMMUNE: numerator and denominator are measured in the same
// run, so a machine slowdown (or the wild scheduler jitter of a 2-vCPU CI runner) scales both and cancels;
// a component that gets slower raises its OWN share (the denominator excludes it, so no absorption → real
// sensitivity). A regression that shifts the profile trips the gate.
//
// The gate ENFORCES only with PERF_ENFORCE=1 (the CI job, once its baselines are CI-measured — fractions still
// drift ~10% across microarchitectures, so a dev baseline mustn't gate CI); otherwise it LOGS the table so the
// trend is watchable. The TIGHT, flake-free, machine-independent protection of the specific 078/079 wins lives
// in regressionGuards.test.ts (deterministic + within-run-ratio checks, always enforced). Re-baseline: see
// perfHarness.

import { gateAgainstBaselines, formatResults, FRACTION_TOLERANCE, UPDATE_BASELINES, ENFORCE_COST_GATE } from './perfHarness';
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


function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

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

// The dominant, reliably-fired buckets we turn into per-tick fractions (near-zero noise buckets are excluded —
// a % of noise is noise). `total` is the reference (the whole tick), not itself a gated fraction.
const GATED_BUCKETS = [
    'phase.actions', 'phase.events', 'phase.brain', 'brain.resolveIntents',
    'brain.wokeUp', 'brain.idleFallback', 'brain.socialOpportunity', 'brain.inventoryOpportunity',
    'brain.freeTime:loop', 'brain.freeTime:requirements', 'brain.freeTime:modifiers',
    'advance.durationFinish', 'advance.finish:onCompleteEvent', 'advance.invoke:attempt', 'advance.pool',
];

describe('generation perf — per-phase cost-fraction gates', () => {
    it('no component grows its share of a tick beyond tolerance (jitter-immune fractions)', () => {
        // R fresh profiled runs; each bucket → its share of a tick, bucket / (total − bucket). Median over R
        // resists both a run where the bucket itself was preempted (its fraction spikes) and one where other
        // buckets were (its fraction dips). Fractions are within-run ratios, so runner jitter cancels.
        const R = 7;
        const perRunFractions: Record<string, number[]> = Object.fromEntries(GATED_BUCKETS.map(l => [l, []]));
        for (let k = 0; k < R; k++) {
            const buckets = profiledRun(40, 24, 72);
            const total = buckets['total']!;
            for (const label of GATED_BUCKETS) {
                const b = buckets[label];
                if (b !== undefined && total - b > 0) {
                    perRunFractions[label]!.push(b / (total - b));
                }
            }
        }
        const measured: Record<string, number> = {};
        for (const label of GATED_BUCKETS) {
            if (perRunFractions[label]!.length > 0) {
                measured[label] = median(perRunFractions[label]!);
            }
        }

        const results = gateAgainstBaselines(measured);
        const mode = UPDATE_BASELINES ? 'BASELINES UPDATED' : ENFORCE_COST_GATE ? `gating @${(FRACTION_TOLERANCE * 100).toFixed(0)}%` : 'LOG-ONLY (enforced on CI once baselines are CI-measured)';
        console.info(`[generation perf] per-tick cost fractions · ${mode}\n${formatResults(results)}`);

        // Enforced only when the baselines match the running machine class (PERF_ENFORCE=1 on the CI job);
        // elsewhere it's advisory, so a dev box's fractions don't gate against CI-measured baselines.
        const regressed = results.filter(r => r.regressed).map(r => `${r.label} (+${(((r.ratio ?? 1) - 1) * 100).toFixed(1)}%)`);
        if (ENFORCE_COST_GATE) {
            expect(regressed).toEqual([]);
        }
    });
});
