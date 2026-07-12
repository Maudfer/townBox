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

import ActionEngine from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick } from 'game/execution/TickRunner';
import LogicalWorld, { LogicalWorldConfig } from 'game/history/LogicalWorld';
import { createFounders, DEFAULT_FOUNDER_PARAMS } from 'game/population/Population';
import SkillBook from 'game/skills/SkillBook';
import eventsConfig from 'json/events.json';
import generatorConfig from 'json/historyGenerator.json';
import { WorldAdapter } from 'types/Execution';
import { PopulationState, PersonId } from 'types/Genealogy';
import { EventHistoryTable, EventLogTable, EventManifest, ScheduleState, TickResult } from 'types/LifeEvent';
import { InventoryState } from 'types/Objects';
import { SkillTimeline } from 'types/Skill';
import { ageAt } from 'util/kinship';
import { Predicate } from 'util/predicate';
import { TICKS_PER_DAY } from 'util/time';

const EVENT_MANIFEST = eventsConfig as unknown as EventManifest;

// The asset schema version — bump on shape changes (drives the load-time compatibility check, Part B).
// v2 (task 012 follow-up): the person-keyed lazy layout — the event log + skill timeline are streamed to ONE
// file per retained person (`person-<id>.tbz`, newline-separated compressed chunks) instead of time-ranged
// shards, so the game fetches only the small boot sections up-front and hydrates each person's history
// on demand at materialization. A v1 (time-sharded) asset is rejected → cold-start fallback.
export const HISTORY_ASSET_FORMAT_VERSION = 2;
// The generator version — bump when the sim/events change materially, so re-runs are distinguishable.
// 077.1: the logical-economy world (off-map schools/jobs/objects → the asset carries lived skills/possessions).
// 077.2: per-window skill snapshotting (a per-person skill timeline instead of an end-of-generation snapshot).
// 077.3: streaming to sharded files (RAM-bounded generation; chunked, load-only-≤w asset directory).
// 077.4: bounded fertility (per-person maxChildren + wantsMoreChildren gate) + population thermostat
//        (hysteresis pivots replace the logistic carrying capacity) → stable, non-exponential population.
// 078.0: reduced-manifest generator mode (default) — the probabilistic walk is restricted to loggable events,
//        dropping the ~680 effect-free texture events. A per-agent perf win that CHANGES the RNG stream, so
//        assets differ byte-wise from 077.4 (same content in kind); still deterministic per seed.
export const HISTORY_GENERATOR_VERSION = '078.0';

// The event whose hazard the population thermostat throttles (its birth effect is the only fertility source).
const PREGNANCY_EVENT = 'pregnancy';

