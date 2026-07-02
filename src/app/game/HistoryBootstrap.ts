import { isAliveAt } from 'util/kinship';
import { PopulationState, PersonId } from 'types/Genealogy';
import { EventHistoryTable, EventManifest } from 'types/LifeEvent';

import EventEngine, { DEFAULT_EVENT_MANIFEST } from 'game/EventEngine';

import bootstrapConfig from 'json/bootstrap.json';

// Pre-game history bootstrap (task 036). Runs the detailed Engine B resolver (EventEngine) over the *whole
// living genealogy pool* for a deep span ending at the present (tick 0), so that when the player places houses
// the drawn people already carry real life histories (had_sex/marriage/pregnancy/illness/… records) instead of
// the empty-history cold start that 013 accepted. Generation (game/Population.generatePopulation) still lays
// down the deterministic family-tree backbone; this layers detailed recent life on top of it.
//
// It is a deterministic pure function of the pool + seed (the engine forks its RNG per tick from the world
// seed), so the same world always bootstraps identically and the result serializes (pool + event history) into
// the save — loads never re-run it. No materialized-world adapters are supplied, so employment/housing/skill
// events (which need the on-map economy) stay live-only; the bootstrap covers the pool-intrinsic events.
//
// Cost note: the engine's `marriage` role search is O(agents) per single adult per day, so the whole-pool span
// is the heavy knob (json/bootstrap.json `years`). It is meant to run off the main thread on a loading screen
// (see game/bootstrap.worker.ts); `stepDays` can coarsen the cadence to trade history granularity for speed.

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
}

// The manifest the bootstrap runs: the default life events MINUS any whose non-subject roles need a candidate
// `where` search (currently `marriage`). Those are O(agents) per eligible subject — ruinous over the whole
// living pool — and unnecessary here, since generation (generatePopulation) already lays down the marriage/
// partnership backbone. Everything else resolves in O(1) (subject-only or `bind` roles: had_sex, pregnancy,
// birth, death, divorce, illness/injury/recovery, friendship), keeping the bootstrap linear in pool × days.
function bootstrapManifest(): EventManifest {
    const manifest: EventManifest = {};
    for (const [id, definition] of Object.entries(DEFAULT_EVENT_MANIFEST)) {
        const hasSearchRole = Object.entries(definition.roles).some(([role, spec]) => role !== 'subject' && !!spec.where);
        if (!hasSearchRole) {
            manifest[id] = definition;
        }
    }
    return manifest;
}

// Runs the bootstrap, mutating `state` (engine-driven births add people, deaths set deathTicks) and returning
// the resulting state + the accumulated per-person event history. `onProgress` is called once per simulated
// year so a loading screen can report progress.
export function bootstrapHistory(
    state: PopulationState,
    params: BootstrapParams = DEFAULT_BOOTSTRAP_PARAMS,
    onProgress?: (progress: BootstrapProgress) => void
): BootstrapResult {
    const engine = new EventEngine(bootstrapManifest());
    const tpy = params.ticksPerYear;
    const step = Math.max(1, Math.floor(params.stepDays));

    if (!params.enabled || params.years <= 0 || tpy <= 0) {
        return { state, history: engine.getHistory() };
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

        engine.simulateDay(state, agentIds, tick, tpy, {}, step);

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

    return { state, history: engine.getHistory() };
}
