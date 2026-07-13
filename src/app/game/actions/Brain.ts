// The Brain (task 046; docs/tasks/038 §8; arbitration v2 since task 086 / proposal L): the per-person
// DECISION layer. Hooks inspect the simulation context and return Action INTENTS; the Brain resolves them
// and asks the Action engine to start or interrupt actions through the normal pipeline. The Brain never
// mutates people, never writes logs, and never duplicates execution logic — the Action engine executes,
// hooks propose, the Brain arbitrates.
//
// DOCTRINE (L1, superseding 046's "deliberately stateless"): the Brain OWNS no state but READS many — a
// decision is a function of (log, active instance, needs 084, edges 083, agenda 085, and later mood/traits),
// every one a serialized store OUTSIDE the Brain, reached through deps/markets exactly like jobOf/schoolOf.
// Nothing serializes inside the Brain object itself; determinism and live/bootstrap byte-equivalence hold.
// What died with 086 is only the idea that the log alone is enough context to decide.
//
// ARBITRATION (L2–L4, L6): intents declare a BAND (survival > obligation > commitment > need > opportunity
// > fallback) and an in-band utility (scoreIntent — one currency every hook prices in). Ordering is band →
// utility → hook order → actionId. INTERRUPTION of a running continuous action is governed by the matrix:
// a strictly higher band displaces; the same band needs a utility delta over the authored hysteresis AND the
// running action to be past its decision cooldown (commitment inertia — people finish what they start);
// a lower band never displaces. Thresholds live in json/arbitration.json.
//
// Determinism: hooks run in registration order; the free-time weighted pick forks the world-seed RNG per
// (tick, person); band ranks and utilities are pure functions of the intent.

import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import { evaluateConsent, ConsentRequest } from 'game/actions/Consent';
import { jobOrchestratorHook } from 'game/actions/JobOrchestrator';
import { plannerHook } from 'game/actions/Planner';
import { detainedHook } from 'game/actions/Detained';
import { evacuationHook, fireResponseHook } from 'game/actions/FireResponse';
import { pursuitHook } from 'game/actions/Pursuit';
import { socialOpportunityHook } from 'game/actions/SocialOpportunity';
import { schoolObligationHook } from 'game/skills/SchoolOrchestrator';
import arbitrationConfig from 'json/arbitration.json';
import inventoryConfig from 'json/inventory.json';
import { ActionDefinition, IntentBand } from 'types/Action';
import { locationKey } from 'types/Objects';
import { SubProfiler } from 'types/Execution';
import { PersonId } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { SchoolFacts } from 'types/School';
import { Value } from 'types/Simulation';
import { count } from 'util/perfMeter';
import { evaluatePredicateCached } from 'util/predicate';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { isOnShiftAtTick } from 'util/shifts';

// The selection weight assumed when an action declares none (task 076/L2). One shared convention across every
// selection path (free-time and the social hook) so a weightless action is treated identically everywhere.
export const DEFAULT_SELECTION_WEIGHT = 1;

// The person's broad simulation state — a small, stable enum, never an arbitrary action name (038 §8). The
// actual activity is the active instance (`activeActionInstanceId`), queryable separately.
export type BrainStatus = 'idle' | 'sleeping' | 'commuting' | 'working' | 'performing_action' | 'waiting_for_materialization';

// What a hook proposes. `band` (task 086) is the arbitration ladder rung; hooks that predate the bands (or
// external hooks) fall back to the mechanical necessity mapping (emergency → survival, required →
// obligation, optional → opportunity). `priority` is the in-band base utility; `mayInterrupt` is legacy —
// the interruption MATRIX governs displacement since 086 (the field is ignored).
export interface ActionIntent {
    actionId: string;
    params?: Record<string, Value>;
    locationOverride?: string;
    sourceHook: string;
    priority: number;
    necessity: 'optional' | 'required' | 'emergency';
    band?: IntentBand;
    mayInterrupt: boolean;
    causationId: number | null;
    // Resume a PAUSED instance (task 087 / L5) instead of starting a new one — set by the resume hook; the
    // actionId mirrors the paused instance's for arbitration purposes.
    resumeInstanceId?: string;
}

const BAND_RANK: Record<IntentBand, number> = { survival: 0, obligation: 1, commitment: 2, need: 3, opportunity: 4, fallback: 5 };
// The authored interruption thresholds (task 086 / L4, L6).
export const ARBITRATION_CONFIG = arbitrationConfig as { sameBandUtilityDelta: number; decisionCooldownTicks: number };
// Carry budgets + the acquisitive hook's chances (task 088 / F1–F2).
export const INVENTORY_CONFIG = inventoryConfig as {
    maxCarriedWeightGrams: number; maxBulkyItems: number; stowAboveFraction: number;
    curiosityChancePerTick: number; fiddleChancePerTick: number; pantryFetchBelowFood: number;
};

// The band of an intent: explicit, else the mechanical necessity mapping (the L7 migration rule).
export function bandOf(intent: ActionIntent): IntentBand {
    if (intent.band) {
        return intent.band;
    }
    return intent.necessity === 'emergency' ? 'survival' : intent.necessity === 'required' ? 'obligation' : 'opportunity';
}

// One utility currency (task 086 / L3): the in-band score every hook prices its intents in. Today it is the
// authored base priority; mood (task 091) and trait affinity (task 087) enter THIS formula — never their own
// per-hook math — so data keeps the last word everywhere at once.
export function scoreIntent(intent: ActionIntent): number {
    return intent.priority;
}

