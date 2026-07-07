import { isAliveAt } from 'util/kinship';
import { TICKS_PER_DAY } from 'util/time';
import { PopulationState, PersonId } from 'types/Genealogy';
import { EventHistoryTable, EventLogTable } from 'types/LifeEvent';

import EventEngine from 'game/EventEngine';
import ActionEngine from 'game/ActionEngine';
import BootstrapWorld from 'game/BootstrapWorld';
import { runTick } from 'game/TickRunner';

import bootstrapConfig from 'json/bootstrap.json';

// Pre-game history bootstrap (task 036). Runs the detailed Engine B resolver (EventEngine) over the *whole
// living genealogy pool* for a deep span ending at the present (tick 0), so that when the player places houses
// the drawn people already carry real life histories (had_sex/marriage/pregnancy/illness/… records) instead of
// the empty-history cold start that 013 accepted. Generation (game/Population.generatePopulation) still lays
// down the deterministic family-tree backbone; this layers detailed recent life on top of it.
//
// It is a deterministic function of the pool + seed (the engine forks its RNG per tick from the world seed),
// so the same world always bootstraps identically and the result serializes (pool + event history + log) into
// the save — loads never re-run it. Since task 040 it runs through the SAME shared TickRunner lifecycle as
// live play, under the `bootstrap` execution context (BootstrapWorld): the full event manifest, no filtering.
// No markets are supplied (no on-map economy exists off-map), so employment/housing/skill/money events stay
// ineligible by data; everything pool-intrinsic — marriage included — runs at full fidelity.
//
// Cost note: candidate role searches (marriage) are paid only on successful probability rolls (task 040's
// roll-before-resolve), so the whole-pool span (json/bootstrap.json `years`) is the heavy knob. It is meant
// to run off the main thread on a loading screen (see game/bootstrap.worker.ts); `stepDays` coarsens the
// cadence to trade history granularity for speed.

export interface BootstrapParams {
    enabled: boolean;
    years: number;      // how many in-game years of detailed history to simulate before the present
    ticksPerYear: number;
    stepDays: number;   // engine cadence in days (1 = every day; larger = faster, coarser history)
}

export const DEFAULT_BOOTSTRAP_PARAMS: BootstrapParams = bootstrapConfig as BootstrapParams;

export interface BootstrapProgress {
    yearsDone: number;
    yearsTotal: number;
    living: number;
}

export interface BootstrapResult {
    state: PopulationState;
    history: EventHistoryTable;
    log: EventLogTable;
    logSeq: number;
}

// Runs the bootstrap, mutating `state` (engine-driven births add people, deaths set deathTicks) and returning
// the resulting state + the accumulated per-person event history. `onProgress` is called once per simulated
// year so a loading screen can report progress.
export async function bootstrapHistory(
    state: PopulationState,
    params: BootstrapParams = DEFAULT_BOOTSTRAP_PARAMS,
    onProgress?: (progress: BootstrapProgress) => void
): Promise<BootstrapResult> {
    // The FULL default manifest (task 040): the pre-boundary bootstrap filtered out candidate-search events
    // (marriage) because role searches ran before the probability roll — O(agents) per eligible subject per
    // step. The engine now rolls first and searches only on success, so the whole manifest is affordable
    // pool-wide and live/bootstrap run identical event sets. Markets stay absent (no on-map economy exists
    // off-map), so employment/housing/skill/money events stay ineligible — by data, not by filtering.
    const engine = new EventEngine();
    // Symmetric with live play (task 043): the Action engine runs in the same lifecycle. Nothing starts
    // actions during the bootstrap yet (Brain, 046), but the spine is identical in both modes.
    const actionEngine = new ActionEngine(undefined, engine.getLifeLog());
    const world = new BootstrapWorld();
    const tpy = params.ticksPerYear;
    // `stepDays` is authored in days (author-friendly); the engine steps in hour ticks (task 040).
    const step = Math.max(1, Math.floor(params.stepDays)) * TICKS_PER_DAY;

    if (!params.enabled || params.years <= 0 || tpy <= 0) {
        return { state, history: engine.getHistory(), log: engine.getLog(), logSeq: engine.getNextLogSeq() };
    }

    const startTick = -Math.round(params.years * tpy);
    let lastReportedYear = -1;

    for (let tick = startTick; tick < 0; tick += step) {
        const agentIds: PersonId[] = [];
        for (const person of Object.values(state.people)) {
            if (isAliveAt(person, tick)) {
                agentIds.push(person.id);
            }
        }

        // The same shared lifecycle live play runs (TickRunner), under the `bootstrap` execution context.
        await runTick({ engine, actionEngine, state, agentIds, tick, ticksPerYear: tpy, ctx: { mode: 'bootstrap', world }, ticksPerStep: step });

        if (onProgress) {
            const yearsDone = Math.floor((tick - startTick) / tpy);
            if (yearsDone !== lastReportedYear) {
                lastReportedYear = yearsDone;
                onProgress({ yearsDone, yearsTotal: params.years, living: agentIds.length });
            }
        }
    }

    // The detailed engine has authoritatively simulated the span up to the present, so the coarse live pool sim
    // (Population.simulate) must not re-run those years — anchor it at the present year. (Retiring the coarse
    // live path entirely is the documented one-fidelity follow-up; it needs the marriage role-search optimised
    // to run over the whole pool each day during play.)
    state.lastSimulatedYear = 0;

    return { state, history: engine.getHistory(), log: engine.getLog(), logSeq: engine.getNextLogSeq() };
}
