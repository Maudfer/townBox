import { fakerPT_BR } from '@faker-js/faker';

import { SeededRandom } from 'util/random';
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
    DayResult,
    JobMarket,
    MoneyLedger,
} from 'types/LifeEvent';

import { compileEvents, EventGraph } from 'game/EventCompiler';

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

export default class EventEngine {
    private manifest: EventManifest;
    private graph: EventGraph;
    private history: EventHistoryTable;
    // Event-driven attributes not derived from the pool (e.g. marital after divorce/widowhood).
    private overlay: Record<PersonId, Record<string, Value>>;
    // Adapters bound for the current simulateDay pass; null in pure/test runs that don't provide them.
    private jobMarket: JobMarket | null; // employment (task 015)
    private ledger: MoneyLedger | null; // money (task 017)

    constructor(manifest: EventManifest = DEFAULT_EVENT_MANIFEST) {
        this.manifest = manifest;
        this.graph = compileEvents(manifest);
        this.history = {};
        this.overlay = {};
        this.jobMarket = null;
        this.ledger = null;
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

    hasEvent(personId: PersonId, eventId: string, tick: number, query?: HasEventQuery): boolean {
        const record = this.history[personId]?.[eventId];
        if (!record) {
            return false;
        }
        if (query?.minCount !== undefined && record.count < query.minCount) {
            return false;
        }
        if (query?.withinDays !== undefined && tick - record.lastTick > query.withinDays) {
            return false;
        }
        return true;
    }

    private recordEvent(personId: PersonId, eventId: string, tick: number): void {
        const personHistory = this.history[personId] ?? {};
        const existing = personHistory[eventId];
        personHistory[eventId] = { count: (existing?.count ?? 0) + 1, lastTick: tick };
        this.history[personId] = personHistory;
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
    private resolveRoles(event: EventDefinition, subjectId: PersonId, state: PopulationState, agentIds: PersonId[], tick: number, ticksPerYear: number, rng: SeededRandom): Record<string, PersonId> | null {
        const roleMap: Record<string, PersonId> = { [ROLE_SUBJECT]: subjectId };
        for (const [roleName, spec] of Object.entries(event.roles)) {
            if (roleName === ROLE_SUBJECT) {
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

    private perDayProbability(spec: ProbabilitySpec, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, ticksPerYear: number): number {
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
        return 1 - Math.pow(1 - annual, 1 / ticksPerYear);
    }

    // Applies an event's effects in order. Returns false if an effect failed to commit (currently only a failed
    // acquireSlot — e.g. the last matching job slot was taken earlier the same day), which aborts the event so
    // it is not recorded. Aborting effects must therefore come first (get_job lists acquireSlot first).
    private applyEffects(event: EventDefinition, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, result: DayResult, rng: SeededRandom): boolean {
        const subjectId = roleMap[ROLE_SUBJECT]!;
        for (const effect of event.effects) {
            if (!this.applyEffect(effect, subjectId, roleMap, state, tick, result, rng)) {
                return false;
            }
        }
        return true;
    }

    private applyEffect(effect: Effect, subjectId: PersonId, roleMap: Record<string, PersonId>, state: PopulationState, tick: number, result: DayResult, rng: SeededRandom): boolean {
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
                result.signals.push({ signal: effect.signal ?? 'unknown', personId: targetId, tick });
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
    simulateDay(
        state: PopulationState,
        agentIds: PersonId[],
        tick: number,
        ticksPerYear: number,
        adapters: { jobMarket?: JobMarket | null; ledger?: MoneyLedger | null } = {}
    ): DayResult {
        const result: DayResult = { died: [], born: [], signals: [] };
        const rng = new SeededRandom(state.worldSeed).fork(tick);
        fakerPT_BR.seed((state.worldSeed ^ (tick * 0x9e3779b1)) >>> 0);
        this.jobMarket = adapters.jobMarket ?? null;
        this.ledger = adapters.ledger ?? null;

        const agents = [...agentIds].sort();
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
                if (!event) {
                    continue;
                }

                const subjectWhere = event.roles[ROLE_SUBJECT]?.where;
                const subjectCtx = this.makeContext(state, agentId, { [ROLE_SUBJECT]: agentId }, tick, ticksPerYear);
                if (subjectWhere && !evaluatePredicate(subjectWhere, subjectCtx)) {
                    continue;
                }

                const roleMap = this.resolveRoles(event, agentId, state, agents, tick, ticksPerYear, rng);
                if (!roleMap) {
                    continue;
                }

                const pDay = this.perDayProbability(event.probability, roleMap, state, tick, ticksPerYear);
                if (!rng.chance(pDay)) {
                    continue;
                }

                const committed = this.applyEffects(event, roleMap, state, tick, result, rng);
                if (!committed) {
                    continue; // event aborted (e.g. job slot taken this tick) — treat as if it never fired
                }
                this.recordEvent(agentId, eventId, tick);
                for (const excluded of this.graph.excludes[eventId] ?? []) {
                    excludedToday.add(excluded);
                }
            }
        }

        this.jobMarket = null;
        this.ledger = null;
        return result;
    }
}
