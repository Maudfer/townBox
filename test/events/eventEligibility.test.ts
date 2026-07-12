import EventEngine from 'game/events/EventEngine';
import { PopulationState, GenPerson, PersonTable } from 'types/Genealogy';
import { EventManifest } from 'types/LifeEvent';
import { Genders, Gender } from 'types/Social';
import { TICKS_PER_YEAR } from 'util/time';

// The eligibility index (the runtime realization of the compiler's discriminant gates — the "indexKeys"
// lever flagged dormant since task 038/052). The optimization is REQUIRED to be behavior-invariant: the
// probabilistic walk consumes exactly one RNG draw per probabilistic event per agent whether or not the
// gates skip the post-draw work, so an indexed run and an unindexed run must produce bit-identical
// outcomes. These tests enforce that contract over the real manifest, guard the mid-tick snapshot
// refresh, and benchmark the tick cost the index exists to contain (task 055's offline generator).

function gen(id: string, gender: Gender, ageYears: number, overrides: Partial<GenPerson> = {}): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fam',
        gender,
        birthTick: -ageYears * TICKS_PER_YEAR,
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
        ...overrides,
    };
}

function marryInState(state: PopulationState, aId: string, bId: string, startTick: number): void {
    state.people[aId]!.partnerships.push({ partnerId: bId, startTick, endTick: null });
    state.people[bId]!.partnerships.push({ partnerId: aId, startTick, endTick: null });
}

// A demographically mixed cohort: children, fertile couples, working-age singles, and the elderly, so the
// equivalence run exercises every gate family (gender, marital, employed, and both age bounds).
function mixedCohort(count: number, worldSeed: number): PopulationState {
    const people: PersonTable = {};
    const ages = [3, 9, 15, 19, 24, 30, 37, 45, 58, 67, 74, 83];
    for (let i = 0; i < count; i++) {
        const id = `p${String(i).padStart(3, '0')}`;
        people[id] = gen(id, i % 2 ? Genders.Male : Genders.Female, ages[i % ages.length]!);
    }
    const state: PopulationState = { worldSeed, people, drawSeed: 0, placedIds: Object.keys(people), nextSeq: count, lastSimulatedYear: 0 };
    // Marry some adult opposite-gender neighbours so marital-gated and partner-bound events participate.
    for (let i = 4; i + 1 < count; i += 6) {
        marryInState(state, `p${String(i).padStart(3, '0')}`, `p${String(i + 1).padStart(3, '0')}`, -2 * TICKS_PER_YEAR);
    }
    return state;
}

function livingIds(state: PopulationState): string[] {
    return Object.keys(state.people).filter(id => state.people[id]!.deathTick === null);
}

describe('eligibility index — behavior invariance (real manifest)', () => {
    test('an indexed run and an unindexed run are bit-identical over a stretch of hourly ticks', () => {
        const indexed = new EventEngine();
        const reference = new EventEngine(undefined, undefined, { eligibilityIndex: false });
        const stateA = mixedCohort(36, 991);
        const stateB = mixedCohort(36, 991);

        for (let tick = 9 * TICKS_PER_YEAR; tick < 9 * TICKS_PER_YEAR + 24 * 14; tick++) {
            const resultA = indexed.simulateTick(stateA, livingIds(stateA), tick, TICKS_PER_YEAR);
            const resultB = reference.simulateTick(stateB, livingIds(stateB), tick, TICKS_PER_YEAR);
            expect(resultA).toEqual(resultB);
        }

        expect(indexed.getLog()).toEqual(reference.getLog());
        expect(indexed.getHistory()).toEqual(reference.getHistory());
        expect(JSON.stringify(stateA.people)).toBe(JSON.stringify(stateB.people));
    });

    test('coarse strides (the bootstrap path) are equally invariant', () => {
        const indexed = new EventEngine();
        const reference = new EventEngine(undefined, undefined, { eligibilityIndex: false });
        const stateA = mixedCohort(24, 1234);
        const stateB = mixedCohort(24, 1234);

        const stride = 24 * 7; // weekly, as the history bootstrap steps
        for (let step = 0; step < 26; step++) {
            const tick = step * stride;
            const resultA = indexed.simulateTick(stateA, livingIds(stateA), tick, TICKS_PER_YEAR, {}, stride);
            const resultB = reference.simulateTick(stateB, livingIds(stateB), tick, TICKS_PER_YEAR, {}, stride);
            expect(resultA).toEqual(resultB);
        }
        expect(indexed.getLog()).toEqual(reference.getLog());
        expect(JSON.stringify(stateA.people)).toBe(JSON.stringify(stateB.people));
    });
});

describe('eligibility index — mid-tick discriminant changes', () => {
    // A same-tick chain that flips a discriminant: `celebration` requires marital=='engaged', which only
    // becomes true when `engagement` commits earlier in the SAME tick (topo-ordered via the hasEvent
    // dependency; `marital` reads the overlay the setAttr effect mutates). A stale snapshot would
    // gate-skip the celebration; the post-commit refresh must let it through.
    test('an event gated on a discriminant set earlier the same tick still fires', () => {
        const manifest: EventManifest = {
            engagement: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } } },
                triggers: { probabilistic: { perYear: 200000 } },
                effects: [{ type: 'setAttr', attr: 'marital', value: 'engaged' }],
            },
            celebration: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'engaged' }, { hasEvent: 'engagement' }] } } },
                triggers: { probabilistic: { perYear: 200000 } },
                effects: [{ type: 'emit', signal: 'celebrated' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = mixedCohort(1, 55);

        const result = engine.simulateTick(state, livingIds(state), 0, TICKS_PER_YEAR);

        expect(result.signals.map(s => s.signal)).toContain('celebrated');
    });
});

describe('eligibility index — tick cost at content scale (tasks 052/055)', () => {
    test('300 agents x the full manifest stays inside the hourly tick budget', () => {
        const engine = new EventEngine();
        const state = mixedCohort(300, 777);
        const startTick = 5 * TICKS_PER_YEAR;

        // Warm-up: let the JIT settle and the engine accrue some history so the measurement is honest.
        for (let tick = startTick - 6; tick < startTick; tick++) {
            engine.simulateTick(state, livingIds(state), tick, TICKS_PER_YEAR);
        }

        const ticks = 48;
        const began = performance.now();
        for (let tick = startTick; tick < startTick + ticks; tick++) {
            engine.simulateTick(state, livingIds(state), tick, TICKS_PER_YEAR);
        }
        const perTick = (performance.now() - began) / ticks;

         
        console.info(`[eligibility-index bench] ${perTick.toFixed(2)}ms per tick (300 agents, full manifest)`);
        // Task 052 measured ~99ms/tick before the index; this landed at ~4ms plain / ~5ms under coverage
        // instrumentation locally. Shared CI runners under coverage instrumentation have been observed at
        // ~16ms, so the bound is a coarse regression guard, not a microbenchmark: <40ms still fails loudly
        // if the index is lost or the pre-index ~99ms cost returns, while tolerating slow/noisy runners.
        expect(perTick).toBeLessThan(40);
    });
});