// The offline generator's population thermostat: instead of a single setpoint (which would oscillate rapidly
// like an AC that switches at 24.1°/23.9° around 24°), it uses a deadband with two PIVOTS. Above the high
// pivot it suppresses the global "need for children" multiplier (the pregnancy-hazard scale); below the low
// pivot it allows it; between the pivots it holds the current mode (hysteresis). This is what keeps the living
// count near `target` over centuries without runaway growth. Live play never uses this (multiplier stays 1).
export interface PopulationControlConfig {
    enabled: boolean;
    target: number;        // desired living population
    band: number;          // deadband fraction: pivots at target*(1±band)
    suppressLevel: number; // childrenNeed multiplier while suppressing (0 = no births, 1 = no influence)
    allowLevel: number;    // childrenNeed multiplier while allowing (typically 1)
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
    populationControl: PopulationControlConfig;
    safety: GeneratorSafety;
    // The offline logical-economy world (task 077): when enabled, the generator runs logical schools/jobs/
    // objects off-map so the asset carries lived skills/careers-as-history/possessions (a skill timeline +
    // carried Inventory). When disabled, the generator is the 055 pool-intrinsic spine (skills at draw).
    logicalWorld: { enabled: boolean } & LogicalWorldConfig;
    // How often (in years) to snapshot each living person's skills, so selection can install skills AS OF the
    // window (task 077 per-window snapshotting). Finer = richer/heavier. Only used when logicalWorld.enabled.
    skillSnapshotYears: number;
    // How often (in years) to flush the event log + skill timeline to disk shards when generating to a sink
    // (task 077 streaming), so RAM stays bounded regardless of run length. Ignored for in-memory generation.
    flushIntervalYears: number;
    // Whether the asset retains the low-level ACTION log entries (grab/use/discrete work flavor) in addition
    // to life EVENTS. Default false: the action engine + Brain still run every tick (so action-CAUSED events
    // still fire into the event history), but the per-tick action texture — which explodes the asset to GBs
    // over centuries and which the game regenerates live anyway — is dropped from the serialized log. Set true
    // only for small diagnostic runs.
    keepActionLog: boolean;
    // The reduced-manifest generator mode (task 078). When true (the generator default), the event engine's
    // probabilistic walk is restricted to `loggableEventIds` — the ~18 vital/effect-bearing + requirement-
    // referenced events that actually reach the asset — skipping the ~680 effect-free story-texture events that
    // are already dropped from the persisted log. This cuts the per-agent probabilistic draw count ~10-20× at
    // no loss of asset content (skills/careers/vital histories are unchanged in KIND). It CHANGES the RNG
    // stream, so a reduced-manifest asset differs (byte-wise) from a full-manifest one — still deterministic
    // per seed; the generatorVersion records the mode. Set false for a full-fidelity correctness run.
    reducedEventManifest: boolean;
    // Diagnostic profiling (task 078 --profile): accumulate per-phase wall-clock timings (action-advance /
    // event-walk / progression / brain / runDaily / snapshot) and attach them to meta.stats.profile, so
    // per-agent cost can be attributed to phases. Off by default (a few truthy checks of overhead when on;
    // timing never affects logic, so determinism is untouched).
    profile: boolean;
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
    profile?: TickProfile;   // per-phase timing attribution (task 078 --profile); present only when profiling
}

// Per-phase wall-clock attribution over a profiled run (task 078). `agentSteps` = Σ agents-per-step, so a
// phase's ms/agent/step is phaseMs / agentSteps. The runTick phases (actions/events/progression/brain) plus
// the generator-owned day-cadence work (runDaily/snapshot) and the residual `other` (loop overhead: the
// living sort, thermostat, trajectory sampling, flush).
export interface TickProfile {
    actions: number;
    events: number;
    progression: number;
    brain: number;
    runDaily: number;
    snapshot: number;
    other: number;
    total: number;
    steps: number;
    agentSteps: number;
    // Finer attribution (task 079): the `brain` bucket split per-hook + arbitration, and the `actions` bucket
    // split per advance sub-phase. Present only under --profile; the CLI prints them beneath the coarse rows.
    brainHooks?: Record<string, number>;
    brainResolve?: number;
    actionsAdvance?: Record<string, number>;
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
    // them so drawn people arrive with real proficiency/possessions instead of synthesized-at-draw ones. The
    // skill timeline (per-window snapshotting) lets selection pick each person's skills as of the window.
    skillTimeline?: SkillTimeline;
    objects?: InventoryState;
    // When STREAMED to a sink (task 077), the event log + skill timeline live in per-person files instead of
    // inline (`eventLog`/`skillTimeline` are then empty) — the sink owns the on-disk layout (format v2).
}

// The disk sink the CLI provides so the generator can stream the two big, ever-growing sections (event log +
// skill timeline) as it goes, instead of holding the whole centuries-long history in RAM. Each flush hands the
// sink the drained tables; the sink splits them per person and appends a compressed chunk line to each
// person's file (format v2 — the person-keyed lazy layout). Implemented in scripts/ (Node/fs); the generator
// core stays browser-safe (no fs import). Absent = in-memory generation (small runs + tests).
export interface HistoryAssetSink {
    logChunk(table: EventLogTable): void;
    skillChunk(timeline: SkillTimeline): void;
}