// A person's job facts, resolved by the host (live: WorkLife/Workplace; bootstrap: the logical world when
// 055 builds it; tests: fixtures). Null = no job.
export interface JobFacts {
    // The jobs.json key (task 099): lets role-aware hooks (the pursuit hook) know WHAT the job is.
    jobKey?: string;
    shiftStart: number;
    shiftEnd: number;
    daysOfWeek?: readonly string[];
    workplaceKey: string;
    // The person's current rank on the job ladder (task 064) — progression/promotion facts for 065; the
    // work-action repertoires below already reflect any rank-specific overrides.
    rank?: import('types/Business').JobRank;
    // The job's work-action repertoire (045), proposed by the Job Orchestrator hook (047): continuous
    // entries rotate by weight; discrete entries roll per tick on duty.
    continuousActions: { action: string; chancePerTick?: number }[];
    discreteActions: { action: string; chancePerTick?: number; maxPerTick?: number; cooldownTicks?: number }[];
}

export interface BrainDeps extends ActionDeps {
    jobOf?: (personId: PersonId) => JobFacts | null;
    // A person's VALID school assignment facts (task 058), resolved by the host (live: SchoolRegistry +
    // City validity checks; bootstrap: the logical world when 055 builds it). Null = no school obligation.
    schoolOf?: (personId: PersonId) => SchoolFacts | null;
    // The person's detention facts (task 100) — resolved by the host (live: City's DetentionRegistry).
    // Null = free. The detained hook keeps them at the facility while a record exists.
    detentionOf?: (personId: PersonId) => { locationKey: string } | null;
}

// Dispatched today: `onTick` and `onEventCommitted` (processTick), and `onActionFailed` (the decline path,
// task 073). The remaining kinds are a RESERVED forward API for future producers (shift/arrival/action-lifecycle
// systems) — declared so hooks can register against them without reshaping the resolution machinery, but not
// yet emitted (task 076/L1: completion-driven selection is already covered by idleFallback on the same tick,
// given actions advance in phases 1–2 before hooks run in phase 7).
export type HookKind = 'onTick' | 'onEventCommitted' | 'onActionStarted' | 'onActionCompleted' | 'onActionFailed' | 'onActionInterrupted' | 'onLocationArrived' | 'onShiftStarted' | 'onShiftEnded';

export interface HookContext {
    personId: PersonId;
    deps: BrainDeps;
    brain: Brain;
    // For onEventCommitted: the committing event (params carry the payload — reactions bind targets off it).
    event?: { eventId: string; seq: number; params?: Record<string, string | number | boolean> };
    // For onActionFailed (task 073): the declined/failed attempt being observed.
    failure?: { actionId: string; reason: string };
    // Optional --profile sub-timer (task 079 pass 2): hooks may attribute their internal segments into it
    // (keys namespaced by hook id, e.g. 'social:peopleAt'). Absent outside profiled generator runs.
    sub?: SubProfiler;
}

export interface BrainHook {
    id: string;
    kind: HookKind;
    // Inspect and PROPOSE — never mutate. Return zero or more intents.
    propose(ctx: HookContext): ActionIntent[];
}


export default class Brain {
    private actionEngine: ActionEngine;
    private hooks: BrainHook[];
    // The static free-time candidate set (task 078): the manifest scan that decides an action is a
    // free-time pick — continuous, not work/obligation, positive base weight — depends only on the action
    // DEFINITION, so it is computed once (lazily) instead of re-scanning all ~260 actions (incl. discrete/
    // work) per idle person per tick. The per-call work (cooldown, requirement predicate, dynamic modifiers,
    // the seeded weighted pick) is unchanged, so selection stays byte-identical.
    private freeTimeCandidates: { actionId: string; def: ActionDefinition; baseWeight: number }[] | null = null;
    // Per-(person, tick) free-time selection memo (task 079). `selectFreeTimeAction` is a pure function of
    // (worldSeed, tick, personId, context), and within one tick's proposal phase a person's context is stable
    // (hooks only PROPOSE; actions start later in resolveIntents). Both wokeUp and idleFallback call it for the
    // same idle-just-woken person each step, so it was computed twice identically — this cache returns the same
    // pick the second time. TRANSIENT: keyed by the tick it was built for, cleared when the tick advances, so
    // nothing new serializes (Brain stays stateless across saves) and the result is byte-identical in both modes.
    private freeTimeMemo = new Map<PersonId, string | null>();
    private freeTimeMemoTick: number | null = null;
    // Transient --profile sub-timer (task 079 pass 2), set for the duration of processTick so
    // computeFreeTimeAction can attribute its internal segments. Undefined outside profiled runs.
    private profileSub: SubProfiler | undefined;

    constructor(actionEngine: ActionEngine) {
        this.actionEngine = actionEngine;
        // Built-in hooks in deterministic registration order. Registration is open for future hooks
        // (need-driven stats etc.) without touching the resolution machinery.
        this.hooks = [
            jobOrchestratorHook, // work obligations + on-duty flavor (task 047) — the job-context action source
            schoolObligationHook, // school attendance for enrolled children (task 058)
            evacuationHook, // fire! (task 102): survival-band — everyone out, whatever they were doing
            fireResponseHook, // firefighters answer the alarm (task 102): obligation-band ambulatory rush
            detainedHook, // serving time (task 100): the cell outranks the shift — detention is lived, not despawned
            pursuitHook, // the chase (task 099): flee (survival) / give chase (obligation) on co-location
            needsHook, // critical-need required intents (task 084) — outranks leisure, yields to obligations
            plannerHook, // due agenda entries: routines, located visits, joint plans (task 085)
            wokeUpHook,
            reactionsHook, // authored answers to committed events — thanks, hugs back, retorts (task 094)
            actionFailedHook, // observes consent declines (task 073) — the reaction registration point
            socialOpportunityHook, // person-targeted intents with bound targets (task 072)
            inventoryOpportunityHook,
            resumeHook, // paused activities resume before fresh idle picks (task 087 / L5)
            idleFallbackHook,
        ];
    }

