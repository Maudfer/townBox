import { generateHistoryAsset, DEFAULT_GENERATOR_PARAMS, HistoryGeneratorParams } from 'game/history/HistoryAsset';
import { pickWindow, sliceAndRebase, windowSocialGraph } from 'game/history/HistoryAssetSelection';
import { SocialGraphState } from 'types/Relationship';

// Two-band generator fidelity (task 105 / K1–K3): the final hotYears of the recording window step HOURLY —
// windowed people carry true diurnal texture instead of the day-quantized, workless histories the Part 0
// audit found — while the deep past keeps the affordable day stride. The asset now also carries the elective
// SOCIAL GRAPH (the B5 completion): logical-venue co-location grows real friendships off-map, selection
// windows them, and drawn people arrive with friends, not just family.

const TPY = 8640;

const TINY: HistoryGeneratorParams = {
    ...DEFAULT_GENERATOR_PARAMS,
    seed: 5,
    founderCount: 24,
    recordThreshold: 18,
    recordYears: 3,
    daysPerStep: 1,
    hotYears: 1,
    warmMarginYears: 1,
    maxWarmupYears: 60,
    keepActionLog: false,
    reducedEventManifest: true,
    profile: false,
    skillSnapshotYears: 1,
    flushIntervalYears: 5,
    populationControl: { enabled: true, target: 24, band: 0.1, suppressLevel: 0.1, allowLevel: 1 },
    logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
    safety: { maxRuntimeMs: 0, maxPeople: 0 },
};

describe('the two-band asset (generated once, asserted throughout)', () => {
    jest.setTimeout(300000);
    let asset: Awaited<ReturnType<typeof generateHistoryAsset>>;

    beforeAll(async () => {
        asset = await generateHistoryAsset(TINY);
    });

    test('K1: the cold band is day-quantized; the hot band carries true hourly texture', () => {
        const { epochTick, endTick } = asset.meta;
        const hotStart = epochTick + Math.round((TINY.recordYears - TINY.hotYears) * TPY);
        expect(endTick - hotStart).toBeGreaterThanOrEqual(TPY - 24); // a full hot year ran

        let coldEntries = 0;
        let hotOffHour = 0;
        let hotEntries = 0;
        for (const entries of Object.values(asset.eventLog)) {
            for (const entry of entries) {
                if (entry.tick < hotStart) {
                    coldEntries++;
                    expect(entry.tick % 24).toBe(0); // the coarse band only ever decides at midnight
                } else {
                    hotEntries++;
                    if (entry.tick % 24 !== 0) {
                        hotOffHour++;
                    }
                }
            }
        }
        expect(coldEntries).toBeGreaterThan(0);
        expect(hotEntries).toBeGreaterThan(0);
        // The whole point: life happens at real hours of the day inside the hot band.
        expect(hotOffHour).toBeGreaterThan(0);
    });

    test('K3: logical-venue co-location grew real elective edges off-map', () => {
        expect(asset.socialGraph).toBeDefined();
        expect(Object.keys(asset.socialGraph!.edges).length).toBeGreaterThan(0);
    });

    test('the window lands INSIDE the hot band, and the sliced graph arrives windowed and rebased', () => {
        const w = pickWindow(asset.meta, 42);
        const hotStart = asset.meta.endTick - Math.round(TINY.hotYears * TPY) + 1;
        expect(w).toBeGreaterThanOrEqual(hotStart);
        expect(w).toBeLessThanOrEqual(asset.meta.endTick);

        const sliced = sliceAndRebase(asset, w);
        expect(sliced.socialGraph).toBeDefined();
        for (const [key, edge] of Object.entries(sliced.socialGraph!.edges)) {
            const [a, b] = key.split('|');
            expect(sliced.population.people[a!]).toBeDefined(); // both endpoints retained
            expect(sliced.population.people[b!]).toBeDefined();
            expect(edge.formedAtTick).toBeLessThanOrEqual(0); // formed in the (rebased) past
            expect(edge.lastInteractionTick).toBeLessThanOrEqual(0);
        }
    });
});

describe('windowSocialGraph (pure)', () => {
    test('future edges and dropped endpoints are excluded; kept edges rebase exactly', () => {
        const state: SocialGraphState = {
            edges: {
                'a|b': { kind: 'friend', strength: 50, formedAtTick: 100, lastInteractionTick: 400, provenance: null },
                'a|c': { kind: 'acquaintance', strength: 20, formedAtTick: 300, lastInteractionTick: 300, provenance: null },
                'a|d': { kind: 'friend', strength: 40, formedAtTick: 100, lastInteractionTick: 150, provenance: null },
            },
        };
        const windowed = windowSocialGraph(state, 200, new Set(['a', 'b', 'c']));
        expect(Object.keys(windowed.edges)).toEqual(['a|b']); // a|c formed after w; a|d's endpoint dropped
        expect(windowed.edges['a|b']).toEqual({
            kind: 'friend', strength: 50, formedAtTick: -100,
            lastInteractionTick: 0, // clamped to w (the future interaction hasn't happened), then rebased
            provenance: null,
        });
    });
});
