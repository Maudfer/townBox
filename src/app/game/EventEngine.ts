import { fakerPT_BR } from '@faker-js/faker';

import { SeededRandom } from 'util/random';
import { dayOfTick, hourOfTick } from 'util/time';
import { evaluateCurve, clamp01 } from 'util/curve';
import { evaluatePredicate } from 'util/predicate';
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
    EventLogEntry,
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

import { compileEvents, EventGraph } from 'game/EventCompiler';

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

const ROLE_SUBJECT = 'subject';

// An emit effect captured while an event's effects apply; flushed into the TickResult (with the commit seq
// as causation) only if the event commits.
interface PendingSignal {
    signal: string;
    personId: PersonId | null;
    tick: number;
}

export default class EventEngine {
    private manifest: EventManifest;
    private graph: EventGraph;
    private history: EventHistoryTable;
    // The append-only per-person event log (task 040): the source of truth for what happened when, with a
    // globally monotonic commit seq + causation. `history` above is its derived aggregate index (hasEvent).
    private log: EventLogTable;
    private nextLogSeq: number;
    // Automated-trigger machinery (task 042): the persisted schedule queue plus rule indexes derived from
    // the manifest at construction (afterEvent: source event id -> dependents; atHour: hour -> event ids).
    private schedule: ScheduleState;
    private afterEventRules: Map<string, { eventId: string; delayTicks: number }[]>;
    private atHourRules: Map<number, string[]>;
    // Event-driven attributes not derived from the pool (e.g. marital after divorce/widowhood).
    private overlay: Record<PersonId, Record<string, Value>>;
    // Adapters bound for the current simulateTick pass; null in pure/test runs that don't provide them.
    private jobMarket: JobMarket | null; // employment (task 015)
    private ledger: MoneyLedger | null; // money (task 017)
    private housing: HousingMarket | null; // move-out eligibility (task 024)
    private skills: SkillRegistry | null; // skill grants from education events (task 032)