    // Consent (task 073): the TARGET's pure, stateless yes/no on an askFirst interaction. Architecturally
    // Brain territory (the target's decision layer) — the policy itself lives in game/Consent.ts so the
    // Action engine can consult it without a Brain import cycle. Placeholder 80%-yes; see that module.
    evaluateConsent(request: ConsentRequest): boolean {
        return evaluateConsent(request);
    }

    registerHook(hook: BrainHook): void {
        this.hooks.push(hook);
    }

    // The derived broad state (038 §8): stable enum + the activity id held separately.
    statusOf(personId: PersonId): { status: BrainStatus; activeActionInstanceId: string | null } {
        const active = this.actionEngine.activeInstanceOf(personId);
        if (!active) {
            return { status: 'idle', activeActionInstanceId: null };
        }
        if (active.status === 'waiting_for_materialization') {
            // Commuting IS our materialization wait in live mode; both surface the same way.
            return { status: 'commuting', activeActionInstanceId: active.id };
        }
        const def = this.actionEngine.getDefinition(active.defId);
        if (active.defId === 'sleep') {
            return { status: 'sleeping', activeActionInstanceId: active.id };
        }
        if (def?.category === 'work') {
            return { status: 'working', activeActionInstanceId: active.id };
        }
        return { status: 'performing_action', activeActionInstanceId: active.id };
    }

    // Lifecycle phase 7 (038 §3.1): run hooks for every agent, resolve intents, and execute through the
    // Action engine (phase 8). `committed` carries the tick's event commits for onEventCommitted hooks.
    processTick(agentIds: PersonId[], deps: BrainDeps, committed: TickResult['committed'], result: TickResult, sub?: SubProfiler): void {
        const committedByPerson = new Map<PersonId, { eventId: string; seq: number; params?: Record<string, string | number | boolean> }[]>();
        for (const commit of committed) {
            const list = committedByPerson.get(commit.personId) ?? [];
            list.push({ eventId: commit.eventId, seq: commit.seq, ...(commit.params ? { params: commit.params } : {}) });
            committedByPerson.set(commit.personId, list);
        }

        // Witnesses (task 094 / C4): co-located third parties log the scene. Runs off the ORIGINAL commit
        // list (built above), so witnessed entries never dispatch reactions — the one-level rule holds
        // structurally. Capped at 3 witnesses per scene, once per witness per day (the event's own limit).
        const world = deps.ctx.world ?? null;
        if (world) {
            const agentSet = new Set(agentIds);
            for (const commit of committed) {
                if (!deps.eventEngine.getManifest()[commit.eventId]?.witnessable) {
                    continue;
                }
                const witnesses = world.peopleAt(world.locationOf(commit.personId))
                    .filter(id => id !== commit.personId && agentSet.has(id))
                    .sort()
                    .slice(0, 3);
                const witnessedValence = deps.eventEngine.getManifest()[commit.eventId]?.valence ?? 0;
                for (const witnessId of witnesses) {
                    // What was seen becomes KNOWN (task 104 / O1): a bounded, decaying reference to the
                    // real commit — only notable scenes (nonzero valence) are worth remembering.
                    if (witnessedValence !== 0) {
                        deps.ctx.markets?.knownFacts?.learn(witnessId, {
                            aboutId: commit.personId, seq: commit.seq, eventId: commit.eventId,
                            valence: witnessedValence, learnedAtTick: deps.tick, viaWitness: true,
                        });
                    }
                    const { result: witnessResult } = deps.eventEngine.invoke(
                        deps.state, 'witnessed_a_scene', witnessId, deps.tick, deps.ticksPerYear,
                        { source: 'system', causationId: commit.seq }, {}, deps.ctx,
                        { about: commit.personId, event: commit.eventId }
                    );
                    result.died.push(...witnessResult.died);
                    result.born.push(...witnessResult.born);
                    result.signals.push(...witnessResult.signals);
                    result.committed.push(...witnessResult.committed);
                }
            }
        }

        // Optional --profile sub-timing (task 079): per-hook + arbitration wall-clock. `clock` is null (and the
        // per-hook branches skipped) when no SubProfiler is threaded, so live play pays nothing.
        const clock = sub ? () => performance.now() : null;
        this.profileSub = sub;
        for (const personId of [...agentIds].sort()) {
            const intents: ActionIntent[] = [];
            for (const hook of this.hooks) {
                const t0 = clock ? clock() : 0;
                if (hook.kind === 'onTick') {
                    intents.push(...hook.propose({ personId, deps, brain: this, ...(sub ? { sub } : {}) }));
                } else if (hook.kind === 'onEventCommitted') {
                    for (const event of committedByPerson.get(personId) ?? []) {
                        intents.push(...hook.propose({ personId, deps, brain: this, event, ...(sub ? { sub } : {}) }));
                    }
                }
                // onActionFailed is dispatched separately by the decline path (resolveIntents, task 073); the
                // remaining reserved kinds have no producer yet (see the HookKind note). idleFallback (onTick)
                // covers post-completion selection here, so no completion dispatch is needed.
                if (sub && clock) {
                    sub.brainHooks[hook.id] = (sub.brainHooks[hook.id] ?? 0) + (clock() - t0);
                }
            }
            const tResolve = clock ? clock() : 0;
            this.resolveIntents(personId, intents, deps, result);
            if (sub && clock) {
                sub.brainResolve += clock() - tResolve;
            }
        }
        this.profileSub = undefined;
    }

