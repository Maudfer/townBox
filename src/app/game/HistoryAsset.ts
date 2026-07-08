// The offline history-asset generator (task 055). Runs the deep, no-compromise simulation ONCE, offline, and
// captures the result as a versioned data asset the game later selects a window from (game/HistoryAssetSelection.ts).
// It reuses the SAME shared per-tick lifecycle (game/TickRunner) under the `bootstrap` execution context that
// live play and the retired 036 loading-screen bootstrap ran — the only difference from live is that location
// transitions resolve immediately through the non-visual WorldAdapter (BootstrapWorld). So the asset carries
// real, engine-produced life histories (birth/death/marriage/pregnancy/illness/education/social…) rather than
// the empty-history cold start.
//
// Three phases (§2.1): Phase 0 founders (game/Population.createFounders); Phase 1 warm-up — grow forward from
// the founders until the living count first reaches `recordThreshold`, discarding warm-up-only dead as
// scaffolding; Phase 2 recording — from that epoch (t0) simulate `recordYears` more, preserving everyone
// (living, born-after, and died-after — completed life stories are the richest content).
//
// Two centuries-scale concerns are handled here: an INCREMENTAL living index (a live Set updated from each
// tick's births/deaths instead of an O(pool) filter every step — the pool grows to include every dead person
// ever), and a soft CARRYING CAPACITY (a fertility throttle scaling the `pregnancy` hazard toward replacement
// as the living count approaches the target band, via EventEngine.setProbabilityScale — determinism-safe: the
// roll stays unconditional, only the threshold moves). Both are pure functions of deterministic state, so the
// same (seed, params) yields a byte-identical asset.

import EventEngine from 'game/EventEngine';
import ActionEngine from 'game/ActionEngine';
import Brain from 'game/Brain';
import BootstrapWorld from 'game/BootstrapWorld';
import SkillBook from 'game/SkillBook';
import LogicalWorld, { LogicalWorldConfig } from 'game/LogicalWorld';
import { runTick } from 'game/TickRunner';
import { createFounders, DEFAULT_FOUNDER_PARAMS } from 'game/Population';

import { TICKS_PER_DAY } from 'util/time';
import { Predicate } from 'util/predicate';
import { ageAt } from 'util/kinship';

import { PopulationState, PersonId } from 'types/Genealogy';
import { EventHistoryTable, EventLogTable, EventManifest, ScheduleState, TickResult } from 'types/LifeEvent';
import { WorldAdapter } from 'types/Execution';
import { SkillBookState } from 'types/Skill';
import { InventoryState } from 'types/Objects';

import eventsConfig from 'json/events.json';
import generatorConfig from 'json/historyGenerator.json';

const EVENT_MANIFEST = eventsConfig as unknown as EventManifest;

// The asset schema version — bump on shape changes (drives the load-time compatibility check, Part B).
export const HISTORY_ASSET_FORMAT_VERSION = 1;
// The generator version — bump when the sim/events change materially, so re-runs are distinguishable.
// 077.1: the logical-economy world (off-map schools/jobs/objects → the asset carries lived skills/possessions).
export const HISTORY_GENERATOR_VERSION = '077.1';

// The event whose hazard the carrying capacity throttles (its birth effect is the only fertility source).
const PREGNANCY_EVENT = 'pregnancy';

export interface CarryingCapacityConfig {
    enabled: boolean;
    soft: number;      // the target living band; fertility → replacement as the count approaches it
    steepness: number; // logistic steepness of the throttle
}

export interface GeneratorSafety {
    maxRuntimeMs: number; // 0 = disabled: stop recording early and still write a valid (shorter) asset
    maxPeople: number;    // 0 = disabled: cap on retained pool size
}

export interface HistoryGeneratorParams {
    seed: number;
    founderCount: number;
    recordThreshold: number; // living count that ends warm-up and sets the epoch t0
    recordYears: number;     // years of full-fidelity recording after t0
    ticksPerYear: number;
    daysPerStep: number;     // engine cadence in days (1 = daily; larger = faster, coarser)
    warmMarginYears: number; // Part B: window selection skips this shallow-ancestry span after t0
    maxWarmupYears: number;  // safety: abort warm-up if the threshold is never reached
    carryingCapacity: CarryingCapacityConfig;
    safety: GeneratorSafety;
    // The offline logical-economy world (task 077): when enabled, the generator runs logical schools/jobs/
    // objects off-map so the asset carries lived skills/careers-as-history/possessions (SkillBook + carried
    // Inventory). When disabled, the generator is the 055 pool-intrinsic spine (skills materialize at draw).
    logicalWorld: { enabled: boolean } & LogicalWorldConfig;
    // Whether the asset retains the low-level ACTION log entries (grab/use/discrete work flavor) in addition
    // to life EVENTS. Default false: the action engine + Brain still run every tick (so action-CAUSED events
    // still fire into the event history), but the per-tick action texture — which explodes the asset to GBs
    // over centuries and which the game regenerates live anyway — is dropped from the serialized log. Set true
    // only for small diagnostic runs.
    keepActionLog: boolean;
}

