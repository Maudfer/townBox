import { fakerPT_BR } from '@faker-js/faker';

import { SeededRandom } from 'util/random';
import { dayOfTick, hourOfTick } from 'util/time';
import { evaluateCurve, Curve } from 'util/curve';
import { evaluatePredicate, compareValues } from 'util/predicate';
import { isAliveAt, ageAt, spouseAt } from 'util/kinship';

import { SimulationContext, Value, HasEventQuery } from 'types/Simulation';
import { Genders, Gender } from 'types/Social';
import { PersonId, PopulationState } from 'types/Genealogy';
import {
    EventManifest,
    EventDefinition,
    ProbabilitySpec,
    Effect,
    EventHistoryTable,
    EventLogTable,
    PersonLogEntry,
    TriggerSource,
    TickResult,
    InvokeOutcome,
    OccurrenceLimit,
    ScheduleState,
    JobMarket,
    MoneyLedger,
    HousingMarket,
    SkillRegistry,
} from 'types/LifeEvent';

import { compileEvents, EventGraph, GateComparison } from 'game/EventCompiler';
import LifeLog from 'game/LifeLog';

import { ExecutionContext } from 'types/Execution';

import eventsConfig from 'json/events.json';

export const DEFAULT_EVENT_MANIFEST: EventManifest = eventsConfig as unknown as EventManifest;

// Engine B — the per-day life-event runtime (docs/tasks/013 §5.7). Runs over materialized people only. For each
// agent it walks the compiled topological order, evaluates eligibility (subject predicate + bindable roles),
// rolls the per-day probability (authored per-year, converted via the clock's ticksPerYear), and applies the
// event's typed effects — mutating the genealogy pool (deaths, marriages, births) and a per-person attribute
// overlay (employment etc.), recording history, and enqueuing signals for the materialized world to reconcile.
//
// Mutual exclusivity is enforced two ways, both backed by the compiler: a fired event's `excludes` set is
// skipped for the rest of the day, and because each event's context is recomputed from current state, an event
// that invalidates another's requirements (death -> not alive) also fails its re-check. So two conflicting
// events can never fire for the same person on the same day.
//
// Determinism: each day forks its own RNG from the world seed + tick (mirroring the coarse sim), and faker is
// seeded likewise, so a day's outcome is reproducible across save/load.
//
// The eligibility index (the compiler's `subjectGates`, dormant since the 038 discovery, activated here):
// the probabilistic walk consumes exactly ONE RNG draw per probabilistic event per agent regardless of
// whether the event is plausible — so skipping an implausible event's post-draw work cannot move the
// stream, and an indexed run is bit-identical to an unindexed one (enforced by test/eventEligibility).
// Per agent per tick the engine snapshots the five discriminants (alive/gender/marital/employed/age) once,
// walks a flat precompiled plan instead of re-deriving from the manifest, checks each event's gates against
// the snapshot right after its draw, and reads the hazard from a per-tick cache for the (overwhelmingly
// common) events whose probability factors derive from the tick alone (hourOfDay). Only events that survive
// all of that pay for probability factors, limits, full predicates, and role searches.

const ROLE_SUBJECT = 'subject';

// An emit effect captured while an event's effects apply; flushed into the TickResult (with the commit seq
// as causation) only if the event commits.
interface PendingSignal {
    signal: string;
    personId: PersonId | null;
    tick: number;
}

// A probability factor with its driver string pre-split ("subject.age" -> role/attr), so the hot loop never
// re-parses (task 052).
interface ParsedFactor {
    role: string;
    attr: string;
    curve: Curve;
}

// One entry of the precompiled probabilistic walk plan: everything the per-agent hot loop needs, resolved
// once at construction (in topo order, probabilistic events only — manual/automated-only events never roll
// and were `continue`d immediately by the old topoOrder walk, so dropping them here changes nothing).
interface ProbPlanEntry {
    id: string;
    def: EventDefinition;
    prob: ProbabilitySpec;
    factors: ParsedFactor[];
    // Some probability factor drives on a non-subject role, forcing role resolution before the roll.
    needsRoles: boolean;
    // Every factor derives from the tick alone (subject.hourOfDay): the hazard is identical for all living
    // agents, so simulateTick computes it once per tick instead of once per (agent, event).
    tickConstant: boolean;
    gates: GateComparison[];
    excludes: string[];
    limit: OccurrenceLimit | undefined;
}

// The engine-side view of one agent's discriminants, computed once per (agent, tick) through the same
// agentAttr reads the full predicate evaluator uses, and rebuilt after any commit attempt that may have
// mutated them (marry/divorce/setDeath/hire/fire/setAttr).
type DiscriminantSnapshot = Record<string, Value | undefined>;

const DISCRIMINANT_SNAPSHOT_ATTRS = ['alive', 'gender', 'marital', 'employed', 'age'] as const;