    // Deterministic arbitration (task 086 / L2–L4): band, then in-band utility, then hook registration
    // order, then actionId. Interruption is matrix-governed — see the header.
    private resolveIntents(personId: PersonId, intents: ActionIntent[], deps: BrainDeps, result: TickResult): void {
        if (intents.length === 0) {
            return;
        }
        const hookOrder = new Map(this.hooks.map((hook, index) => [hook.id, index]));
        intents.sort((a, b) =>
            BAND_RANK[bandOf(a)] - BAND_RANK[bandOf(b)]
            || scoreIntent(b) - scoreIntent(a)
            || (hookOrder.get(a.sourceHook) ?? 99) - (hookOrder.get(b.sourceHook) ?? 99)
            || a.actionId.localeCompare(b.actionId)
        );

        const failures: { actionId: string; reason: string }[] = [];
        for (const intent of intents) {
            const def = this.actionEngine.getDefinition(intent.actionId);
            if (!def) {
                continue;
            }
            const active = this.actionEngine.activeInstanceOf(personId);
            if (def.type === 'continuous' && active) {
                if (active.defId === intent.actionId) {
                    break; // already doing it — the winning intent is satisfied
                }
                // The interruption matrix (L4): a strictly higher band displaces; the same band needs a
                // utility delta over the hysteresis AND the running action past its decision cooldown (L6 —
                // commitment inertia: people finish what they start); a lower band never displaces.
                const intentRank = BAND_RANK[bandOf(intent)];
                const activeRank = BAND_RANK[active.band ?? 'fallback'];
                if (intentRank > activeRank) {
                    continue; // lower band — try the next intent
                }
                if (intentRank === activeRank) {
                    if (scoreIntent(intent) - (active.utility ?? 0) < ARBITRATION_CONFIG.sameBandUtilityDelta) {
                        continue;
                    }
                    const runningSince = active.runningSinceTick ?? active.startedTick;
                    if (deps.tick - runningSince < ARBITRATION_CONFIG.decisionCooldownTicks) {
                        continue;
                    }
                }
                // Pause-vs-interrupt (task 087 / L5): a resumable activity displaced by a strictly HIGHER
                // band parks (the walk continues after the chase); same-band swaps and non-resumables end.
                const activeDef = this.actionEngine.getDefinition(active.defId);
                if (activeDef?.resumable && intentRank < activeRank) {
                    this.actionEngine.pause(active.id, { source: 'brain', causationId: intent.causationId }, deps, result);
                } else {
                    this.actionEngine.interrupt(active.id, { source: 'brain', causationId: intent.causationId }, deps, result);
                }
            }
            // Resume intents (task 087): revive the paused instance instead of starting a new one.
            if (intent.resumeInstanceId) {
                if (this.actionEngine.resume(intent.resumeInstanceId, { source: 'brain', causationId: intent.causationId }, deps)) {
                    break;
                }
                continue;
            }
            const outcome = this.actionEngine.startAction(
                personId, intent.actionId, intent.params ?? {}, { source: 'brain', causationId: intent.causationId },
                deps, result, null, undefined, intent.locationOverride
            );
            if (!outcome.ok && outcome.reason === 'consentDeclined') {
                failures.push({ actionId: intent.actionId, reason: outcome.reason });
            }
            if (outcome.ok && def.type === 'continuous') {
                // Arbitration provenance (086): the instance carries its band + utility for the matrix.
                if (outcome.instanceId) {
                    this.actionEngine.tagInstance(outcome.instanceId, bandOf(intent), scoreIntent(intent));
                }
                break; // one continuous activity per person; lower intents wait for another tick
            }
            // Discrete intents (or failed starts) fall through to the next intent.
        }

        // Failure dispatch (task 073): onActionFailed hooks observe declines in the SAME tick's phase 7.
        // The failed intent is already gone (intents are per-tick), the engine recorded the attempt (so
        // selection cooldowns gate re-proposal), and this dispatch is ONE level deep — intents proposed
        // here execute, but their own failures never re-dispatch, so retry loops are structurally impossible.
        for (const failure of failures) {
            for (const hook of this.hooks) {
                if (hook.kind !== 'onActionFailed') {
                    continue;
                }
                for (const intent of hook.propose({ personId, deps, brain: this, failure })) {
                    this.actionEngine.startAction(
                        personId, intent.actionId, intent.params ?? {}, { source: 'brain', causationId: intent.causationId },
                        deps, result, null, undefined, intent.locationOverride
                    );
                }
            }
        }
    }

    // --- Free-time selection (038 §8): filter → score → deterministic weighted pick -----------------------