export type GenerationPhase = 'warmup' | 'recording';

// Fired once per STEP (cheap: no pool scan). The CLI owns all period detection, roll-up formatting, and the
// per-second batching — it derives day/week/month/year from `ticksIntoPhase` (phase-relative, so recording
// years count from 0), and reports period boundaries at the granularity the step size actually achieves.
export interface GenerationProgress {
    phase: GenerationPhase;      // 'warmup' | 'recording' — recording resets ticksIntoPhase at the epoch
    ticksIntoPhase: number;      // ticks since the current phase started
    living: number;              // O(1) living-set size
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

// The population thermostat (AC-style hysteresis). `multiplier(living)` returns the global childrenNeed
// multiplier for the pregnancy hazard, flipping between allow/suppress at the two pivots and HOLDING between
// them — so it never chatters around a single setpoint. Stateful (the mode persists across ticks) but
// deterministic, since `living` is deterministic. Deaths are never throttled — only births.
export class PopulationThermostat {
    private mode: 'allow' | 'suppress' = 'allow'; // start allowing so warm-up grows toward the target

    constructor(private config: PopulationControlConfig) {}

    multiplier(living: number): number {
        if (!this.config.enabled || this.config.target <= 0) {
            return 1;
        }
        const low = this.config.target * (1 - this.config.band);
        const high = this.config.target * (1 + this.config.band);
        if (living >= high) {
            this.mode = 'suppress';
        } else if (living <= low) {
            this.mode = 'allow';
        }
        return this.mode === 'suppress' ? this.config.suppressLevel : this.config.allowLevel;
    }
}

// Runs the full phased generation. Pure function of (params) apart from the wall-clock in `meta.createdAt` and
// the optional `gitCommit`/runtime measurements the caller injects. `onProgress` reports per simulated month.
export async function generateHistoryAsset(
    params: HistoryGeneratorParams = DEFAULT_GENERATOR_PARAMS,
    onProgress?: (progress: GenerationProgress) => void,
    gitCommit: string | null = null,
    sink?: HistoryAssetSink
): Promise<HistoryAsset> {
    const startedAt = Date.now();
    const tpy = params.ticksPerYear;
    const step = Math.max(1, Math.floor(params.daysPerStep)) * TICKS_PER_DAY;
    const flushIntervalTicks = Math.max(1, Math.round(params.flushIntervalYears * tpy));

    // Phase 0 — founders.
    const state = createFounders(params.seed, params.founderCount, { ...DEFAULT_FOUNDER_PARAMS, ticksPerYear: tpy });

    // Reduced-manifest mode (task 078): restrict the probabilistic walk to the loggable events (the only ones
    // that reach the asset), skipping the ~680 texture events. `loggable` is reused below at flush time.
    const loggable = loggableEventIds();
    const engine = new EventEngine(undefined, undefined,
        params.reducedEventManifest ? { probabilisticWalkFilter: (id: string) => loggable.has(id) } : {});
    const actionEngine = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actionEngine);

    // Optional per-phase profiling accumulator (task 078 --profile).
    const profiler = params.profile
        ? { actions: 0, events: 0, progression: 0, brain: 0, sub: { brainHooks: {}, brainResolve: 0, actionsAdvance: {} } }
        : undefined;
    const profile: TickProfile | undefined = params.profile
        ? { actions: 0, events: 0, progression: 0, brain: 0, runDaily: 0, snapshot: 0, other: 0, total: 0, steps: 0, agentSteps: 0 }
        : undefined;
    const now = params.profile ? () => performance.now() : () => 0;

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
    const thermostat = new PopulationThermostat(params.populationControl);
    engine.setProbabilityScale(id => (id === PREGNANCY_EVENT ? thermostat.multiplier(livingCount) : 1));

