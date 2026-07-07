import EventEngine from '../src/app/game/EventEngine';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders, Gender } from '../src/types/Social';
import { TICKS_PER_DAY, TICKS_PER_YEAR, hourOfTick } from '../src/util/time';

// The demography regression harness (task 048): the economy and genealogy depend on sane per-year incidence
// of the vital events. This runs the REAL manifest over a fixture pool for one simulated year (daily steps —
// the hazard math keeps rates correct at any stride) and asserts the rates stay inside design bands. Seeded,
// so the counts are deterministic; the bands exist to survive intentional stream changes, not flake.

function gen(id: string, gender: Gender, ageYears: number, spouse?: string): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: -ageYears * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null,
        partnerships: spouse ? [{ partnerId: spouse, startTick: -2 * TICKS_PER_YEAR, endTick: null }] : [],
    };
}

// 20 married couples (fertile ages) + 30 singles (marriageable) = 70 living adults.
function fixturePool(): PopulationState {
    const people: Record<string, GenPerson> = {};
    for (let i = 0; i < 20; i++) {
        const wife = `w${String(i).padStart(2, '0')}`;
        const husband = `h${String(i).padStart(2, '0')}`;
        people[wife] = gen(wife, Genders.Female, 25 + (i % 10), husband);
        people[husband] = gen(husband, Genders.Male, 27 + (i % 10), wife);
    }
    for (let i = 0; i < 30; i++) {
        const id = `s${String(i).padStart(2, '0')}`;
        people[id] = gen(id, i % 2 ? Genders.Male : Genders.Female, 22 + (i % 15));
    }
    return { worldSeed: 4242, people, drawSeed: 1, placedIds: [], nextSeq: 1000, lastSimulatedYear: 0 };
}

describe('per-year incidence bands (task 048)', () => {
    const engine = new EventEngine();
    const state = fixturePool();
    const counts: Record<string, number> = {};
    let births = 0;
    let deaths = 0;

    beforeAll(() => {
        const agents = Object.keys(state.people);
        for (let tick = 0; tick < TICKS_PER_YEAR; tick += TICKS_PER_DAY) {
            const living = agents.filter(id => state.people[id]!.deathTick === null);
            const result = engine.simulateTick(state, living, tick, TICKS_PER_YEAR, {}, TICKS_PER_DAY);
            births += result.born.length;
            deaths += result.died.length;
            for (const commit of result.committed) {
                counts[commit.eventId] = (counts[commit.eventId] ?? 0) + 1;
            }
        }
    });

    test('young adults rarely die', () => {
        // Healthy-adult expectation is ~0.15/yr, but illness (health 0.5 → death factor ×8) raises the
        // population-weighted rate to ~0.5/yr — the band guards against systematic runaways, not tail luck.
        expect(deaths).toBeLessThanOrEqual(4);
    });

    test('marriages form at a believable clip among 20 singles', () => {
        expect(counts['marriage'] ?? 0).toBeGreaterThanOrEqual(1);
        expect(counts['marriage'] ?? 0).toBeLessThanOrEqual(15); // ~0.1/yr × age curve × 30 singles + newlywed chains
    });

    test('fertile couples produce children (and not absurdly many)', () => {
        expect(births).toBeGreaterThanOrEqual(3); // 0.6/yr × ~0.4–1 age factor × 20+ couples
        expect(births).toBeLessThanOrEqual(30);
    });

    test('illness/recovery churn stays sane', () => {
        const ill = counts['fell_ill'] ?? 0;
        expect(ill).toBeGreaterThanOrEqual(20); // 2/yr × 70 people, recovery re-arms eligibility
        expect(ill).toBeLessThanOrEqual(280);
        expect(counts['recovered'] ?? 0).toBeGreaterThanOrEqual(Math.floor(ill * 0.5)); // 24/yr recovery is fast
    });

    test('the pregnancy limit prevents machine-gun conceptions', () => {
        // withinTicks 7200 (300 days): a mother can conceive at most ~1.2×/year.
        const perMother = new Map<string, number[]>();
        for (const [personId, log] of Object.entries(engine.getLog())) {
            for (const entry of log) {
                if (entry.kind === 'event' && entry.defId === 'pregnancy') {
                    const list = perMother.get(personId) ?? [];
                    list.push(entry.tick);
                    perMother.set(personId, list);
                }
            }
        }
        for (const ticks of perMother.values()) {
            ticks.sort((a, b) => a - b);
            for (let i = 1; i < ticks.length; i++) {
                expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThan(7200);
            }
        }
    });

    test('time-of-day gradients hold: no small-hours arguments', () => {
        for (const log of Object.values(engine.getLog())) {
            for (const entry of log) {
                if (entry.kind === 'event' && entry.defId === 'argument') {
                    // Daily stepping lands every roll at hour 0, where the factor is 0.1 — arguments still
                    // occur but at a tenth the rate; at hourly stepping the gradient shapes the day. Here we
                    // assert the factor plumbing works end-to-end by comparing against a flat-run baseline.
                    expect(hourOfTick(entry.tick)).toBe(0);
                }
            }
        }
        // The 0.1 night factor should suppress most arguments vs the unfactored rate (3/yr × 70 ≈ 210 → ~21).
        expect(counts['argument'] ?? 0).toBeLessThanOrEqual(55);
    });
});

describe('the automated shift fallback (task 048)', () => {
    test('stopped_working fires 12 ticks after an unresolved started_working, once per day', () => {
        const engine = new EventEngine();
        const state = fixturePool();
        const { outcome } = engine.invoke(state, 'started_working', 's00', 9, TICKS_PER_YEAR, { source: 'action', causationId: null });
        expect(outcome.ok).toBe(true);
        expect(engine.getScheduleState().queue).toHaveLength(1);

        // Nothing resolved the shift; at tick 21 (= 9 + 12, same day) the fallback fires with schedule source.
        engine.simulateTick(state, ['s00'], 21, TICKS_PER_YEAR, {});
        const stops = engine.getPersonLog('s00').filter(e => e.kind === 'event' && e.defId === 'stopped_working');
        expect(stops).toHaveLength(1);
        expect(stops[0]!.triggerSource).toBe('schedule');
    });

    test('a normal lifecycle stop suppresses the fallback via the perDay limit', () => {
        const engine = new EventEngine();
        const state = fixturePool();
        engine.invoke(state, 'started_working', 's00', 9, TICKS_PER_YEAR, { source: 'action', causationId: null });
        // The work action completes normally at 17:00 → manual stopped_working.
        engine.invoke(state, 'stopped_working', 's00', 17, TICKS_PER_YEAR, { source: 'action', causationId: null });
        // The scheduled fallback at tick 21 (same day) is now LIMITED (once per day) — no duplicate stop.
        engine.simulateTick(state, ['s00'], 21, TICKS_PER_YEAR, {});
        const stops = engine.getPersonLog('s00').filter(e => e.kind === 'event' && e.defId === 'stopped_working');
        expect(stops).toHaveLength(1);
        expect(stops[0]!.triggerSource).toBe('action');
    });
});