    constructor(manifest: EventManifest = DEFAULT_EVENT_MANIFEST) {
        this.manifest = manifest;
        this.graph = compileEvents(manifest);
        this.history = {};
        this.log = {};
        this.nextLogSeq = 0;
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

    getLog(): EventLogTable {
        return this.log;
    }

    // A person's life log, oldest first. The inspector renders it newest-first (its concern, not the engine's).
    getPersonLog(personId: PersonId): EventLogEntry[] {
        return this.log[personId] ?? [];
    }

    getNextLogSeq(): number {
        return this.nextLogSeq;
    }

    // Restores the log (save/load). `nextSeq` persists explicitly; when absent (defensive), derive it from
    // the highest stored seq so future commits never collide.
    loadLog(log: EventLogTable, nextSeq?: number): void {
        this.log = log ?? {};
        if (nextSeq !== undefined) {
            this.nextLogSeq = nextSeq;
        } else {
            let max = -1;
            for (const entries of Object.values(this.log)) {
                for (const entry of entries) {
                    max = Math.max(max, entry.seq);
                }
            }
            this.nextLogSeq = max + 1;
        }
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
        const seq = this.nextLogSeq++;
        const entries = this.log[personId] ?? [];
        entries.push({ seq, tick, kind: 'event', defId: eventId, roles: { ...roles }, triggerSource, causationId });
        this.log[personId] = entries;

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

    // Per-step firing probability. `ticksPerStep` (default 1 = daily, as live play uses) lets a caller advance in
    // coarser strides — the history bootstrap (036) steps by e.g. a week to stay tractable over the whole pool —
    // while keeping the hazard correct: the per-step chance is 1 − (1 − annual)^(ticksPerStep / ticksPerYear).
    private perTickProbability(spec: ProbabilitySpec, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, ticksPerYear: number, ticksPerStep: number): number {
        let annual = spec.perYear;
        for (const factor of spec.factors ?? []) {
            const [role, attr] = factor.driver.split('.');
            const id = role ? roleMap[role] : undefined;
            const raw = id && attr ? this.agentAttr(state, id, attr, tick, ticksPerYear) : undefined;
            annual *= evaluateCurve(factor.curve, typeof raw === 'number' ? raw : 0);
        }
        annual = clamp01(annual);
        if (annual <= 0) {
            return 0;
        }
        if (annual >= 1) {
            return 1;
        }
        return 1 - Math.pow(1 - annual, ticksPerStep / ticksPerYear);
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
                this.skills?.acquireSkill(subjectId, String(effect.value ?? ''));
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
        const result: TickResult = { died: [], born: [], signals: [] };
        const rng = new SeededRandom(state.worldSeed).fork(tick);
        fakerPT_BR.seed((state.worldSeed ^ (tick * 0x9e3779b1)) >>> 0);
        const markets = ctx.markets ?? {};
        this.jobMarket = markets.jobMarket ?? null;
        this.ledger = markets.ledger ?? null;
        this.housing = markets.housing ?? null;
        this.skills = markets.skills ?? null;

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

        // Lifecycle phases 4–5: probabilistic evaluation + commit.
        for (const agentId of agents) {
            const record = state.people[agentId];
            if (!record || !isAliveAt(record, tick)) {
                continue;
            }

            const excludedToday = new Set<string>();
            for (const eventId of this.graph.topoOrder) {
                if (excludedToday.has(eventId)) {
                    continue;
                }
                const event = this.manifest[eventId];
                const probability = event?.triggers?.probabilistic;
                if (!event || !probability) {
                    continue; // manual/automated-only events never roll
                }
                if (!this.limitAllows(agentId, eventId, event.limit, tick)) {
                    continue;
                }

                const subjectWhere = event.roles[ROLE_SUBJECT]?.where;
                const subjectCtx = this.makeContext(state, agentId, { [ROLE_SUBJECT]: agentId }, tick, ticksPerYear);
                if (subjectWhere && !evaluatePredicate(subjectWhere, subjectCtx)) {
                    continue;
                }

                // Roll BEFORE resolving co-participant roles (task 040): candidate `where` searches are
                // O(agents), so paying them only on a successful roll is what makes running the full manifest
                // (marriage included) affordable pool-wide in bootstrap mode. The rare probability factor that
                // drives on a non-subject role forces early resolution.
                let roleMap: Record<string, PersonId> | null = { [ROLE_SUBJECT]: agentId };
                const needsRolesForProbability = (probability.factors ?? []).some(factor => !factor.driver.startsWith(`${ROLE_SUBJECT}.`));
                if (needsRolesForProbability) {
                    roleMap = this.resolveRoles(event, agentId, state, agents, tick, ticksPerYear, rng, {});
                    if (!roleMap) {
                        continue;
                    }
                }

                const pTick = this.perTickProbability(probability, roleMap, state, tick, ticksPerYear, ticksPerStep);
                if (!rng.chance(pTick)) {
                    continue;
                }

                if (!needsRolesForProbability) {
                    roleMap = this.resolveRoles(event, agentId, state, agents, tick, ticksPerYear, rng, {});
                    if (!roleMap) {
                        continue; // a required role can't be filled — the event can't happen this tick
                    }
                }

                const seq = this.commit(state, eventId, event, agentId, roleMap, tick, result, rng, 'probability', null);
                if (seq === null) {
                    continue; // event aborted (e.g. job slot taken this tick) — treat as if it never fired
                }
                for (const excluded of this.graph.excludes[eventId] ?? []) {
                    excludedToday.add(excluded);
                }
            }
        }

        this.jobMarket = null;
        this.ledger = null;
        this.housing = null;
        this.skills = null;
        return result;
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
        const result: TickResult = { died: [], born: [], signals: [] };
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

        const markets = ctx.markets ?? {};
        this.jobMarket = markets.jobMarket ?? null;
        this.ledger = markets.ledger ?? null;
        this.housing = markets.housing ?? null;
        this.skills = markets.skills ?? null;
        const rng = new SeededRandom(state.worldSeed).fork(tick).fork(0x51ed);
        fakerPT_BR.seed((state.worldSeed ^ (tick * 0x9e3779b1) ^ 0x51ed) >>> 0);

        const agents = Object.keys(state.people).filter(id => isAliveAt(state.people[id]!, tick)).sort();
        const outcome = this.attemptCommit(state, eventId, subjectId, agents, tick, ticksPerYear, result, rng, cause.source, cause.causationId, bindings);

        this.jobMarket = null;
        this.ledger = null;
        this.housing = null;
        this.skills = null;
        return { outcome, result };
    }
}
