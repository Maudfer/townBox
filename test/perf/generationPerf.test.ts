// Deterministic operation-count profile of the generation spine (perf module).
//
// One metered run of the shared tick spine (game/execution/TickRunner — what the offline generator drives per
// step) over a fixed workload (fixed seed, fixed agents, fixed tick counts) does exactly the same WORK on
// every machine and every run. The util/perfMeter probes count that work — predicate evaluations, active-index
// scans, context builds, event rolls, cache misses, co-location queries — and we assert the totals match the
// committed baselines EXACTLY (no drift tolerance). Any change that makes a part of the sim do more (or less)
// work moves a count and fails the gate, forcing a conscious `PERF_UPDATE_BASELINES=1` re-baseline. The sum of
// these parts is the whole per-agent cost profile; a regression in any one of the 078/079 wins (unbounded
// instance scan, whole-pool invoke rebuild, doubled free-time selection, a broken cache) shows up here as an
// inflated count. The one thing counts can't see — a slower-per-operation regression — is guarded by the
// predicate-precompilation timing ratio in regressionGuards.test.ts.

import { gateCounts, formatCounts, UPDATE_BASELINES } from './perfHarness';
import ActionEngine from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick } from 'game/execution/TickRunner';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import SkillBook from 'game/skills/SkillBook';
import SkillProgression from 'game/skills/SkillProgression';

import { beginMeter, endMeter } from 'util/perfMeter';
import { TICKS_PER_YEAR } from 'util/time';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';


jest.setTimeout(120_000);

// Every ambient counter the spine is expected to touch. Seeded to 0 before the run so a counter that is
// SILENT at baseline (e.g. an invoke that scans 0 pool entries) but starts firing on a regression is caught —
// a brand-new counter with no baseline would otherwise slip through as "non-breaking new metric".
const EXPECTED_COUNTERS = [
    'predicate.evalCached',
    'action.activeLookup', 'action.scanWalked', 'action.contextBuild', 'action.objectQuery', 'action.objectQueryMiss',
    'event.roll', 'event.subjectEval', 'event.invokeScan',
    'brain.freeTimeCompute',
    'inv.contentsBuild', 'inv.carriedBuild',
    'world.peopleAt',
];

function gen(id: string, birthTick: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(people: GenPerson[], worldSeed = 21): PopulationState {
    return { worldSeed, people: Object.fromEntries(people.map(p => [p.id, p])), drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

// The full bootstrap spine over N agents: a warm-up window (untimed, to reach steady state) then a metered
// window whose operation counts we assert. Fresh engines every call. Returns the meter tally PLUS the
// post-run live-instance count (the task-078 pruning invariant — observable, no probe needed).
async function meteredRun(agents: number, warmupTicks: number, windowTicks: number): Promise<Record<string, number>> {
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
    const tickPlan = (tick: number) => ({
        engine, actionEngine: actions, brain, inventory, state, agentIds, tick,
        ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap' as const, world }, skillProgression: service,
    });

    for (let tick = 0; tick < warmupTicks; tick++) {
        await runTick(tickPlan(tick));
    }

    const meter = beginMeter();
    for (const label of EXPECTED_COUNTERS) {
        meter.tally[label] = 0; // seed: a counter that never fires still has an exact 0 baseline
    }
    for (let tick = warmupTicks; tick < warmupTicks + windowTicks; tick++) {
        await runTick(tickPlan(tick));
    }
    endMeter();

    return { ...meter.tally, 'action.instancesLive': Object.keys(actions.getState().instances).length };
}

describe('generation perf — deterministic operation-count gate', () => {
    it('every counted part of the spine matches its exact baseline', async () => {
        const measured = await meteredRun(40, 24, 72);

        const results = gateCounts(measured);
        const mode = UPDATE_BASELINES ? 'BASELINES UPDATED' : 'exact-match (deterministic; any delta is a regression)';
        console.info(`[generation perf] operation counts · ${mode}\n${formatCounts(results)}`);

        const regressed = results.filter(r => r.regressed)
            .map(r => `${r.label} (${r.baseline} → ${r.value === null ? 'gone' : r.value})`);
        expect(regressed).toEqual([]);
    });

    it('the counts are deterministic (two identical runs produce identical tallies)', async () => {
        // Guards the whole approach: if any non-determinism (a Date.now, an unseeded RNG, Map-order-dependent
        // work) crept into a counted path, two runs would diverge and this fails before a flaky baseline can.
        const a = await meteredRun(40, 24, 24);
        const b = await meteredRun(40, 24, 24);
        expect(a).toEqual(b);
    });
});