    const snapshotIntervalTicks = Math.max(1, Math.round(params.skillSnapshotYears * tpy));
    let lastSnapshotBucket = -1;
    let births = 0;
    let deaths = 0;
    let epochTick: number | null = null;

    // Streaming state (task 077): when a sink is provided, periodically flush the log + skill timeline to the
    // sink (per-person files, format v2) so RAM never holds the whole centuries-long history. `logCounts`
    // tracks per-person log lengths for the median stat (the in-RAM log is drained away). The `loggable`
    // filter (declared above) is applied at flush time.
    const logCounts = new Map<PersonId, number>();
    let lastFlushBucket = 0;
    const slimLog = (table: EventLogTable): EventLogTable => {
        const slim: EventLogTable = {};
        for (const [id, entries] of Object.entries(table)) {
            const kept = entries.filter(entry =>
                (entry.kind === 'event' && loggable.has(entry.defId)) || (params.keepActionLog && entry.kind === 'action'));
            if (kept.length > 0) {
                slim[id] = kept;
                logCounts.set(id, (logCounts.get(id) ?? 0) + kept.length);
            }
        }
        return slim;
    };
    const flushToSink = (): void => {
        if (!sink) {
            return;
        }
        const logTable = slimLog(engine.drainLog());
        if (Object.keys(logTable).length > 0) {
            sink.logChunk(logTable);
        }
        if (logical) {
            const timeline = logical.drainSkillTimeline();
            if (Object.keys(timeline).length > 0) {
                sink.skillChunk(timeline);
            }
        }
    };
    const trajectory: { year: number; living: number }[] = [];
    let lastDecadeSampled = -1;

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

        const stepStart = now();
        livingCount = living.size;
        const agentIds = [...living].sort();
        const facts = logical && skillBook ? logical.tickFacts(skillBook, tick) : null;
        const result = await runTick({
            engine,
            actionEngine,
            brain,
            ...(profiler ? { profiler } : {}),
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
            const tDaily = now();
            logical.runDaily(state, tick, tick + step, tpy, skillBook, engine, living);
            if (profile) {
                profile.runDaily += now() - tDaily;
            }
            // Per-window skill snapshot at the configured cadence (task 077 fix).
            const bucket = Math.floor(tick / snapshotIntervalTicks);
            if (bucket !== lastSnapshotBucket) {
                lastSnapshotBucket = bucket;
                const tSnap = now();
                logical.snapshotSkills(skillBook, tick, living);
                if (profile) {
                    profile.snapshot += now() - tSnap;
                }
            }
        }
        if (profile) {
            profile.steps++;
            profile.agentSteps += agentIds.length;
            profile.total += now() - stepStart;
        }

        // Streaming flush: drain the log + skill timeline to disk shards at the flush cadence, keeping RAM
        // bounded regardless of run length (task 077). No-op for in-memory generation (no sink).
        if (sink) {
            const flushBucket = Math.floor(tick / flushIntervalTicks);
            if (flushBucket !== lastFlushBucket) {
                lastFlushBucket = flushBucket;
                flushToSink();
            }
        }

        // Per-decade trajectory sample + per-STEP progress. The progress fire is O(1) (living-set size only);
        // the CLI derives day/week/month/year period ends and batches the output (task 079 follow-up).
        const decade = Math.floor(tick / tpy / 10);
        if (decade !== lastDecadeSampled) {
            lastDecadeSampled = decade;
            trajectory.push({ year: Math.floor(tick / tpy), living: living.size });
        }
        if (onProgress) {
            onProgress({
                phase: inRecording ? 'recording' : 'warmup',
                ticksIntoPhase: tick - (inRecording ? epochTick! : 0),
                living: living.size,
            });
        }

        tick += step;
    }
    engine.setProbabilityScale(null);