    // The continuous, non-work/obligation, positive-base-weight actions eligible to be free-time picks. Static
    // per manifest, so computed once and reused (task 078) — already sorted by actionId so the downstream
    // weighted pick sees the same order as the prior full-manifest scan (byte-identical selection).
    private getFreeTimeCandidates(): { actionId: string; def: ActionDefinition; baseWeight: number; venueKind?: string }[] {
        if (this.freeTimeCandidates) {
            return this.freeTimeCandidates;
        }
        const candidates: { actionId: string; def: ActionDefinition; baseWeight: number; venueKind?: string }[] = [];
        for (const [actionId, def] of Object.entries(this.actionEngine.getManifest())) {
            if (def.type !== 'continuous' || def.category === 'work' || def.category === 'obligation') {
                continue; // obligations are hook-driven, never free-time picks
            }
            const baseWeight = def.selection?.weight ?? DEFAULT_SELECTION_WEIGHT;
            if (baseWeight <= 0) {
                continue; // not selectable
            }
            const venueKind = typeof def.location === 'string' && def.location.startsWith('venue:') ? def.location.slice('venue:'.length) : undefined;
            candidates.push({ actionId, def, baseWeight, ...(venueKind !== undefined ? { venueKind } : {}) });
        }
        candidates.sort((a, b) => a.actionId.localeCompare(b.actionId));
        this.freeTimeCandidates = candidates;
        return candidates;
    }

    // The best available continuous action addressing one need (the needsHook's pick, task 084): the normal
    // free-time machinery (cooldowns, hard gates, modifiers, urgency) restricted to candidates that satisfy
    // the need meaningfully. Deterministic per (seed, tick, person) on a salted fork of the free-time stream.
    selectActionForNeed(personId: PersonId, need: import('types/Needs').NeedId, deps: BrainDeps): string | null {
        const context = this.actionEngine.contextFor(personId, deps);
        const needsLedger = deps.ctx.markets?.needs ?? null;
        const traitsReader = deps.ctx.markets?.traits ?? null;
        const habitsReader = deps.ctx.markets?.habits ?? null;
        const candidates: { actionId: string; weight: number }[] = [];
        for (const { actionId, def, baseWeight, venueKind } of this.getFreeTimeCandidates()) {
            if ((def.satisfies?.[need] ?? 0) < 5) {
                continue;
            }
            if (venueKind !== undefined && deps.ctx.world && !deps.ctx.world.hasVenue(venueKind)) {
                continue; // no such place in this town (task 107) — don't propose the unreachable
            }
            const selection = def.selection;
            let weight = baseWeight;
            if (selection?.cooldownTicks !== undefined && this.actionEngine.hasAction(personId, actionId, deps.tick, { withinTicks: selection.cooldownTicks })) {
                continue;
            }
            if (def.requirements && !evaluatePredicateCached(def.requirements, context)) {
                continue;
            }
            for (const modifier of selection?.modifiers ?? []) {
                if (evaluatePredicateCached(modifier.when, context)) {
                    weight *= modifier.multiply;
                }
            }
            if (needsLedger) {
                weight *= needsLedger.selectionMultiplier(personId, def.satisfies, deps.tick, deps.state.worldSeed);
            }
            if (traitsReader && def.affinity) {
                weight *= traitsReader.affinityMultiplier(personId, def.affinity);
            }
            // Habit escalation (task 095): a practiced vice's own weight climbs — coping loops emerge.
            if (habitsReader && def.habit) {
                weight *= habitsReader.selectionMultiplier(personId, def.habit, deps.tick);
            }
            if (weight > 0) {
                candidates.push({ actionId, weight });
            }
        }
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.actionId.localeCompare(b.actionId));
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId)).fork(0x9eed);
        const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = rng.next() * total;
        for (const candidate of candidates) {
            roll -= candidate.weight;
            if (roll <= 0) {
                return candidate.actionId;
            }
        }
        return candidates[candidates.length - 1]!.actionId;
    }

    selectFreeTimeAction(personId: PersonId, deps: BrainDeps): string | null {
        // Serve from the per-tick memo when this person's pick was already computed this tick (see field docs).
        if (this.freeTimeMemoTick !== deps.tick) {
            this.freeTimeMemo.clear();
            this.freeTimeMemoTick = deps.tick;
        }
        const memoized = this.freeTimeMemo.get(personId);
        if (memoized !== undefined) {
            return memoized;
        }
        const pick = this.computeFreeTimeAction(personId, deps);
        this.freeTimeMemo.set(personId, pick);
        return pick;
    }

    private computeFreeTimeAction(personId: PersonId, deps: BrainDeps): string | null {
        count('brain.freeTimeCompute'); // perf: free-time selections actually computed — one/person/tick if the memo holds (task 079)
        // --profile segment timers (task 079 pass 2): attribute the compute to context-build / requirement
        // predicates / modifier predicates / the rest of the loop. Null clock outside profiled runs.
        const sub = this.profileSub;
        const clock = sub ? () => performance.now() : null;
        const addSeg = (key: string, t0: number): void => {
            if (sub && clock) {
                sub.brainHooks[key] = (sub.brainHooks[key] ?? 0) + (clock() - t0);
            }
        };

        const tCtx = clock ? clock() : 0;
        const context = this.actionEngine.contextFor(personId, deps);
        addSeg('freeTime:context', tCtx);
        const needsLedger = deps.ctx.markets?.needs ?? null;
        const traitsReader = deps.ctx.markets?.traits ?? null;
        const habitsReader = deps.ctx.markets?.habits ?? null;
        const tLoop = clock ? clock() : 0;
        let reqMs = 0;
        let modMs = 0;
        const candidates: { actionId: string; weight: number }[] = [];
        for (const { actionId, def, baseWeight, venueKind } of this.getFreeTimeCandidates()) {
            const selection = def.selection;
            let weight = baseWeight;
            if (selection?.cooldownTicks !== undefined && this.actionEngine.hasAction(personId, actionId, deps.tick, { withinTicks: selection.cooldownTicks })) {
                continue; // anti-repetition
            }
            if (venueKind !== undefined && deps.ctx.world && !deps.ctx.world.hasVenue(venueKind)) {
                continue; // no such place in this town (task 107) — don't propose the unreachable
            }
            if (def.requirements) {
                const tReq = clock ? clock() : 0;
                const pass = evaluatePredicateCached(def.requirements, context);
                if (clock) {
                    reqMs += clock() - tReq;
                }
                if (!pass) {
                    continue; // hard gate
                }
            }
            for (const modifier of selection?.modifiers ?? []) {
                const tMod = clock ? clock() : 0;
                const applies = evaluatePredicateCached(modifier.when, context);
                if (clock) {
                    modMs += clock() - tMod;
                }
                if (applies) {
                    weight *= modifier.multiply;
                }
            }
            // Needs urgency (task 084): an action addressing a starved need multiplies up, a sated one down —
            // the shared gradient in json/needs.json. Authored weights/modifiers keep the last word (above).
            if (needsLedger && def.satisfies) {
                weight *= needsLedger.selectionMultiplier(personId, def.satisfies, deps.tick, deps.state.worldSeed);
            }
            // Trait affinity (task 087): temperament scales what this PERSON gravitates toward.
            if (traitsReader && def.affinity) {
                weight *= traitsReader.affinityMultiplier(personId, def.affinity);
            }
            // Habit escalation (task 095): repeated practice raises the vice's own weight — the addiction
            // positive-feedback loop, in the same selection math as everything else. Cooling is closed-form.
            if (habitsReader && def.habit) {
                weight *= habitsReader.selectionMultiplier(personId, def.habit, deps.tick);
            }
            if (weight > 0) {
                candidates.push({ actionId, weight });
            }
        }
        if (sub && clock) {
            sub.brainHooks['freeTime:requirements'] = (sub.brainHooks['freeTime:requirements'] ?? 0) + reqMs;
            sub.brainHooks['freeTime:modifiers'] = (sub.brainHooks['freeTime:modifiers'] ?? 0) + modMs;
        }
        addSeg('freeTime:loop', tLoop);
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.actionId.localeCompare(b.actionId));
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId));
        const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = rng.next() * total;
        for (const candidate of candidates) {
            roll -= candidate.weight;
            if (roll <= 0) {
                return candidate.actionId;
            }
        }
        return candidates[candidates.length - 1]!.actionId;
    }

    getActionEngine(): ActionEngine {
        return this.actionEngine;
    }
}

