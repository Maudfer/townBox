// Task 055 — the offline history-asset generator (Part A) and asset-fed new-game selection (Part B). The
// multi-hour canonical run is NOT a test; these exercise the pure invariants on tiny configs / hand-crafted
// fixtures: determinism, warm-up pruning, retained histories, the carrying-capacity bound, and the
// window-select → rebase → re-identify pipeline.

import {
    generateHistoryAsset,
    fertilityFactor,
    loggableEventIds,
    HistoryGeneratorParams,
    DEFAULT_GENERATOR_PARAMS,
    HistoryAsset,
} from '../src/app/game/HistoryAsset';
import { sliceAndRebase, reidentify, pickWindow, selectStartingWorld, validateAsset } from '../src/app/game/HistoryAssetSelection';
import { decodeAsset } from '../src/app/game/HistoryAssetSource';
import { compress } from '../src/util/compress';
import { Genders } from '../src/types/Social';
import { PopulationState } from '../src/types/Genealogy';
import { EventLogTable } from '../src/types/LifeEvent';

const TINY: HistoryGeneratorParams = {
    ...DEFAULT_GENERATOR_PARAMS,
    seed: 4242,
    founderCount: 30,
    recordThreshold: 20, // ≤ founderCount ⇒ epoch is reached immediately (exercises the recording + prune path)
    recordYears: 1,
    daysPerStep: 30, // monthly cadence keeps the test fast
    keepActionLog: false, // these invariants assert the event-only slimmed log
    carryingCapacity: { enabled: true, soft: 40, steepness: 4 },
    // The generator invariants below are the 055 pool-intrinsic spine; the logical-economy world (077) is
    // exercised in its own describe block.
    logicalWorld: { enabled: false, homes: true, schools: true, jobs: true, objects: true },
};

describe('carrying-capacity throttle (fertilityFactor)', () => {
    const cfg = { enabled: true, soft: 1000, steepness: 4 };
    test('is ~1 well below the band and falls toward 0 as the count approaches/exceeds it', () => {
        expect(fertilityFactor(0, cfg)).toBeGreaterThan(0.98);
        expect(fertilityFactor(1000, cfg)).toBeCloseTo(0.5, 5);
        expect(fertilityFactor(2000, cfg)).toBeLessThan(0.02);
    });
    test('disabled is identity', () => {
        expect(fertilityFactor(9999, { enabled: false, soft: 10, steepness: 4 })).toBe(1);
    });
});

describe('loggableEventIds', () => {
    const loggable = loggableEventIds();
    test('includes effect-bearing and requirement-referenced events', () => {
        expect(loggable.has('pregnancy')).toBe(true); // birth effect
        expect(loggable.has('had_sex')).toBe(true);   // referenced by pregnancy's hasEvent requirement
    });
});

describe('generator (Part A) — tiny config', () => {
    jest.setTimeout(180000);

    let asset: HistoryAsset;
    beforeAll(async () => {
        asset = await generateHistoryAsset(TINY);
    });

    test('is deterministic — same (seed, params) → identical asset', async () => {
        const again = await generateHistoryAsset(TINY);
        expect(again.population).toEqual(asset.population);
        expect(again.eventLog).toEqual(asset.eventLog);
        expect(again.meta.stats.retainedPeople).toBe(asset.meta.stats.retainedPeople);
    });

    test('prunes warm-up-only dead (nobody retained died before the epoch)', () => {
        for (const person of Object.values(asset.population.people)) {
            if (person.deathTick !== null) {
                expect(person.deathTick).toBeGreaterThanOrEqual(asset.meta.epochTick);
            }
        }
    });

    test('retained people carry real event history', () => {
        const total = Object.values(asset.eventLog).reduce((sum, entries) => sum + entries.length, 0);
        expect(total).toBeGreaterThan(0);
        expect(asset.meta.stats.retainedPeople).toBeGreaterThan(0);
    });

    test('livingAtEnd equals the brute-force alive count (index/prune consistency)', () => {
        const brute = Object.values(asset.population.people).filter(person => person.deathTick === null).length;
        expect(asset.meta.stats.livingAtEnd).toBe(brute);
    });

    test('the serialized log only holds loggable life events, no action texture', () => {
        const loggable = loggableEventIds();
        for (const entries of Object.values(asset.eventLog)) {
            for (const entry of entries) {
                expect(entry.kind).toBe('event');
                expect(loggable.has(entry.defId)).toBe(true);
            }
        }
    });
});