export const DEFAULT_GENERATOR_PARAMS: HistoryGeneratorParams = generatorConfig as HistoryGeneratorParams;

export interface HistoryAssetMeta {
    formatVersion: number;
    generatorVersion: string;
    seed: number;
    params: HistoryGeneratorParams;
    createdAt: string;
    gitCommit: string | null;
    epochTick: number; // t0 — the recording-start tick (asset-relative)
    endTick: number;   // last simulated tick
    ticksPerYear: number;
    stats: HistoryAssetStats;
}

export interface HistoryAssetStats {
    retainedPeople: number;
    livingAtEnd: number;
    births: number;
    deaths: number;
    medianHistoryLen: number;
    trajectory: { year: number; living: number }[]; // living count sampled per decade
    runtimeMs: number;
    rawBytes: number;        // filled in by the CLI after serialization
    compressedBytes: number; // filled in by the CLI after serialization
}

// The asset payload (pre-compression). Reuses the save's PopulationState + LifeEvent table shapes so the game
// consumes it with existing machinery.
export interface HistoryAsset {
    meta: HistoryAssetMeta;
    population: PopulationState;
    eventHistory: EventHistoryTable;
    eventLog: EventLogTable;
    eventLogSeq: number;
    eventSchedule: ScheduleState;
    // Lived skills + carried possessions (task 077). Present only when logicalWorld.enabled; Part B installs
    // them so drawn people arrive with real proficiency/possessions instead of synthesized-at-draw ones.
    skillBook?: SkillBookState;
    objects?: InventoryState;
}

export type GenerationPhase = 'warmup' | 'recording';

export interface GenerationProgress {
    phase: GenerationPhase;
    tick: number;
    yearsDone: number;   // years into the current phase
    living: number;
    retained: number;
}

// The set of event ids worth persisting in the asset's log: those that carry EFFECTS (the ~18 vital/
// demographic events — birth/death/marriage/illness/education/…) OR are referenced by a `hasEvent`
// requirement anywhere in the manifest (so requirement windowing stays correct at selection, e.g. pregnancy's
// "had_sex within N ticks"). The ~680 effect-free story-texture events are NOT persisted per-occurrence — they
// exist during generation (Brain/feed realism) but would explode the asset to GBs over centuries, are never
// read by any requirement, and the game regenerates them live. Computed once from the manifest.
export function loggableEventIds(manifest: EventManifest = EVENT_MANIFEST): Set<string> {
    const loggable = new Set<string>();
    const collectHasEvent = (predicate: Predicate | undefined): void => {
        if (!predicate) {
            return;
        }
        if ('all' in predicate) {
            predicate.all.forEach(collectHasEvent);
        } else if ('any' in predicate) {
            predicate.any.forEach(collectHasEvent);
        } else if ('not' in predicate) {
            collectHasEvent(predicate.not);
        } else if ('where' in predicate) {
            collectHasEvent(predicate.where);
        } else if ('hasEvent' in predicate) {
            loggable.add(predicate.hasEvent);
        }
    };
    for (const [id, definition] of Object.entries(manifest)) {
        if ((definition.effects?.length ?? 0) > 0) {
            loggable.add(id); // effect-bearing events are always worth persisting
        }
        for (const role of Object.values(definition.roles ?? {})) {
            collectHasEvent(role.where);
        }
    }
    return loggable;
}

// The soft carrying-capacity throttle: a logistic over living/soft that → 1 well below the band and → 0 as the
// count approaches/exceeds it. Pure (deterministic given the living count). Deaths are never throttled.
export function fertilityFactor(living: number, config: CarryingCapacityConfig): number {
    if (!config.enabled || config.soft <= 0) {
        return 1;
    }
    return 1 / (1 + Math.exp(config.steepness * (living - config.soft) / config.soft));
}

