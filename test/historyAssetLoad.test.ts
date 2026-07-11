// Runtime asset loading (task 077 Part B). `loadSelectedWorldFromHttp` fetches asset.json → the pointed
// asset's meta.json → and only the shards the window needs, then selects a starting world. Here we generate a
// small sharded asset, serve it through a fake `fetchText` over an in-memory URL→payload map, and assert the
// HTTP-loaded world is identical to selecting from the equivalent in-memory asset — plus the fallbacks.

import { generateHistoryAsset, DEFAULT_GENERATOR_PARAMS, HistoryGeneratorParams, HistoryAssetSink, ShardRef, HistoryAsset } from '../src/app/game/HistoryAsset';
import { selectStartingWorld, AssetHeader } from '../src/app/game/HistoryAssetSelection';
import { loadSelectedWorldFromHttp } from '../src/app/game/HistoryAssetSource';
import { compress } from '../src/util/compress';
import { EventLogTable } from '../src/types/LifeEvent';
import { SkillTimeline } from '../src/types/Skill';

const PARAMS: HistoryGeneratorParams = {
    ...DEFAULT_GENERATOR_PARAMS,
    seed: 31, founderCount: 40, recordThreshold: 30, recordYears: 10, daysPerStep: 30,
    skillSnapshotYears: 1, flushIntervalYears: 3, keepActionLog: false,
    populationControl: { enabled: true, target: 55, band: 0.05, suppressLevel: 0.1, allowLevel: 1 },
    logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
};

const BASE = 'history';
const DIR = 'history-20260101000000-abcd';

// Builds an in-memory "server": a URL→payload map mirroring what the CLI writes to disk (asset.json, the
// asset's meta.json header, the section files, and the shards). Returns the store + the equivalent in-memory
// asset (for the equality assertion) + a matching fetchText.
async function buildServer(): Promise<{ store: Map<string, string>; inMem: HistoryAsset; fetchText: (url: string) => Promise<string | null> }> {
    // In-memory asset (the selection oracle) — generated the plain way.
    const inMem = await generateHistoryAsset(PARAMS);

    // Streamed generation into a store keyed by shard file name.
    const shardStore = new Map<string, string>();
    let li = 0;
    let si = 0;
    const sink: HistoryAssetSink = {
        logShard(table: EventLogTable): ShardRef {
            const file = `log-${li++}.tbz`;
            shardStore.set(file, compress(JSON.stringify(table)));
            let min = 0; let max = 0; let seen = false;
            for (const entries of Object.values(table)) {
                for (const e of entries) { if (!seen) { min = max = e.tick; seen = true; } else { min = Math.min(min, e.tick); max = Math.max(max, e.tick); } }
            }
            return { file, minTick: min, maxTick: max };
        },
        skillShard(timeline: SkillTimeline): ShardRef {
            const file = `skills-${si++}.tbz`;
            shardStore.set(file, compress(JSON.stringify(timeline)));
            let min = 0; let max = 0; let seen = false;
            for (const snaps of Object.values(timeline)) {
                for (const s of snaps) { if (!seen) { min = max = s.tick; seen = true; } else { min = Math.min(min, s.tick); max = Math.max(max, s.tick); } }
            }
            return { file, minTick: min, maxTick: max };
        },
    };
    const streamed = await generateHistoryAsset(PARAMS, undefined, null, sink);

    const header: AssetHeader = {
        meta: streamed.meta,
        eventLogSeq: streamed.eventLogSeq,
        sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz' },
        logShards: streamed.logShards!,
        skillShards: streamed.skillShards!,
    };

    // Assemble the served URL map.
    const store = new Map<string, string>();
    // The pointer uses the "./<dir>/" form the generator writes, so the loader's dir normalization is exercised.
    store.set(`${BASE}/asset.json`, JSON.stringify({ dir: `./${DIR}/` }));
    store.set(`${BASE}/${DIR}/meta.json`, JSON.stringify(header));
    store.set(`${BASE}/${DIR}/population.tbz`, compress(JSON.stringify(streamed.population)));
    store.set(`${BASE}/${DIR}/objects.tbz`, compress(JSON.stringify(streamed.objects)));
    store.set(`${BASE}/${DIR}/eventHistory.tbz`, compress(JSON.stringify(streamed.eventHistory)));
    for (const [file, payload] of shardStore) {
        store.set(`${BASE}/${DIR}/${file}`, payload);
    }

    const fetchText = async (url: string): Promise<string | null> => (store.has(url) ? store.get(url)! : null);
    return { store, inMem, fetchText };
}

describe('loadSelectedWorldFromHttp', () => {
    jest.setTimeout(180000);

    test('HTTP-loaded world equals in-memory selection (fetches asset.json → meta → shards)', async () => {
        const { inMem, fetchText } = await buildServer();
        for (const seed of [1, 99, 40404]) {
            const overHttp = await loadSelectedWorldFromHttp(seed, BASE, fetchText);
            const inMemory = selectStartingWorld(inMem, seed)!;
            expect(overHttp).not.toBeNull();
            expect(overHttp!.window).toBe(inMemory.window);
            expect(overHttp!.population.people).toEqual(inMemory.population.people);
            expect(overHttp!.skillBook).toEqual(inMemory.skillBook);
            expect(overHttp!.objects).toEqual(inMemory.objects);
            expect(overHttp!.eventLog).toEqual(inMemory.eventLog);
        }
    });

    test('only fetches shards up to the chosen window (chunked load)', async () => {
        const { fetchText } = await buildServer();
        const requested: string[] = [];
        const trackingFetch = async (url: string) => { requested.push(url); return fetchText(url); };
        const selected = await loadSelectedWorldFromHttp(7, BASE, trackingFetch)!;
        // meta.json is needed to KNOW the shard ranges; but no shard beyond the window should be fetched.
        const headerRaw = await fetchText(`${BASE}/${DIR}/meta.json`);
        const header = JSON.parse(headerRaw!) as AssetHeader;
        for (const shard of [...header.logShards, ...header.skillShards]) {
            if (shard.minTick > selected!.window) {
                expect(requested).not.toContain(`${BASE}/${DIR}/${shard.file}`);
            }
        }
    });

    test('returns null (→ cold-start) when no asset is present', async () => {
        const empty = async () => null;
        expect(await loadSelectedWorldFromHttp(1, BASE, empty)).toBeNull();
    });

    test('returns null on an incompatible format version', async () => {
        const { store, fetchText } = await buildServer();
        const header = JSON.parse(store.get(`${BASE}/${DIR}/meta.json`)!) as AssetHeader;
        header.meta.formatVersion = 999;
        store.set(`${BASE}/${DIR}/meta.json`, JSON.stringify(header));
        expect(await loadSelectedWorldFromHttp(1, BASE, fetchText)).toBeNull();
    });
});