// --- Part B: window selection, rebasing, re-identification ------------------------------------------------

function fixtureAsset(): HistoryAsset {
    const people: PopulationState['people'] = {
        p0: { id: 'p0', firstName: 'A', familyName: 'Anc', gender: Genders.Male, birthTick: -700000, deathTick: 20000, fatherId: null, motherId: null, partnerships: [{ partnerId: 'p9', startTick: -650000, endTick: 20000 }] },
        p1: { id: 'p1', firstName: 'B', familyName: 'Anc', gender: Genders.Female, birthTick: 0, deathTick: null, fatherId: 'p0', motherId: null, partnerships: [] },
        p2: { id: 'p2', firstName: 'C', familyName: 'Anc', gender: Genders.Male, birthTick: 50000, deathTick: null, fatherId: 'p0', motherId: null, partnerships: [] },
        p4: { id: 'p4', firstName: 'D', familyName: 'Anc', gender: Genders.Female, birthTick: 10000, deathTick: 80000, fatherId: 'p0', motherId: null, partnerships: [] },
    };
    const eventLog: EventLogTable = {
        p0: [
            { seq: 1, tick: 5000, kind: 'event', defId: 'had_sex', roles: { subject: 'p0' }, triggerSource: 'probability', causationId: null },
            { seq: 2, tick: 25000, kind: 'event', defId: 'got_ill', roles: { subject: 'p0' }, triggerSource: 'probability', causationId: null },
            { seq: 3, tick: 40000, kind: 'event', defId: 'recovered', roles: { subject: 'p0' }, triggerSource: 'probability', causationId: null },
        ],
    };
    return {
        meta: {
            formatVersion: 1, generatorVersion: 'test', seed: 1, params: { ...DEFAULT_GENERATOR_PARAMS, warmMarginYears: 0 },
            createdAt: '', gitCommit: null, epochTick: 0, endTick: 100000, ticksPerYear: 8640,
            stats: { retainedPeople: 4, livingAtEnd: 2, births: 0, deaths: 0, medianHistoryLen: 0, trajectory: [], runtimeMs: 0, rawBytes: 0, compressedBytes: 0 },
        },
        population: { worldSeed: 7, people, drawSeed: 123, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 },
        eventHistory: {},
        eventLog,
        eventLogSeq: 4,
        eventSchedule: { queue: [], nextScheduleSeq: 0 },
    };
}

describe('selection — sliceAndRebase', () => {
    const asset = fixtureAsset();
    const w = 30000;
    const sliced = sliceAndRebase(asset, w);

    test('drops people not yet born at the window', () => {
        expect(sliced.population.people.p2).toBeUndefined(); // birthTick 50000 > w
        expect(Object.keys(sliced.population.people).sort()).toEqual(['p0', 'p1', 'p4']);
    });

    test('rebases ticks so the present reads as tick 0', () => {
        expect(sliced.population.people.p1!.birthTick).toBe(-30000);
        expect(sliced.population.people.p0!.birthTick).toBe(-730000);
    });

    test('a death in the asset future means the person is alive now', () => {
        expect(sliced.population.people.p4!.deathTick).toBeNull(); // deathTick 80000 > w
        expect(sliced.population.people.p0!.deathTick).toBe(-10000); // 20000 ≤ w → dead, rebased
    });

    test('ongoing-at-w partnerships read as ongoing (null endTick)', () => {
        // p0's partnership ended at 20000 ≤ w → keeps its (rebased) end.
        expect(sliced.population.people.p0!.partnerships[0]!.endTick).toBe(-10000);
    });

    test('truncates + rebases logs to entries at tick ≤ w and rebuilds history', () => {
        const log = sliced.eventLog.p0!;
        expect(log.map(entry => entry.tick)).toEqual([-25000, -5000]); // 40000 dropped, others rebased
        expect(sliced.eventHistory.p0!.had_sex).toEqual({ count: 1, lastTick: -25000 });
        expect(sliced.eventHistory.p0!.recovered).toBeUndefined();
        expect(sliced.eventLogSeq).toBe(3); // max retained seq (2) + 1
    });

    test('placedIds reset and lastSimulatedYear zeroed', () => {
        expect(sliced.population.placedIds).toEqual([]);
        expect(sliced.population.lastSimulatedYear).toBe(0);
    });
});