// Runs the full phased generation. Pure function of (params) apart from the wall-clock in `meta.createdAt` and
// the optional `gitCommit`/runtime measurements the caller injects. `onProgress` reports per simulated year.
export async function generateHistoryAsset(
    params: HistoryGeneratorParams = DEFAULT_GENERATOR_PARAMS,
    onProgress?: (progress: GenerationProgress) => void,
    gitCommit: string | null = null
): Promise<HistoryAsset> {
    const startedAt = Date.now();
    const tpy = params.ticksPerYear;
    const step = Math.max(1, Math.floor(params.daysPerStep)) * TICKS_PER_DAY;

    // Phase 0 — founders.
    const state = createFounders(params.seed, params.founderCount, { ...DEFAULT_FOUNDER_PARAMS, ticksPerYear: tpy });

    const engine = new EventEngine();
    const actionEngine = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actionEngine);

    // The logical-economy world (task 077) or the plain 055 spine. When enabled it owns homes/schools/jobs/
    // objects + a SkillBook, and drives DIRECT per-step skill accrual (runDaily); when disabled, skills
    // materialize at draw as in 055.
    const useLogical = params.logicalWorld.enabled;
    const skillBook = useLogical ? new SkillBook() : null;
    const logical = useLogical ? new LogicalWorld(params.seed, params.logicalWorld) : null;
    const bootstrap = logical ? null : new BootstrapWorld();
    const world: WorldAdapter = logical ?? bootstrap!;
    if (logical && skillBook) {
        logical.buildSchools(params.recordThreshold);
        logical.buildJobs(skillBook, params.recordThreshold);
    }

    // Incremental living index — updated from each tick's births/deaths, never re-filtered over the pool.
    const living = new Set<PersonId>();
    const enter = (personId: PersonId, tick: number): void => {
        if (logical && skillBook) {
            const person = state.people[personId];
            const age = person ? ageAt(person, tick, tpy) : 0;
            logical.onEnter(personId, age, person?.birthTick ?? 0, tick, skillBook, state.people);
        } else {
            bootstrap!.register(personId);
        }
    };
    for (const person of Object.values(state.people)) {
        living.add(person.id);
        enter(person.id, 0);
    }

    // Carrying capacity: the engine scales the pregnancy hazard by a factor that reflects the CURRENT living
    // count each step (the closure reads `livingCount`, updated below). Identity for every other event.
    let livingCount = living.size;
    engine.setProbabilityScale(id => (id === PREGNANCY_EVENT ? fertilityFactor(livingCount, params.carryingCapacity) : 1));

    let births = 0;
    let deaths = 0;
    let epochTick: number | null = null;
    const trajectory: { year: number; living: number }[] = [];
    let lastDecadeSampled = -1;
    let lastReportedYear = -1;

    const applyResult = (result: TickResult, tick: number): void => {
        for (const birth of result.born) {
            living.add(birth.id);
            enter(birth.id, tick);
            births++;
        }
        for (const id of result.died) {
            living.delete(id);
            logical?.onDeath(id);
            deaths++;
        }
    };

    let tick = 0;
    for (;;) {
        // Set the epoch the first time the living count reaches the threshold, then keep recording forward.
        if (epochTick === null && living.size >= params.recordThreshold) {
            epochTick = tick;
        }
        const inRecording = epochTick !== null;

        // Termination: recording is done after recordYears; warm-up aborts at the safety ceiling.
        if (inRecording && tick - epochTick! >= Math.round(params.recordYears * tpy)) {
            break;
        }
        if (!inRecording && tick >= Math.round(params.maxWarmupYears * tpy)) {
            break; // threshold never reached — stop and write whatever grew (a valid, shorter asset)
        }
        if (params.safety.maxRuntimeMs > 0 && Date.now() - startedAt > params.safety.maxRuntimeMs) {
            break;
        }
        if (params.safety.maxPeople > 0 && Object.keys(state.people).length >= params.safety.maxPeople) {
            break;
        }

        livingCount = living.size;
        const agentIds = [...living].sort();
        const facts = logical && skillBook ? logical.tickFacts(skillBook, tick) : null;
        const result = await runTick({
            engine,
            actionEngine,
            brain,
            state,
            agentIds,
            tick,
            ticksPerYear: tpy,
            ctx: facts ? facts.ctx : { mode: 'bootstrap', world },
            ...(facts ? { inventory: facts.inventory } : {}),
            ticksPerStep: step,
        });
        applyResult(result, tick);
        // Direct per-step progression accrual (school + work days + promotion) — stepping-tolerant, so it
        // works at the generator's coarse cadence where the intra-day shift obligation would not (task 077 §3).
        if (logical && skillBook) {
            logical.runDaily(state, tick, tick + step, tpy, skillBook, engine);
        }

        // Per-decade trajectory sample + per-year progress.
        const phase: GenerationPhase = inRecording ? 'recording' : 'warmup';
        const phaseStartTick = inRecording ? epochTick! : 0;
        const yearsDone = Math.floor((tick - phaseStartTick) / tpy);
        const decade = Math.floor(tick / tpy / 10);
        if (decade !== lastDecadeSampled) {
            lastDecadeSampled = decade;
            trajectory.push({ year: Math.floor(tick / tpy), living: living.size });
        }
        if (onProgress && yearsDone !== lastReportedYear) {
            lastReportedYear = yearsDone;
            onProgress({ phase, tick, yearsDone, living: living.size, retained: Object.keys(state.people).length });
        }

        tick += step;
    }
    engine.setProbabilityScale(null);

    const endTick = tick;
    const epoch = epochTick ?? endTick; // no threshold reached: nothing is "warm-up dead" to prune

    // Prune warm-up-only dead: keep everyone alive at the end OR who died at/after the epoch; drop the rest
    // (the shallow-history early generations). Their pool records, history, and logs all go.
    const history = engine.getHistory();
    let log = engine.getLog();
    for (const [id, person] of Object.entries(state.people)) {
        if (person.deathTick === null || person.deathTick >= epoch) {
            continue;
        }
        delete state.people[id];
        delete history[id];
        delete log[id];
    }
    // Slim the serialized log to the loggable events (effect-bearing ∪ requirement-referenced), which keeps
    // the demographic/health/queried history correct and windowable while dropping the effect-free texture
    // flood. keepActionLog additionally retains the low-level action entries (small diagnostic runs only).
    const loggable = loggableEventIds();
    const slim: EventLogTable = {};
    for (const [id, entries] of Object.entries(log)) {
        const kept = entries.filter(entry =>
            (entry.kind === 'event' && loggable.has(entry.defId)) || (params.keepActionLog && entry.kind === 'action'));
        if (kept.length > 0) {
            slim[id] = kept;
        }
    }
    log = slim;
    // Filter the aggregate history to the same loggable set so it stays bounded (Part B rebuilds the
    // authoritative history from the windowed log; this is retained for stats/inspection).
    for (const record of Object.values(history)) {
        for (const eventId of Object.keys(record)) {
            if (!loggable.has(eventId)) {
                delete record[eventId];
            }
        }
    }

    const retainedIds = Object.keys(state.people);
    let livingAtEnd = 0;
    for (const id of retainedIds) {
        if (living.has(id)) {
            livingAtEnd++;
        }
    }

    const meta: HistoryAssetMeta = {
        formatVersion: HISTORY_ASSET_FORMAT_VERSION,
        generatorVersion: HISTORY_GENERATOR_VERSION,
        seed: params.seed,
        params,
        createdAt: new Date().toISOString(),
        gitCommit,
        epochTick: epoch,
        endTick,
        ticksPerYear: tpy,
        stats: {
            retainedPeople: retainedIds.length,
            livingAtEnd,
            births,
            deaths,
            medianHistoryLen: medianLogLength(log, retainedIds),
            trajectory,
            runtimeMs: Date.now() - startedAt,
            rawBytes: 0,
            compressedBytes: 0,
        },
    };

    const asset: HistoryAsset = {
        meta,
        population: state,
        eventHistory: history,
        eventLog: log,
        eventLogSeq: engine.getNextLogSeq(),
        eventSchedule: engine.getScheduleState(),
    };

    // Carry lived skills + carried possessions (task 077), filtered to retained people (warm-up dead are gone).
    if (logical && skillBook) {
        const retainedSet = new Set(retainedIds);
        const fullSkills = skillBook.getState();
        const records: SkillBookState['records'] = {};
        const initialized: SkillBookState['initialized'] = {};
        for (const id of retainedIds) {
            if (fullSkills.records[id]) {
                records[id] = fullSkills.records[id]!;
            }
            if (fullSkills.initialized[id]) {
                initialized[id] = true;
            }
        }
        asset.skillBook = { records, initialized };
        asset.objects = logical.carriedInventoryState(retainedSet);
    }

    return asset;
}

function medianLogLength(log: EventLogTable, ids: string[]): number {
    const lengths = ids.map(id => (log[id]?.length ?? 0)).sort((a, b) => a - b);
    if (lengths.length === 0) {
        return 0;
    }
    const mid = Math.floor(lengths.length / 2);
    return lengths.length % 2 === 0 ? (lengths[mid - 1]! + lengths[mid]!) / 2 : lengths[mid]!;
}