export default class EventEngine {
    private manifest: EventManifest;
    private graph: EventGraph;
    private history: EventHistoryTable;
    // The append-only per-person event log (task 040): the source of truth for what happened when, with a
    // globally monotonic commit seq + causation. `history` above is its derived aggregate index (hasEvent).
    private lifeLog: LifeLog;
    // Automated-trigger machinery (task 042): the persisted schedule queue plus rule indexes derived from
    // the manifest at construction (afterEvent: source event id -> dependents; atHour: hour -> event ids).
    private schedule: ScheduleState;
    private afterEventRules: Map<string, { eventId: string; delayTicks: number }[]>;
    private atHourRules: Map<number, string[]>;
    // The precompiled probabilistic walk plan (task 052 perf + the eligibility index): flat, in topo order,
    // with parsed factors, discriminant gates, and per-event excludes/limit resolved once.
    private probPlan: ProbPlanEntry[];
    // False only in test/reference runs that verify the index is behavior-invariant.
    private eligibilityIndex: boolean;
    // Event-driven attributes not derived from the pool (e.g. marital after divorce/widowhood).
    private overlay: Record<PersonId, Record<string, Value>>;
    // Adapters bound for the current simulateTick pass; null in pure/test runs that don't provide them.
    private jobMarket: JobMarket | null; // employment (task 015)
    private ledger: MoneyLedger | null; // money (task 017)
    private housing: HousingMarket | null; // move-out eligibility (task 024)
    private skills: SkillRegistry | null; // skill grants from education events (task 032)

    constructor(manifest: EventManifest = DEFAULT_EVENT_MANIFEST, lifeLog: LifeLog = new LifeLog(), options: { eligibilityIndex?: boolean } = {}) {
        this.manifest = manifest;
        this.graph = compileEvents(manifest);
        this.eligibilityIndex = options.eligibilityIndex ?? true;
        this.history = {};
        this.lifeLog = lifeLog;
        this.schedule = { queue: [], nextScheduleSeq: 0 };
        this.afterEventRules = new Map();
        this.atHourRules = new Map();
        for (const [eventId, definition] of Object.entries(manifest)) {
            for (const rule of definition.triggers?.automated?.rules ?? []) {
                if ('afterEvent' in rule) {
                    const dependents = this.afterEventRules.get(rule.afterEvent) ?? [];
                    dependents.push({ eventId, delayTicks: rule.delayTicks });
                    this.afterEventRules.set(rule.afterEvent, dependents);
                } else if ('atHour' in rule) {
                    const ids = this.atHourRules.get(rule.atHour) ?? [];
                    ids.push(eventId);
                    this.atHourRules.set(rule.atHour, ids);
                }
            }
        }
        for (const ids of this.atHourRules.values()) {
            ids.sort();
        }
        this.probPlan = [];
        for (const eventId of this.graph.topoOrder) {
            const definition = manifest[eventId];
            const spec = definition?.triggers?.probabilistic;
            if (!definition || !spec) {
                continue;
            }
            const factors: ParsedFactor[] = (spec.factors ?? []).map(factor => {
                const [role = '', attr = ''] = factor.driver.split('.');
                return { role, attr, curve: factor.curve };
            });
            this.probPlan.push({
                id: eventId,
                def: definition,
                prob: spec,
                factors,
                needsRoles: factors.some(factor => factor.role !== ROLE_SUBJECT),
                tickConstant: factors.every(factor => factor.role === ROLE_SUBJECT && factor.attr === 'hourOfDay'),
                gates: this.graph.subjectGates[eventId] ?? [],
                excludes: this.graph.excludes[eventId] ?? [],
                limit: definition.limit,
            });
        }
        this.overlay = {};
        this.jobMarket = null;
        this.ledger = null;
        this.housing = null;
        this.skills = null;
    }