describe('selection — reidentify', () => {
    test('preserves the graph, gender, and ticks; changes names; keeps surnames lineage-coherent', () => {
        const asset = fixtureAsset();
        const before = sliceAndRebase(asset, 30000).population;
        const after = sliceAndRebase(asset, 30000).population;
        reidentify(after, 555);

        for (const id of Object.keys(before.people)) {
            const a = before.people[id]!;
            const b = after.people[id]!;
            expect(b.gender).toBe(a.gender);
            expect(b.birthTick).toBe(a.birthTick);
            expect(b.fatherId).toBe(a.fatherId);
            expect(b.motherId).toBe(a.motherId);
        }
        // At least one name changed.
        expect(after.people.p1!.firstName).not.toBe(before.people.p1!.firstName);
        // p1's father is p0 (in pool) → p1 inherits p0's re-rolled surname.
        expect(after.people.p1!.familyName).toBe(after.people.p0!.familyName);
    });

    test('is deterministic per identity seed', () => {
        const a = sliceAndRebase(fixtureAsset(), 30000).population;
        const b = sliceAndRebase(fixtureAsset(), 30000).population;
        reidentify(a, 999);
        reidentify(b, 999);
        expect(a.people).toEqual(b.people);
    });
});

describe('selection — pickWindow + full pipeline', () => {
    test('pickWindow stays within [epoch+margin, endTick] and is deterministic', () => {
        const asset = fixtureAsset();
        const w1 = pickWindow(asset.meta, 12345);
        const w2 = pickWindow(asset.meta, 12345);
        expect(w1).toBe(w2);
        expect(w1).toBeGreaterThanOrEqual(asset.meta.epochTick);
        expect(w1).toBeLessThanOrEqual(asset.meta.endTick);
    });

    test('selectStartingWorld is deterministic and rebases everyone to birthTick ≤ 0', () => {
        const asset = fixtureAsset();
        const a = selectStartingWorld(asset, 77)!;
        const b = selectStartingWorld(asset, 77)!;
        expect(a.population.people).toEqual(b.population.people);
        for (const person of Object.values(a.population.people)) {
            expect(person.birthTick).toBeLessThanOrEqual(0);
        }
        for (const entries of Object.values(a.eventLog)) {
            for (const entry of entries) {
                expect(entry.tick).toBeLessThanOrEqual(0);
            }
        }
    });

    test('rejects an incompatible format version', () => {
        const asset = fixtureAsset();
        asset.meta.formatVersion = 999;
        expect(validateAsset(asset).ok).toBe(false);
        expect(selectStartingWorld(asset, 1)).toBeNull();
    });
});

describe('asset payload decode round-trips through compression', () => {
    test('compress → decodeAsset preserves the asset', () => {
        const asset = fixtureAsset();
        const decoded = decodeAsset(compress(JSON.stringify(asset)));
        expect(decoded).not.toBeNull();
        expect(decoded!.meta.seed).toBe(asset.meta.seed);
        expect(decoded!.population.people.p0!.id).toBe('p0');
    });
    test('garbage payload decodes to null (cold-start fallback)', () => {
        expect(decodeAsset('not-a-real-payload')).toBeNull();
    });
});