// --- Built-in hooks -----------------------------------------------------------------------------------------

// Woke up (onEventCommitted 'woke_up'): the canonical morning decision — obligation first (the obligation
// hook will catch the shift on this same tick), else pick a free-time activity now rather than idling.
const wokeUpHook: BrainHook = {
    id: 'wokeUp',
    kind: 'onEventCommitted',
    propose({ personId, deps, brain, event }): ActionIntent[] {
        if (event?.eventId !== 'woke_up') {
            return [];
        }
        const job = deps.jobOf?.(personId) ?? null;
        if (job && isOnShiftAtTick(job, deps.tick)) {
            return []; // the obligation hook owns the work intent — don't duplicate it
        }
        const school = deps.schoolOf?.(personId) ?? null;
        if (school && isOnShiftAtTick(school, deps.tick)) {
            return []; // likewise, the school-obligation hook owns the attendance intent (task 058)
        }
        const pick = brain.selectFreeTimeAction(personId, deps);
        return pick ? [{
            actionId: pick,
            sourceHook: 'wokeUp',
            priority: 40,
            necessity: 'optional',
            band: 'fallback',
            mayInterrupt: false,
            causationId: event.seq,
        }] : [];
    },
};

// Reactions (task 094 / C3): the subject of a committed event may answer it — a thank-you for a gift, a hug
// back, a retort to an argument. Authored on the EVENT (reactions[]); rolls are seeded per (tick, person,
// seq); targets bind from the event's payload; the action's own gates (co-location, consent, requirements)
// do the rest. One level deep by construction: reaction commits never re-dispatch (see processTick).
const reactionsHook: BrainHook = {
    id: 'reactions',
    kind: 'onEventCommitted',
    propose({ personId, deps, event }): ActionIntent[] {
        if (!event) {
            return [];
        }
        const reactions = deps.eventEngine.getManifest()[event.eventId]?.reactions ?? [];
        if (reactions.length === 0) {
            return [];
        }
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId)).fork(0x4ea).fork(event.seq);
        const intents: ActionIntent[] = [];
        for (const reaction of reactions) {
            if (!rng.chance(reaction.chance)) {
                continue;
            }
            let params: Record<string, Value> | undefined;
            if (reaction.targetParam) {
                const other = event.params?.[reaction.targetParam];
                if (typeof other !== 'string') {
                    continue; // no counterpart in the payload — nothing to react at
                }
                params = { target: other };
            }
            intents.push({
                actionId: reaction.action,
                ...(params ? { params } : {}),
                sourceHook: 'reactions',
                priority: 25,
                necessity: 'optional',
                band: 'opportunity',
                mayInterrupt: false,
                causationId: event.seq,
            });
        }
        return intents;
    },
};

// A proposed action was declined/failed at start (task 073) — dispatched in the same tick, one level deep.
// Deliberately inert this iteration: no automatic retry, no counter-proposal. It exists as the registration
// point for future reactions (074's curated decline responses, relationship consequences).
const actionFailedHook: BrainHook = {
    id: 'actionFailed',
    kind: 'onActionFailed',
    propose(): ActionIntent[] {
        return [];
    },
};

