// Runtime asset loading (task 077 Part B; person-keyed lazy layout since the task-012 follow-up).
// `loadSelectedWorldFromHttp` fetches asset.json → the pointed asset's meta.json → ONLY the small
// population/objects sections, and returns a hydration source that fetches each person's history file on
// demand. Here we generate a small person-keyed asset, serve it through a fake `fetchText` over an in-memory
// URL→payload map, and assert the lazy pipeline (boot + per-person hydration) reproduces exactly what the
// eager in-memory selection produces — the equivalence keystone of the lazy architecture — plus the fallbacks.

import { generateHistoryAsset, DEFAULT_GENERATOR_PARAMS, HistoryGeneratorParams, HistoryAssetSink, HistoryAsset } from 'game/history/HistoryAsset';
import { selectStartingWorld, AssetHeader, PersonChunk } from 'game/history/HistoryAssetSelection';
import { loadSelectedWorldFromHttp, reopenHydrationSource } from 'game/history/HistoryAssetSource';
import { PersonId } from 'types/Genealogy';
import { EventLogTable } from 'types/LifeEvent';
import { SkillTimeline } from 'types/Skill';
import { compress } from 'util/compress';

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
// asset's meta.json header, the section files, and one person-<id>.tbz per retained person). Returns the
// store + the equivalent in-memory asset (the selection oracle) + a matching fetchText.
async function buildServer(): Promise<{ store: Map<string, string>; inMem: HistoryAsset; header: AssetHeader; fetchText: (url: string) => Promise<string | null> }> {
    // In-memory asset (the selection oracle) — generated the plain way.
    const inMem = await generateHistoryAsset(PARAMS);

    // Streamed generation with the person-chunk sink (mirrors the CLI: append one compressed chunk line per
    // person per flush).
    const personFiles = new Map<PersonId, string>();
    const fileBodies = new Map<string, string>();
    const appendChunk = (personId: PersonId, chunk: PersonChunk): void => {
        let file = personFiles.get(personId);
        if (!file) {
            file = `person-${personId}.tbz`;
            personFiles.set(personId, file);
        }
        fileBodies.set(file, (fileBodies.get(file) ?? '') + compress(JSON.stringify(chunk)) + '\n');
    };
    const sink: HistoryAssetSink = {
        logChunk(table: EventLogTable): void {
            for (const [id, entries] of Object.entries(table)) {
                appendChunk(id, { log: entries });
            }
        },
        skillChunk(timeline: SkillTimeline): void {
            for (const [id, snapshots] of Object.entries(timeline)) {
                appendChunk(id, { skills: snapshots });
            }
        },
    };
    const streamed = await generateHistoryAsset(PARAMS, undefined, null, sink);

    // Prune warm-up-only people (mirrors the CLI) so the header's people map is exactly the retained pool.
    const retained = new Set(Object.keys(streamed.population.people));
    for (const [id, file] of [...personFiles]) {
        if (!retained.has(id)) {
            personFiles.delete(id);
            fileBodies.delete(file);
        }
    }

    const header: AssetHeader = {
        meta: streamed.meta,
        eventLogSeq: streamed.eventLogSeq,
        sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz' },
        people: Object.fromEntries(personFiles),
    };

    // Assemble the served URL map.
    const store = new Map<string, string>();
    // The pointer uses the "./<dir>/" form the generator writes, so the loader's dir normalization is exercised.
    store.set(`${BASE}/asset.json`, JSON.stringify({ dir: `./${DIR}/` }));
    store.set(`${BASE}/${DIR}/meta.json`, JSON.stringify(header));
    store.set(`${BASE}/${DIR}/population.tbz`, compress(JSON.stringify(streamed.population)));
    store.set(`${BASE}/${DIR}/objects.tbz`, compress(JSON.stringify(streamed.objects)));
    store.set(`${BASE}/${DIR}/eventHistory.tbz`, compress(JSON.stringify(streamed.eventHistory)));
    for (const [file, body] of fileBodies) {
        store.set(`${BASE}/${DIR}/${file}`, body);
    }

    const fetchText = async (url: string): Promise<string | null> => (store.has(url) ? store.get(url)! : null);
    return { store, inMem, header, fetchText };
}