    // Fold the runTick phase accumulator into the profile and derive the residual loop overhead (task 078).
    if (profile && profiler) {
        profile.actions = profiler.actions;
        profile.events = profiler.events;
        profile.progression = profiler.progression;
        profile.brain = profiler.brain;
        profile.brainHooks = profiler.sub.brainHooks;
        profile.brainResolve = profiler.sub.brainResolve;
        profile.actionsAdvance = profiler.sub.actionsAdvance;
        profile.other = Math.max(0, profile.total
            - profile.actions - profile.events - profile.progression - profile.brain - profile.runDaily - profile.snapshot);
    }

    const endTick = tick;
    const epoch = epochTick ?? endTick; // no threshold reached: nothing is "warm-up dead" to prune

    // Final skill snapshot so the latest state is captured (before the final streaming flush).
    if (logical && skillBook) {
        logical.snapshotSkills(skillBook, endTick, living);
    }

    // Prune warm-up-only dead from the pool + aggregate history: keep everyone alive at the end OR who died
    // at/after the epoch; drop the shallow-history early generations. Their LOG entries are handled per mode
    // below (in-memory: deleted; streaming: already in shards, filtered at load by retained-pool membership).
    const history = engine.getHistory();
    for (const [id, person] of Object.entries(state.people)) {
        if (person.deathTick === null || person.deathTick >= epoch) {
            continue;
        }
        delete state.people[id];
        delete history[id];
    }
    for (const record of Object.values(history)) {
        for (const eventId of Object.keys(record)) {
            if (!loggable.has(eventId)) {
                delete record[eventId]; // keep the aggregate bounded to loggable events
            }
        }
    }

    const retainedIds = Object.keys(state.people);
    const retainedSet = new Set(retainedIds);
    let livingAtEnd = 0;
    for (const id of retainedIds) {
        if (living.has(id)) {
            livingAtEnd++;
        }
    }

    // Build the log + skill sections: streamed to disk shards, or held inline for in-memory generation.
    let eventLog: EventLogTable = {};
    let skillTimeline: SkillTimeline | undefined;
    let medianHistoryLen: number;
    if (sink) {
        flushToSink(); // final flush of the remaining log + skill timeline
        medianHistoryLen = medianOfCounts(retainedIds.map(id => logCounts.get(id) ?? 0));
    } else {
        const full = engine.getLog();
        const slim: EventLogTable = {};
        for (const [id, entries] of Object.entries(full)) {
            if (!retainedSet.has(id)) {
                continue; // warm-up dead
            }
            const kept = entries.filter(entry =>
                (entry.kind === 'event' && loggable.has(entry.defId)) || (params.keepActionLog && entry.kind === 'action'));
            if (kept.length > 0) {
                slim[id] = kept;
            }
        }
        eventLog = slim;
        medianHistoryLen = medianLogLength(eventLog, retainedIds);
        if (logical && skillBook) {
            skillTimeline = logical.skillTimelineState(retainedSet);
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
            medianHistoryLen,
            trajectory,
            runtimeMs: Date.now() - startedAt,
            rawBytes: 0,
            compressedBytes: 0,
            ...(profile ? { profile } : {}),
        },
    };

    const asset: HistoryAsset = {
        meta,
        population: state,
        eventHistory: history,
        eventLog,
        eventLogSeq: engine.getNextLogSeq(),
        eventSchedule: engine.getScheduleState(),
    };
    if (logical && skillBook) {
        asset.objects = logical.carriedInventoryState(retainedSet);
    }
    if (!sink && skillTimeline) {
        asset.skillTimeline = skillTimeline;
    }

    return asset;
}

function medianLogLength(log: EventLogTable, ids: string[]): number {
    return medianOfCounts(ids.map(id => log[id]?.length ?? 0));
}

function medianOfCounts(counts: number[]): number {
    const lengths = [...counts].sort((a, b) => a - b);
    if (lengths.length === 0) {
        return 0;
    }
    const mid = Math.floor(lengths.length / 2);
    return lengths.length % 2 === 0 ? (lengths[mid - 1]! + lengths[mid]!) / 2 : lengths[mid]!;
}