// Inventory opportunity (onTick): an idle person interacts with objects around them (038 §8's "natural variety
// in Possessions"). This is the sole proposer of the generic object verbs (task 076/M3 — grab/use_object/
// put_down/discard_object were dead before this): pools can't bind params (they start children with {}), so
// param-bound verbs must come from a hook. Preference order: pick up a free loose carryable here (grab),
// else pocket a small item (generic flavor), else occasionally fiddle with what they carry (use/put-down/
// discard). The carried-fiddle is probability-gated so it doesn't starve free-time continuous actions.
const inventoryOpportunityHook: BrainHook = {
    id: 'inventoryOpportunity',
    kind: 'onTick',
    propose({ personId, deps, brain, sub }): ActionIntent[] {
        // --profile segment timers (task 079 pass 2). Null clock outside profiled runs.
        const clock = sub ? () => performance.now() : null;
        const addSeg = (key: string, t0: number): void => {
            if (sub && clock) {
                sub.brainHooks[key] = (sub.brainHooks[key] ?? 0) + (clock() - t0);
            }
        };
        const tStatus = clock ? clock() : 0;
        const idle = brain.statusOf(personId).status === 'idle';
        addSeg('inv:status', tStatus);
        if (!idle) {
            return [];
        }
        const intent = (actionId: string, object?: string): ActionIntent => ({
            actionId,
            ...(object ? { params: { object } } : {}),
            sourceHook: 'inventoryOpportunity',
            priority: 15,
            necessity: 'optional',
            band: 'opportunity',
            mayInterrupt: false,
            causationId: null,
        });

        const world = deps.ctx.world ?? null;
        const inventory = deps.inventory ?? null;
        const tCtx = clock ? clock() : 0;
        const context = brain.getActionEngine().contextFor(personId, deps);
        addSeg('inv:context', tCtx);

        // No object substrate (e.g. today's bootstrap, pure tests): keep the generic pocket flavor if eligible.
        if (!world || !inventory) {
            return context.objectAtLocation?.({ flag: 'pocketable' })
                ? [intent('pocketed_small_object')]
                : [];
        }

        const tScan = clock ? clock() : 0;
        const flagsOf = (archetypeId: string): Record<string, boolean> =>
            (inventory.getArchetype(archetypeId)?.flags as unknown as Record<string, boolean>) ?? {};
        const tagsOf = (archetypeId: string): readonly string[] =>
            inventory.getArchetype(archetypeId)?.tags ?? [];
        const carriedInstances = inventory.carriedInstances(personId);
        const carriedArchetypes = new Set(carriedInstances.map(instance => instance.archetypeId));
        const atHome = locationKey(world.locationOf(personId)) === 'home';
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId)).fork(0x0b1);

        // Carry budgets (task 088 / F1): the audit's median-553-carried hoard ends here.
        const carriedWeight = inventory.carriedWeightGrams(personId);
        const bulkyCount = carriedInstances.filter(instance => {
            const flags = flagsOf(instance.archetypeId);
            return flags.carryable && !flags.pocketable;
        }).length;
        const overWeight = carriedWeight >= INVENTORY_CONFIG.maxCarriedWeightGrams;
        const overBulk = bulkyCount >= INVENTORY_CONFIG.maxBulkyItems;

        // STOW at home (task 088 / F2): over the stow threshold, deposit the heaviest non-essential — the
        // homecoming sweep that turns the house into real storage (ingredients stay pocketed for cooking).
        if (atHome && carriedWeight > INVENTORY_CONFIG.maxCarriedWeightGrams * INVENTORY_CONFIG.stowAboveFraction) {
            const stowable = carriedInstances
                .filter(instance => !tagsOf(instance.archetypeId).includes('ingredient'))
                .sort((a, b) => (inventory.getArchetype(b.archetypeId)?.weightGrams ?? 0) - (inventory.getArchetype(a.archetypeId)?.weightGrams ?? 0)
                    || a.archetypeId.localeCompare(b.archetypeId));
            if (stowable.length > 0) {
                addSeg('inv:grabScan', tScan);
                return [intent('put_down', stowable[0]!.archetypeId)];
            }
        }

        // CURIOSITY pickups (task 088 / F1): the old always-grab becomes a rare, capacity-gated impulse —
        // the pebble/seashell charm survives, the 6,709 wristwatches don't. Novelty-biased: only archetypes
        // not already carried.
        if (!overWeight && rng.next() < INVENTORY_CONFIG.curiosityChancePerTick) {
            const grabbable = !overBulk ? world.objectsAt(world.objectLocationOf(personId))
                .map(id => inventory.getInstance(id))
                .filter((instance): instance is NonNullable<typeof instance> => !!instance && instance.owner.kind === 'none')
                .map(instance => instance.archetypeId)
                .filter(archetypeId => {
                    const flags = flagsOf(archetypeId);
                    return flags.carryable && !flags.pocketable && !carriedArchetypes.has(archetypeId);
                })
                .sort() : [];
            addSeg('inv:grabScan', tScan);
            if (grabbable.length > 0) {
                return [intent('grab', grabbable[0])];
            }
            const pocketable = context.objectAtLocation?.({ flag: 'pocketable' }) ?? false;
            if (pocketable) {
                return [intent('pocketed_small_object')];
            }
        }

        // Otherwise, occasionally use/put-down/discard something they carry. Gated so most idle ticks fall
        // through to the free-time continuous action (idleFallback, lower priority). Dropping/discarding
        // only happens at home or outside — nobody leaves their possessions strewn around someone's business
        // (which also keeps workplace stock cleanly employer-owned, the 053 sanity invariant).
        const carried = [...carriedArchetypes].sort();
        if (carried.length > 0) {
            if (rng.next() < INVENTORY_CONFIG.fiddleChancePerTick) {
                const object = carried[Math.floor(rng.next() * carried.length)]!;
                const roll = rng.next();
                const here = world.locationOf(personId).kind;
                const mayDrop = atHome || here === 'outside';
                const verb = roll < 0.7 || !mayDrop ? 'use_object' : roll < 0.9 ? 'put_down' : 'discard_object';
                return [intent(verb, object)];
            }
        }
        return [];
    },
};