describe('loadSelectedWorldFromHttp (person-keyed lazy layout)', () => {
    jest.setTimeout(180000);

    test('boot equals eager selection, and per-person hydration reproduces the eager logs/skills/aggregates', async () => {
        const { inMem, fetchText } = await buildServer();
        for (const seed of [1, 99, 40404]) {
            const loaded = await loadSelectedWorldFromHttp(seed, BASE, fetchText);
            const eager = selectStartingWorld(inMem, seed)!;
            expect(loaded).not.toBeNull();
            const { selected, hydration } = loaded!;

            // Boot: same window, identical re-identified population and possessions; NO logs/skills yet.
            expect(selected.window).toBe(eager.window);
            expect(selected.population.people).toEqual(eager.population.people);
            expect(selected.objects).toEqual(eager.objects);
            expect(selected.eventLog).toEqual({});
            expect(selected.skillBook).toBeUndefined();

            // Hydration: for every person the eager path kept a log for, the lazy fetch reproduces exactly
            // the same windowed entries, derived aggregate, and skills-as-of-window.
            const withLogs = Object.keys(eager.eventLog).slice(0, 12);
            expect(withLogs.length).toBeGreaterThan(0);
            const bundles = await hydration.fetchPeople(withLogs);
            expect(bundles.map(bundle => bundle.personId)).toEqual(withLogs.filter(id => hydration.has(id)));
            for (const bundle of bundles) {
                expect(bundle.log).toEqual(eager.eventLog[bundle.personId]);
                expect(bundle.history).toEqual(eager.eventHistory[bundle.personId] ?? {});
                expect(bundle.skills ?? undefined).toEqual(eager.skillBook?.records[bundle.personId]);
            }
        }
    });

    test('boot fetches ONLY the pointer, header and small sections — never a person file', async () => {
        const { fetchText } = await buildServer();
        const requested: string[] = [];
        const trackingFetch = async (url: string) => { requested.push(url); return fetchText(url); };
        const loaded = await loadSelectedWorldFromHttp(7, BASE, trackingFetch);
        expect(loaded).not.toBeNull();
        expect(requested.sort()).toEqual([
            `${BASE}/${DIR}/meta.json`,
            `${BASE}/${DIR}/objects.tbz`,
            `${BASE}/${DIR}/population.tbz`,
            `${BASE}/asset.json`,
        ].sort());
    });

    test('hydration skips people the asset does not know (newborns/immigrants) without a round-trip', async () => {
        const { fetchText } = await buildServer();
        const loaded = (await loadSelectedWorldFromHttp(7, BASE, fetchText))!;
        const requested: string[] = [];
        const trackingSource = await reopenHydrationSource(loaded.hydration.ref, BASE,
            async url => { requested.push(url); return fetchText(url); });
        expect(trackingSource!.has('p999999')).toBe(false);
        expect(await trackingSource!.fetchPeople(['p999999'])).toEqual([]);
        expect(requested.filter(url => url.includes('person-'))).toEqual([]);
    });

    test('reopenHydrationSource restores a working source from a saved ref, and rejects a regenerated asset', async () => {
        const { store, fetchText } = await buildServer();
        const loaded = (await loadSelectedWorldFromHttp(5, BASE, fetchText))!;
        const someone = Object.keys(JSON.parse(store.get(`${BASE}/${DIR}/meta.json`)!).people)[0] as string;

        const reopened = await reopenHydrationSource(loaded.hydration.ref, BASE, fetchText);
        expect(reopened).not.toBeNull();
        const viaReopened = await reopened!.fetchPeople([someone]);
        const viaOriginal = await loaded.hydration.fetchPeople([someone]);
        expect(viaReopened).toEqual(viaOriginal);

        // A regenerated asset (different createdAt) is a DIFFERENT world — the reopen must refuse it.
        const mismatched = await reopenHydrationSource({ ...loaded.hydration.ref, createdAt: '1999-01-01T00:00:00.000Z' }, BASE, fetchText);
        expect(mismatched).toBeNull();
    });

    test('returns null (→ cold-start) when no asset is present', async () => {
        const empty = async () => null;
        expect(await loadSelectedWorldFromHttp(1, BASE, empty)).toBeNull();
    });

    test('returns null on an incompatible format version (e.g. a v1 time-sharded asset)', async () => {
        const { store, fetchText } = await buildServer();
        const header = JSON.parse(store.get(`${BASE}/${DIR}/meta.json`)!) as AssetHeader;
        header.meta.formatVersion = 1;
        store.set(`${BASE}/${DIR}/meta.json`, JSON.stringify(header));
        expect(await loadSelectedWorldFromHttp(1, BASE, fetchText)).toBeNull();
    });

    test('returns null when the pointer JSON has no "dir" field', async () => {
        const { fetchText: realFetch } = await buildServer();
        const fetchText = async (url: string): Promise<string | null> =>
            (url === `${BASE}/asset.json` ? JSON.stringify({}) : realFetch(url));
        expect(await loadSelectedWorldFromHttp(1, BASE, fetchText)).toBeNull();
    });

    test('returns null when the pointed dir has no meta.json', async () => {
        const { fetchText: realFetch } = await buildServer();
        const fetchText = async (url: string): Promise<string | null> =>
            (url === `${BASE}/${DIR}/meta.json` ? null : realFetch(url));
        expect(await loadSelectedWorldFromHttp(1, BASE, fetchText)).toBeNull();
    });

    test('returns null when a needed section file 404s', async () => {
        const { fetchText: realFetch } = await buildServer();
        const fetchText = async (url: string): Promise<string | null> =>
            (url === `${BASE}/${DIR}/population.tbz` ? null : realFetch(url));
        expect(await loadSelectedWorldFromHttp(1, BASE, fetchText)).toBeNull();
    });

    test('a missing person file degrades that person only (no throw, others hydrate)', async () => {
        const { store, header, fetchText: realFetch } = await buildServer();
        const ids = Object.keys(header.people).slice(0, 2);
        expect(ids).toHaveLength(2);
        const missing = `${BASE}/${DIR}/${header.people[ids[0]!]!}`;
        expect(store.has(missing)).toBe(true);
        const fetchText = async (url: string): Promise<string | null> => (url === missing ? null : realFetch(url));

        const loaded = (await loadSelectedWorldFromHttp(2, BASE, fetchText))!;
        const bundles = await loaded.hydration.fetchPeople(ids);
        expect(bundles.map(bundle => bundle.personId)).toEqual([ids[1]]);
    });

    test('returns null (never throws) when fetchText itself throws', async () => {
        const throwing = async (): Promise<string | null> => { throw new Error('network is down'); };
        expect(await loadSelectedWorldFromHttp(1, BASE, throwing)).toBeNull();
    });

    test('the default fetchText (real fetch) is used when none is injected', async () => {
        const { store } = await buildServer();
        const originalFetch = (globalThis as { fetch?: unknown }).fetch;
        const calls: string[] = [];
        (globalThis as unknown as { fetch: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }> }).fetch =
            async (url: string) => {
                calls.push(url);
                if (store.has(url)) {
                    return { ok: true, text: async () => store.get(url)! };
                }
                return { ok: false, text: async () => '' };
            };
        try {
            const loaded = await loadSelectedWorldFromHttp(3, BASE); // no fetchText override ⇒ real httpFetchText
            expect(loaded).not.toBeNull();
            expect(calls).toContain(`${BASE}/asset.json`);
        } finally {
            (globalThis as { fetch?: unknown }).fetch = originalFetch;
        }
    });

    test('the default fetchText resolves to null (not a throw) on a network-level rejection', async () => {
        const originalFetch = (globalThis as { fetch?: unknown }).fetch;
        (globalThis as unknown as { fetch: () => Promise<never> }).fetch = async () => { throw new Error('offline'); };
        try {
            expect(await loadSelectedWorldFromHttp(1, BASE)).toBeNull();
        } finally {
            (globalThis as { fetch?: unknown }).fetch = originalFetch;
        }
    });
});