    // A human label for an event id (task 032): the manifest's authored label, else a prettified id. Used by the
    // person event-log (027) and feed (029).
    getEventLabel(eventId: string): string {
        const label = this.manifest[eventId]?.label;
        if (label) {
            return label;
        }
        return eventId.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    getGraph(): EventGraph {
        return this.graph;
    }

    getHistory(): EventHistoryTable {
        return this.history;
    }

    loadHistory(history: EventHistoryTable): void {
        this.history = history ?? {};
    }

    // The shared life log (task 043): the ActionEngine appends to the SAME instance so events and actions
    // share one global commit sequence.
    getLifeLog(): LifeLog {
        return this.lifeLog;
    }

    getLog(): EventLogTable {
        return this.lifeLog.getTable();
    }

    // A person's life log, oldest first. The inspector renders it newest-first (its concern, not the engine's).
    getPersonLog(personId: PersonId): PersonLogEntry[] {
        return this.lifeLog.getPersonLog(personId);
    }

    getNextLogSeq(): number {
        return this.lifeLog.getNextSeq();
    }

    loadLog(log: EventLogTable, nextSeq?: number): void {
        this.lifeLog.load(log, nextSeq);
    }

    getScheduleState(): ScheduleState {
        return this.schedule;
    }

    loadScheduleState(schedule: ScheduleState): void {
        this.schedule = schedule ?? { queue: [], nextScheduleSeq: 0 };
    }

    // Enqueues an automated trigger (task 042): event `eventId` will be attempted for `subjectId` at
    // `dueTick` with `causationId` chaining to whatever scheduled it. Public — Actions (043), shift rules
    // (045), and other systems schedule through this; afterEvent rules use it internally.
    scheduleTrigger(eventId: string, subjectId: PersonId, dueTick: number, causationId: number | null): void {
        this.schedule.queue.push({ id: this.schedule.nextScheduleSeq++, eventId, subjectId, dueTick, causationId });
    }

    // Whether the event's occurrence limit allows another commit for this person at this tick. Checked on
    // every trigger path (probabilistic roll, manual invoke, scheduled drain).
    private limitAllows(personId: PersonId, eventId: string, limit: OccurrenceLimit | undefined, tick: number): boolean {
        if (!limit) {
            return true;
        }
        const record = this.history[personId]?.[eventId];
        if (!record) {
            return true;
        }
        if ('once' in limit) {
            if (limit.once === 'ever') {
                return false; // already happened at least once
            }
            return dayOfTick(record.lastTick) !== dayOfTick(tick); // perDay
        }
        return tick - record.lastTick > limit.withinTicks;
    }

    hasEvent(personId: PersonId, eventId: string, tick: number, query?: HasEventQuery): boolean {
        const record = this.history[personId]?.[eventId];
        if (!record) {
            return false;
        }
        if (query?.minCount !== undefined && record.count < query.minCount) {
            return false;
        }
        if (query?.withinTicks !== undefined && tick - record.lastTick > query.withinTicks) {
            return false;
        }
        return true;
    }

    // Commits an event to the person's append-only log (assigning the global seq) and updates the derived
    // aggregate index. Returns the seq so signals/downstream records can chain causation to this commit.
    private recordEvent(personId: PersonId, eventId: string, tick: number, roles: Record<string, PersonId>, triggerSource: TriggerSource, causationId: number | null): number {
        const seq = this.lifeLog.append(personId, { tick, kind: 'event', defId: eventId, roles: { ...roles }, triggerSource, causationId });

        const personHistory = this.history[personId] ?? {};
        const existing = personHistory[eventId];
        personHistory[eventId] = { count: (existing?.count ?? 0) + 1, lastTick: tick };
        this.history[personId] = personHistory;
        return seq;
    }

    // Reads an agent's current attribute value, deriving age/alive/marital from the pool and falling back to the
    // overlay for event-set attributes.
    private agentAttr(state: PopulationState, id: PersonId, attr: string, tick: number, ticksPerYear: number): Value | undefined {
        const record = state.people[id];
        if (!record) {
            return undefined;
        }
        switch (attr) {
            case 'alive':
                return isAliveAt(record, tick);
            case 'age':
                return ageAt(record, tick, ticksPerYear);
            case 'gender':
                return record.gender;
            case 'marital': {
                const spouseId = spouseAt(state.people, id, tick);
                if (spouseId && state.people[spouseId] && isAliveAt(state.people[spouseId]!, tick)) {
                    return 'married';
                }
                return (this.overlay[id]?.['marital'] as Value) ?? 'single';
            }
            case 'employed':
                // Employment derives from a real assigned job via the market (task 015); without a market
                // (pure/test runs), nobody is employed.
                return this.jobMarket ? this.jobMarket.isEmployed(id) : false;
            case 'canBeHired':
                // True when there is a reachable open position the person's skills can fill. Gates get_job
                // eligibility so the per-day roll only happens when a hire is actually possible.
                return this.jobMarket ? this.jobMarket.canHire(id) : false;
            case 'money':
                // Wealth derives from the economy ledger (task 017); 0 in pure/test runs without one.
                return this.ledger ? this.ledger.getPersonBalance(id) : 0;
            case 'health':
                // Health in [0, 1] (task 032): full unless an illness/injury lowered it via setAttr. The death
                // event reads it as a probability gradient (low health → higher mortality).
                return (this.overlay[id]?.['health'] as number) ?? 1;
            case 'retired':
                // Set true by the retirement event (task 032); gates get_job so retirees aren't re-hired.
                return (this.overlay[id]?.['retired'] as boolean) ?? false;
            case 'hourOfDay':
                // Time-of-day (0..23) for probability gradients (task 048: arguments at 03:00 are rarer than
                // at dinner time) and predicates. Derived from the tick, identical in both execution modes.
                return hourOfTick(tick);
            case 'canMoveOut':
                // True when the person could leave home now (adult non-head with a vacant home available). Gates
                // move_out eligibility (task 024). Without a housing adapter (pure/test runs), nobody can.
                return this.housing ? this.housing.canMoveOut(id) : false;
            default:
                return this.overlay[id]?.[attr];
        }
    }

    private makeContext(state: PopulationState, id: PersonId, roleMap: Record<string, PersonId>, tick: number, ticksPerYear: number): SimulationContext {
        return {
            getAttr: (attr: string) => this.agentAttr(state, id, attr, tick, ticksPerYear),
            hasEvent: (eventId: string, query?: HasEventQuery) => this.hasEvent(id, eventId, tick, query),
            role: (name: string) => {
                const roleId = roleMap[name];
                return roleId ? this.makeContext(state, roleId, {}, tick, ticksPerYear) : null;
            },
        };
    }

    // Resolves a "relationOf:role" binding (currently partnerOf) to a living person id, or null.
    private resolveBind(bind: string, roleMap: Record<string, PersonId>, state: PopulationState, tick: number): PersonId | null {
        const [relation, base] = bind.split(':');
        const baseId = base ? roleMap[base] : undefined;
        if (!baseId) {
            return null;
        }
        if (relation === 'partnerOf') {
            const partnerId = spouseAt(state.people, baseId, tick);
            if (partnerId && state.people[partnerId] && isAliveAt(state.people[partnerId]!, tick)) {
                return partnerId;
            }
        }
        return null;
    }

    // Binds every non-subject role (by indexed relation or candidate search). Returns null if any required role
    // cannot be filled, making the event ineligible.
    private resolveRoles(event: EventDefinition, subjectId: PersonId, state: PopulationState, agentIds: PersonId[], tick: number, ticksPerYear: number, rng: SeededRandom, bindings: Record<string, PersonId> = {}): Record<string, PersonId> | null {
        const roleMap: Record<string, PersonId> = { [ROLE_SUBJECT]: subjectId };
        for (const [roleName, spec] of Object.entries(event.roles)) {
            if (roleName === ROLE_SUBJECT) {
                continue;
            }
            // Caller-supplied bindings (manual invocations, task 042) pin the role — the bound person must
            // still exist and be alive, but no search runs.
            const pinned = bindings[roleName];
            if (pinned) {
                const bound = state.people[pinned];
                if (!bound || !isAliveAt(bound, tick)) {
                    return null;
                }
                roleMap[roleName] = pinned;
                continue;
            }
            if (spec.bind) {
                const bound = this.resolveBind(spec.bind, roleMap, state, tick);
                if (!bound) {
                    return null;
                }
                roleMap[roleName] = bound;
            } else if (spec.where) {
                const taken = new Set(Object.values(roleMap));
                const candidates: PersonId[] = [];
                for (const candidateId of agentIds) {
                    if (taken.has(candidateId)) {
                        continue;
                    }
                    const ctx = this.makeContext(state, candidateId, { [ROLE_SUBJECT]: candidateId }, tick, ticksPerYear);
                    if (evaluatePredicate(spec.where, ctx)) {
                        candidates.push(candidateId);
                    }
                }
                if (candidates.length === 0) {
                    return null;
                }
                roleMap[roleName] = rng.pick(candidates.sort());
            }
        }
        return roleMap;
    }

    // One agent's discriminant values, read through the same agentAttr the predicate evaluator uses so a
    // gate can never disagree with the predicate node it was compiled from.
    private discriminantSnapshot(state: PopulationState, id: PersonId, tick: number, ticksPerYear: number): DiscriminantSnapshot {
        const snapshot: DiscriminantSnapshot = {};
        for (const attr of DISCRIMINANT_SNAPSHOT_ATTRS) {
            snapshot[attr] = this.agentAttr(state, id, attr, tick, ticksPerYear);
        }
        return snapshot;
    }

    private static gatesPass(gates: GateComparison[], snapshot: DiscriminantSnapshot): boolean {
        for (const gate of gates) {
            if (!compareValues(snapshot[gate.attr], gate.op, gate.value)) {
                return false;
            }
        }
        return true;
    }

    // The per-step hazard of a tick-constant plan entry (every factor drives on subject.hourOfDay, which is
    // hourOfTick(tick) for every living agent) — the agent-independent mirror of perTickProbability, kept
    // equivalent by the eligibility invariance test.
    private static tickConstantHazard(entry: ProbPlanEntry, tick: number, ticksPerYear: number, ticksPerStep: number): number {
        let annual = entry.prob.perYear;
        const hour = hourOfTick(tick);
        for (const factor of entry.factors) {
            annual *= evaluateCurve(factor.curve, hour);
        }
        if (annual <= 0) {
            return 0;
        }
        return 1 - Math.exp(-annual * (ticksPerStep / ticksPerYear));
    }

    // Per-step firing probability. `ticksPerStep` (default 1 = daily, as live play uses) lets a caller advance in
    // coarser strides — the history bootstrap (036) steps by e.g. a week to stay tractable over the whole pool —
    // while keeping the hazard correct: the per-step chance is 1 − (1 − annual)^(ticksPerStep / ticksPerYear).
    private perTickProbability(spec: ProbabilitySpec, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, ticksPerYear: number, ticksPerStep: number, parsedFactors?: ParsedFactor[]): number {
        let annual = spec.perYear;
        const factors = parsedFactors ?? (spec.factors ?? []).map(factor => {
            const [role = '', attr = ''] = factor.driver.split('.');
            return { role, attr, curve: factor.curve };
        });
        for (const factor of factors) {
            const id = factor.role ? roleMap[factor.role] : undefined;
            const raw = id && factor.attr ? this.agentAttr(state, id, factor.attr, tick, ticksPerYear) : undefined;
            annual *= evaluateCurve(factor.curve, typeof raw === 'number' ? raw : 0);
        }
        if (annual <= 0) {
            return 0;
        }
        // `perYear` is a RATE (expected occurrences per year), not a probability — a Poisson conversion keeps
        // authored rates honest at ANY stride (task 048). The old formula clamped the annual value to 1 first,
        // which silently turned every rate >= 1/yr into a per-step certainty (fell_ill at 2/yr fired every
        // single tick). For rates << 1 the two formulas agree to within a fraction of a percent.
        return 1 - Math.exp(-annual * (ticksPerStep / ticksPerYear));
    }

    // Applies an event's effects in order. Returns false if an effect failed to commit (currently only a failed
    // acquireSlot — e.g. the last matching job slot was taken earlier the same day), which aborts the event so
    // it is not recorded. Aborting effects must therefore come first (get_job lists acquireSlot first).
    // `pendingSignals` collects emit effects; the caller flushes them into the TickResult only once the event
    // actually commits (task 040), stamping each with the committed log seq as its causation.
    private applyEffects(event: EventDefinition, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, result: TickResult, rng: SeededRandom, pendingSignals: PendingSignal[]): boolean {
        const subjectId = roleMap[ROLE_SUBJECT]!;
        for (const effect of event.effects) {
            if (!this.applyEffect(effect, subjectId, roleMap, state, tick, result, rng, pendingSignals)) {
                return false;
            }
        }
        return true;
    }

    private applyEffect(effect: Effect, subjectId: PersonId, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, result: TickResult, rng: SeededRandom, pendingSignals: PendingSignal[]): boolean {
        switch (effect.type) {
            case 'setDeath': {
                const record = state.people[subjectId];
                if (record && record.deathTick === null) {
                    record.deathTick = tick;
                    result.died.push(subjectId);
                }
                return true;
            }
            case 'marry': {
                const partnerId = effect.role ? roleMap[effect.role] : undefined;
                if (partnerId) {
                    this.marry(state, subjectId, partnerId, tick);
                    this.setOverlay(subjectId, 'marital', 'married');
                    this.setOverlay(partnerId, 'marital', 'married');
                }
                return true;
            }
            case 'divorce': {
                const partnerId = spouseAt(state.people, subjectId, tick);
                this.endPartnership(state, subjectId, tick);
                this.setOverlay(subjectId, 'marital', 'divorced');
                if (partnerId) {
                    this.setOverlay(partnerId, 'marital', 'divorced');
                }
                return true;
            }
            case 'birth': {
                const motherId = effect.mother ? roleMap[effect.mother] : subjectId;
                const fatherId = effect.father ? roleMap[effect.father] : undefined;
                if (motherId && fatherId) {
                    const childId = this.birth(state, motherId, fatherId, tick, rng);
                    result.born.push({ id: childId, motherId, fatherId });
                }
                return true;
            }
            case 'setAttr': {
                if (effect.attr !== undefined && effect.value !== undefined) {
                    this.setOverlay(subjectId, effect.attr, effect.value);
                }
                return true;
            }
            case 'emit': {
                const targetId = effect.target ? roleMap[effect.target] ?? null : subjectId;
                pendingSignals.push({ signal: effect.signal ?? 'unknown', personId: targetId, tick });
                return true;
            }
            // Acquire/release a job slot via the employment market (task 015). acquireSlot is a real
            // precondition: if no slot can be filled (no market, or a same-day race took the last one), it
            // returns false and aborts the event.
            case 'acquireSlot':
                return this.jobMarket ? this.jobMarket.hire(subjectId) : false;
            case 'releaseSlot':
                this.jobMarket?.fire(subjectId);
                return true;
            // Grant a real skill to the subject via the skill registry (task 032 education events). No-op
            // (still commits) without a registry, or when the skill is unknown/already held.
            case 'acquireSkill':
                this.skills?.acquireSkill(subjectId, String(effect.value ?? ''), effect.proficiency);
                return true;
            // Credit/debit the target's balance via the economy ledger (task 017). The amount Curve is a
            // constant for now (no driver); economy events refine this later.
            case 'adjustMoney': {
                const targetId = effect.target ? roleMap[effect.target] : subjectId;
                if (this.ledger && targetId) {
                    this.ledger.adjustPerson(targetId, effect.amount ? evaluateCurve(effect.amount, 0) : 0);
                }
                return true;
            }
        }
    }

    private setOverlay(id: PersonId, attr: string, value: Value): void {
        const bag = this.overlay[id] ?? {};
        bag[attr] = value;
        this.overlay[id] = bag;
    }

    private marry(state: PopulationState, aId: PersonId, bId: PersonId, tick: number): void {
        const a = state.people[aId];
        const b = state.people[bId];
        if (!a || !b) {
            return;
        }
        a.partnerships.push({ partnerId: bId, startTick: tick, endTick: null });
        b.partnerships.push({ partnerId: aId, startTick: tick, endTick: null });
    }

    private endPartnership(state: PopulationState, id: PersonId, tick: number): void {
        const person = state.people[id];
        if (!person) {
            return;
        }
        for (const partnership of person.partnerships) {
            if (partnership.endTick === null && partnership.startTick <= tick) {
                partnership.endTick = tick;
                const partner = state.people[partnership.partnerId];
                const mirror = partner?.partnerships.find(p => p.partnerId === id && p.endTick === null);
                if (mirror) {
                    mirror.endTick = tick;
                }
            }
        }
    }

    private birth(state: PopulationState, motherId: PersonId, fatherId: PersonId, tick: number, rng: SeededRandom): PersonId {
        const mother = state.people[motherId];
        const father = state.people[fatherId];
        const id = `p${state.nextSeq++}`;
        const gender: Gender = rng.chance(0.5) ? Genders.Male : Genders.Female;
        state.people[id] = {
            id,
            firstName: fakerPT_BR.person.firstName(gender),
            familyName: father?.familyName ?? mother?.familyName ?? fakerPT_BR.person.lastName(),
            gender,
            birthTick: tick,
            deathTick: null,
            fatherId,
            motherId,
            partnerships: [],
        };
        return id;
    }

    // Advances all materialized agents by one day. Mutates the pool (deaths/marriages/births) and the engine's
    // history/overlay; returns what changed for the caller to reconcile the materialized world.
    simulateTick(
        state: PopulationState,
        agentIds: PersonId[],
        tick: number,
        ticksPerYear: number,
        ctx: Partial<ExecutionContext> = {},
        ticksPerStep: number = 1
    ): TickResult {
        const result: TickResult = { died: [], born: [], signals: [], committed: [] };
        const rng = new SeededRandom(state.worldSeed).fork(tick);
        fakerPT_BR.seed((state.worldSeed ^ (tick * 0x9e3779b1)) >>> 0);
        this.bindMarkets(ctx);

        const agents = [...agentIds].sort();

        // Lifecycle phase 3 (task 042): resolve automated triggers due this tick — the persisted schedule
        // queue first (dueTick asc, then enqueue order), then the atHour sweep. Both commit through the same
        // path as everything else, with triggerSource 'schedule'.
        const due = this.schedule.queue.filter(item => item.dueTick <= tick).sort((a, b) => a.dueTick - b.dueTick || a.id - b.id);
        if (due.length > 0) {
            this.schedule.queue = this.schedule.queue.filter(item => item.dueTick > tick);
            for (const item of due) {
                this.attemptCommit(state, item.eventId, item.subjectId, agents, tick, ticksPerYear, result, rng, 'schedule', item.causationId, {});
            }
        }
        // atHour rules: fire when the step window [tick, tick + ticksPerStep) covers the hour. Coarse
        // stepping (bootstrap) covers whole days per step, so daily atHour events still fire once per step.
        for (const [hour, eventIds] of [...this.atHourRules.entries()].sort((a, b) => a[0] - b[0])) {
            const windowCovers = ticksPerStep >= 24 || (((hour - hourOfTick(tick)) + 24) % 24) < ticksPerStep;
            if (!windowCovers) {
                continue;
            }
            for (const eventId of eventIds) {
                for (const agentId of agents) {
                    this.attemptCommit(state, eventId, agentId, agents, tick, ticksPerYear, result, rng, 'schedule', null, {});
                }
            }
        }

        // Lifecycle phases 4–5: probabilistic evaluation + commit, over the precompiled plan.
        //
        // Roll FIRST (tasks 040/052): at hundreds of manifest events the per-tick hazard is tiny for almost
        // all of them, so paying eligibility costs (limit lookup, subject predicate, role searches) only on
        // successful rolls is what keeps the hourly pass affordable at content scale. Distributions are
        // unchanged — the roll is independent of eligibility.
        //
        // The eligibility index rides on that ordering: every plan entry consumes its one draw
        // unconditionally, so gate-skipping an implausible event (or reading a cached hazard) cannot move
        // the RNG stream, and indexed results are bit-identical to unindexed ones. The per-tick hazard
        // cache holds the per-step probability for tick-constant entries; -1 marks entries that need
        // per-agent factor evaluation.
        const plan = this.probPlan;
        const hazardCache = new Float64Array(plan.length);
        for (let i = 0; i < plan.length; i++) {
            const entry = plan[i]!;
            hazardCache[i] = this.eligibilityIndex && entry.tickConstant
                ? EventEngine.tickConstantHazard(entry, tick, ticksPerYear, ticksPerStep)
                : -1;
        }

        for (const agentId of agents) {
            const record = state.people[agentId];
            if (!record || !isAliveAt(record, tick)) {
                continue;
            }

            let snapshot = this.discriminantSnapshot(state, agentId, tick, ticksPerYear);
            const excludedToday = new Set<string>();
            for (let i = 0; i < plan.length; i++) {
                const entry = plan[i]!;
                // Excluded events are skipped BEFORE their draw (as the pre-index walk did) — the exclusion
                // set is part of the deterministic stream contract.
                if (excludedToday.size > 0 && excludedToday.has(entry.id)) {
                    continue;
                }

                // The rare probability factor that drives on a non-subject role forces early role
                // resolution (and skips the draw when a role can't bind, as before).
                let roleMap: Record<string, PersonId> | null = { [ROLE_SUBJECT]: agentId };
                if (entry.needsRoles) {
                    roleMap = this.resolveRoles(entry.def, agentId, state, agents, tick, ticksPerYear, rng, {});
                    if (!roleMap) {
                        continue;
                    }
                }

                // The one unconditional draw (was rng.chance(pTick)). The gate check and the roll compare
                // are both draw-free, so their order is outcome-irrelevant — the loop runs the cheaper one
                // first: against a cached hazard the roll fails overwhelmingly often in two ops, and the
                // gates then only screen the rare successful roll before it reaches the expensive work
                // (limit, full predicate, role search). Uncached entries gate first so an implausible
                // subject skips the per-agent factor evaluation too.
                const draw = rng.next();
                const cached = hazardCache[i]!;
                if (cached >= 0) {
                    if (draw >= cached) {
                        continue;
                    }
                    if (!EventEngine.gatesPass(entry.gates, snapshot)) {
                        continue; // a necessary condition of the subject predicate fails — it can't commit
                    }
                } else {
                    if (this.eligibilityIndex && !EventEngine.gatesPass(entry.gates, snapshot)) {
                        continue;
                    }
                    const pTick = this.perTickProbability(entry.prob, roleMap, state, tick, ticksPerYear, ticksPerStep, entry.factors);
                    if (draw >= pTick) {
                        continue;
                    }
                }

                if (!this.limitAllows(agentId, entry.id, entry.limit, tick)) {
                    continue;
                }
                const subjectWhere = entry.def.roles[ROLE_SUBJECT]?.where;
                const subjectCtx = this.makeContext(state, agentId, { [ROLE_SUBJECT]: agentId }, tick, ticksPerYear);
                if (subjectWhere && !evaluatePredicate(subjectWhere, subjectCtx)) {
                    continue;
                }

                if (!entry.needsRoles) {
                    roleMap = this.resolveRoles(entry.def, agentId, state, agents, tick, ticksPerYear, rng, {});
                    if (!roleMap) {
                        continue; // a required role can't be filled — the event can't happen this tick
                    }
                }

                const seq = this.commit(state, entry.id, entry.def, agentId, roleMap, tick, result, rng, 'probability', null);
                // Even an aborted commit may have applied leading effects (effects before the aborting one
                // are not rolled back), so the discriminant snapshot is rebuilt after every commit attempt.
                snapshot = this.discriminantSnapshot(state, agentId, tick, ticksPerYear);
                if (seq === null) {
                    continue; // event aborted (e.g. job slot taken this tick) — treat as if it never fired
                }
                for (const excluded of entry.excludes) {
                    excludedToday.add(excluded);
                }
            }
        }

        this.unbindMarkets();
        return result;
    }

    // Binds/unbinds the market adapters the attribute reads and effects consult. Public (task 043) so the
    // TickRunner can hold markets bound across the Action-engine phases that run before simulateTick.
    bindMarkets(ctx: Partial<ExecutionContext>): void {
        const markets = ctx.markets ?? {};
        this.jobMarket = markets.jobMarket ?? null;
        this.ledger = markets.ledger ?? null;
        this.housing = markets.housing ?? null;
        this.skills = markets.skills ?? null;
    }

    unbindMarkets(): void {
        this.jobMarket = null;
        this.ledger = null;
        this.housing = null;
        this.skills = null;
    }

    // A subject-only SimulationContext for external requirement checks (the Action engine, task 043; Brain,
    // task 046). Reads whatever markets are currently bound — callers that need market-derived attributes
    // (employed/canBeHired/money) bindMarkets first.
    contextFor(state: PopulationState, personId: PersonId, tick: number, ticksPerYear: number): SimulationContext {
        return this.makeContext(state, personId, { [ROLE_SUBJECT]: personId }, tick, ticksPerYear);
    }

    // Full eligibility + commit for a non-probabilistic trigger path (scheduled drain, atHour sweep, manual
    // invoke): subject must be alive and pass its predicate, the limit must allow, and roles must resolve
    // (caller-supplied bindings take precedence). Returns the reason it didn't happen, or ok + the log seq.
    private attemptCommit(
        state: PopulationState,
        eventId: string,
        subjectId: PersonId,
        agents: PersonId[],
        tick: number,
        ticksPerYear: number,
        result: TickResult,
        rng: SeededRandom,
        source: TriggerSource,
        causationId: number | null,
        bindings: Record<string, PersonId>
    ): InvokeOutcome {
        const event = this.manifest[eventId];
        if (!event) {
            return { ok: false, reason: 'unknownEvent' };
        }
        const record = state.people[subjectId];
        if (!record || !isAliveAt(record, tick)) {
            return { ok: false, reason: 'ineligible' };
        }
        if (!this.limitAllows(subjectId, eventId, event.limit, tick)) {
            return { ok: false, reason: 'limited' };
        }
        const subjectWhere = event.roles[ROLE_SUBJECT]?.where;
        const subjectCtx = this.makeContext(state, subjectId, { [ROLE_SUBJECT]: subjectId }, tick, ticksPerYear);
        if (subjectWhere && !evaluatePredicate(subjectWhere, subjectCtx)) {
            return { ok: false, reason: 'ineligible' };
        }
        const roleMap = this.resolveRoles(event, subjectId, state, agents, tick, ticksPerYear, rng, bindings);
        if (!roleMap) {
            return { ok: false, reason: 'rolesUnresolved' };
        }
        const seq = this.commit(state, eventId, event, subjectId, roleMap, tick, result, rng, source, causationId);
        if (seq === null) {
            return { ok: false, reason: 'aborted' };
        }
        return { ok: true, seq };
    }

    // The single commit path every trigger type funnels through: apply effects, append to the log, flush the
    // event's signals (chained to this commit), and enqueue afterEvent dependents. Returns the log seq, or
    // null when an effect aborted the event.
    private commit(
        state: PopulationState,
        eventId: string,
        event: EventDefinition,
        subjectId: PersonId,
        roleMap: Record<string, PersonId>,
        tick: number,
        result: TickResult,
        rng: SeededRandom,
        source: TriggerSource,
        causationId: number | null
    ): number | null {
        const pendingSignals: PendingSignal[] = [];
        if (!this.applyEffects(event, roleMap, state, tick, result, rng, pendingSignals)) {
            return null;
        }
        const seq = this.recordEvent(subjectId, eventId, tick, roleMap, source, causationId);
        result.committed.push({ personId: subjectId, eventId, seq });
        for (const pending of pendingSignals) {
            result.signals.push({ ...pending, eventId, causationId: seq });
        }
        // Automated afterEvent rules (task 042): each commit of a source event schedules its dependents for
        // the same subject, causation chaining to this commit.
        for (const dependent of this.afterEventRules.get(eventId) ?? []) {
            this.scheduleTrigger(dependent.eventId, subjectId, tick + dependent.delayTicks, seq);
        }
        return seq;
    }

    // Manual invocation (task 042): other systems (Actions 043, Brain 046, Job Orchestrator 047, shift
    // rules) commit an event through the same pipeline as every other trigger. The event must declare a
    // `manual` trigger; `requiredBindings` must all be supplied. Deterministic: the RNG forks off the tick
    // stream with a fixed salt so invocations don't perturb the probabilistic stream.
    invoke(
        state: PopulationState,
        eventId: string,
        subjectId: PersonId,
        tick: number,
        ticksPerYear: number,
        cause: { source: TriggerSource; causationId: number | null },
        bindings: Record<string, PersonId> = {},
        ctx: Partial<ExecutionContext> = {}
    ): { outcome: InvokeOutcome; result: TickResult } {
        const result: TickResult = { died: [], born: [], signals: [], committed: [] };
        const event = this.manifest[eventId];
        if (!event) {
            return { outcome: { ok: false, reason: 'unknownEvent' }, result };
        }
        const manual = event.triggers?.manual;
        if (!manual) {
            return { outcome: { ok: false, reason: 'notManual' }, result };
        }
        for (const required of manual.requiredBindings ?? []) {
            if (!bindings[required]) {
                return { outcome: { ok: false, reason: 'missingBinding' }, result };
            }
        }

        // Preserve any markets the caller already holds bound (e.g. invocations from inside the Action
        // engine's TickRunner window) and restore them afterwards.
        const previous = { jobMarket: this.jobMarket, ledger: this.ledger, housing: this.housing, skills: this.skills };
        if (ctx.markets) {
            this.bindMarkets(ctx);
        }
        const rng = new SeededRandom(state.worldSeed).fork(tick).fork(0x51ed);
        fakerPT_BR.seed((state.worldSeed ^ (tick * 0x9e3779b1) ^ 0x51ed) >>> 0);

        const agents = Object.keys(state.people).filter(id => isAliveAt(state.people[id]!, tick)).sort();
        const outcome = this.attemptCommit(state, eventId, subjectId, agents, tick, ticksPerYear, result, rng, cause.source, cause.causationId, bindings);

        this.jobMarket = previous.jobMarket;
        this.ledger = previous.ledger;
        this.housing = previous.housing;
        this.skills = previous.skills;
        return { outcome, result };
    }
}