// Critical needs (task 084 / proposal A4): a meter at/below its authored floor proposes a REQUIRED intent
// for the best available action that addresses it — a starving person interrupts leisure to eat, an
// exhausted one goes home to sleep. Priority sits below the shift/school obligations (100) until the
// arbitration bands land (task 086); mayInterrupt lets it displace running leisure.
const needsHook: BrainHook = {
    id: 'needs',
    kind: 'onTick',
    propose({ personId, deps, brain }): ActionIntent[] {
        const ledger = deps.ctx.markets?.needs ?? null;
        if (!ledger) {
            return [];
        }
        const critical = ledger.criticalNeedsOf(personId, deps.tick, deps.state.worldSeed);
        if (critical.length === 0) {
            return [];
        }
        const need = critical[0]!; // most starved first
        // Already addressing it? Don't thrash the very action that fixes the problem.
        const active = brain.getActionEngine().activeInstanceOf(personId);
        if (active) {
            const activeDef = brain.getActionEngine().getDefinition(active.defId);
            if ((activeDef?.satisfies?.[need] ?? 0) > 0) {
                return [];
            }
        }
        const intents: ActionIntent[] = [];
        // PANTRY FETCH (task 088 / F2): a hungry person at home with ingredients in the house but none in
        // hand picks them up FIRST — the fetch (a discrete, higher utility) commits and falls through to the
        // eat/cook pick in the SAME tick, whose carries-ingredient requirement now passes. Plans and needs
        // pull objects OUT of storage for a purpose.
        const world = deps.ctx.world ?? null;
        const inventory = deps.inventory ?? null;
        if (need === 'food' && world && inventory
            && ledger.levelOf(personId, 'food', deps.tick, deps.state.worldSeed) < INVENTORY_CONFIG.pantryFetchBelowFood
            && locationKey(world.locationOf(personId)) === 'home'
            && !inventory.carriedInstances(personId).some(instance => (inventory.getArchetype(instance.archetypeId)?.tags ?? []).includes('ingredient'))) {
            const pantry = world.objectsAt(world.objectLocationOf(personId))
                .map(id => inventory.getInstance(id))
                .filter((instance): instance is NonNullable<typeof instance> => !!instance
                    && (inventory.getArchetype(instance.archetypeId)?.tags ?? []).includes('ingredient'))
                .map(instance => instance.archetypeId)
                .sort();
            if (pantry.length > 0) {
                intents.push({
                    actionId: 'grab',
                    params: { object: pantry[0]! },
                    sourceHook: 'needs',
                    priority: 70,
                    necessity: 'required',
                    band: 'survival',
                    mayInterrupt: true,
                    causationId: null,
                });
            }
        }
        const pick = brain.selectActionForNeed(personId, need, deps);
        if (pick) {
            intents.push({
                actionId: pick,
                sourceHook: 'needs',
                priority: 60,
                necessity: 'required',
                band: 'survival', // a critical meter outranks even the shift (lunch breaks are real — L2)
                mayInterrupt: true,
                causationId: null,
            });
        }
        return intents;
    },
};

// Resume (task 087 / L5): an idle person with a paused activity picks it back up — at the ORIGINAL band and
// utility, so the interrupted walk resumes ahead of fresh idle picks but never fights real obligations.
// Expiry is engine-owned (the advance sweep); this hook only reads.
const resumeHook: BrainHook = {
    id: 'resume',
    kind: 'onTick',
    propose({ personId, brain }): ActionIntent[] {
        const engine = brain.getActionEngine();
        if (engine.activeInstanceOf(personId)) {
            return [];
        }
        const paused = engine.pausedInstanceOf(personId);
        if (!paused) {
            return [];
        }
        return [{
            actionId: paused.defId,
            sourceHook: 'resume',
            priority: (paused.utility ?? 10) + 1, // nudge past equal-utility fresh picks — finish what you started
            necessity: 'optional',
            band: paused.band ?? 'fallback',
            mayInterrupt: false,
            causationId: paused.causationId,
            resumeInstanceId: paused.id,
        }];
    },
};

// Idle fallback (onTick, lowest priority): nobody stands around forever — pick a valid low-priority activity.
const idleFallbackHook: BrainHook = {
    id: 'idleFallback',
    kind: 'onTick',
    propose({ personId, deps, brain }): ActionIntent[] {
        if (brain.getActionEngine().activeInstanceOf(personId)) {
            return [];
        }
        const pick = brain.selectFreeTimeAction(personId, deps);
        return pick ? [{
            actionId: pick,
            sourceHook: 'idleFallback',
            priority: 10,
            necessity: 'optional',
            band: 'fallback',
            mayInterrupt: false,
            causationId: null,
        }] : [];
    },
};
