import EventEngine from 'game/events/EventEngine';
import eventsConfig from 'json/events.json';
import { PopulationState, GenPerson, PersonId } from 'types/Genealogy';
import { EventManifest, JobMarket } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Job seeking made visible (task 097 / proposal I1): applied_for_a_job commits in the shared log surface as
// the `jobApplications` context attribute (a one-week recency count), get_job's hazard factor reads it (an
// active applicant is hired in days, a passive one keeps the status-quo rate — factor ×1 at zero
// applications, so engine-only harnesses are untouched), and application_rejected only ever happens to
// people actually applying.

const TPY = 8640;
const EVENTS = eventsConfig as unknown as EventManifest;
const WEEK = 168;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(): PopulationState {
    return { worldSeed: 11, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
}

// A hiring stub: always a reachable slot, hire flips employment (so get_job stops re-firing).
function stubMarket(): JobMarket & { hiredAt: number | null } {
    const employed = new Set<PersonId>();
    const market = {
        hiredAt: null as number | null,
        isEmployed: (id: PersonId) => employed.has(id),
        canHire: (id: PersonId) => !employed.has(id),
        hire: (id: PersonId) => {
            employed.add(id);
            return true;
        },
        fire: () => {},
    };
    return market as unknown as JobMarket & { hiredAt: number | null };
}

// Log one applied_for_a_job action entry directly into the shared log.
function logApplication(engine: EventEngine, personId: PersonId, tick: number): void {
    engine.getLifeLog().append(personId, {
        tick, kind: 'action', defId: 'applied_for_a_job', instanceId: null, lifecycle: 'performed',
        params: {}, parentInstanceId: null, triggerSource: 'brain', causationId: null,
    });
}

describe('the jobApplications attribute', () => {
    test('counts recent applications and ages them out after a week', () => {
        const engine = new EventEngine(EVENTS);
        const state = makeState();
        expect(engine.contextFor(state, 'a', 1000, TPY).getAttr('jobApplications')).toBe(0);
        logApplication(engine, 'a', 1000);
        logApplication(engine, 'a', 1010);
        expect(engine.contextFor(state, 'a', 1010, TPY).getAttr('jobApplications')).toBe(2);
        // A week after the first, only the second still counts; later, none.
        expect(engine.contextFor(state, 'a', 1000 + WEEK + 1, TPY).getAttr('jobApplications')).toBe(1);
        expect(engine.contextFor(state, 'a', 1010 + WEEK + 1, TPY).getAttr('jobApplications')).toBe(0);
    });
});

describe('seeking drives hiring', () => {
    // Cohort frequencies, not a single pair: per-agent draws are heavily correlated across nearby
    // (seed, tick) pairs, so one applicant-vs-twin comparison can tie by stream luck. Forty unemployed
    // people, half of them actively applying, over five days — expected hire rates ≈ 86% vs ≈ 38%
    // (the factor is ×4 while an application is recent), a gap the cohort makes deterministic.
    test('the applying half of a cohort is hired at a decisively higher rate within days', () => {
        const engine = new EventEngine(EVENTS);
        const ids = Array.from({ length: 40 }, (_, index) => `p${String(index).padStart(2, '0')}`);
        const people: Record<string, GenPerson> = {};
        for (const id of ids) {
            people[id] = person(id);
        }
        const state: PopulationState = { worldSeed: 5, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        const market = stubMarket();
        const appliers = new Set(ids.filter((_, index) => index % 2 === 0));
        for (let tick = 0; tick < 5 * 24; tick++) {
            if (tick % 48 === 0) {
                for (const id of appliers) {
                    if (!market.isEmployed(id)) {
                        logApplication(engine, id, tick);
                    }
                }
            }
            engine.simulateTick(state, ids, tick, TPY, { markets: { jobMarket: market } });
        }
        const hired = (group: (id: string) => boolean): number => ids.filter(id => group(id) && market.isEmployed(id)).length;
        const activeHired = hired(id => appliers.has(id));
        const passiveHired = hired(id => !appliers.has(id));
        // Deterministic on this seed; the thresholds sit well inside the ≈86%-vs-≈38% expectation gap.
        expect(activeHired).toBeGreaterThan(passiveHired);
        expect(activeHired).toBeGreaterThanOrEqual(12);
        expect(passiveHired).toBeLessThanOrEqual(13);
    });

    test('rejections only happen to people who applied', () => {
        const rejectionsOf = (applies: boolean): number => {
            const engine = new EventEngine(EVENTS);
            const state = makeState();
            for (let tick = 0; tick < TPY; tick += 24) {
                if (applies && tick % 48 === 0) {
                    logApplication(engine, 'a', tick);
                }
                engine.simulateTick(state, ['a'], tick, TPY, {}, 24); // no market → never actually hired
            }
            return engine.getPersonLog('a').filter(e => e.kind === 'event' && e.defId === 'application_rejected').length;
        };
        expect(rejectionsOf(false)).toBe(0); // the attr gate: no applications, no rejections — ever
        expect(rejectionsOf(true)).toBeGreaterThan(0); // a year of seeking collects some turn-downs
    });
});
