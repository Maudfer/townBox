// The committed history asset source (task 055/077 Part B; person-keyed lazy layout since the task-012
// follow-up). A fresh game selects a starting world from a committed asset; when none is present it
// cold-starts (a plain generated pool — the §3.7 fallback).
//
// TWO source paths:
//   - PERSON-KEYED over HTTP (the generator's default output — the primary path). The generator writes the
//     asset (a meta.json header + compressed section files + one `person-<id>.tbz` per retained person) under
//     src/history/ (the committed default) or src/history/dev/<name>/ (a --dev build), plus an `asset.json`
//     pointer naming the dir. `copy-history` mirrors the pointed asset into `<served>/history/`.
//     `loadSelectedWorldFromHttp` fetches `asset.json` → `meta.json` → ONLY the small population + objects
//     sections (a couple of MB), and returns a HYDRATION SOURCE alongside the selected world: each drawn
//     person's log/skills are fetched on demand at materialization (GameManager.hydratePeople), so neither
//     boot time nor memory scale with the asset's total size.
//   - SINGLE-FILE constant (small assets / fixtures): set COMMITTED_HISTORY_ASSET to a compressed HistoryAsset
//     payload; `loadCommittedAsset` decodes it and the caller runs selectStartingWorld (eager — everything
//     installed up-front, no hydration source needed).

import { HistoryAsset } from 'game/history/HistoryAsset';
import {
    AssetHeader,
    HydratedPerson,
    SelectedWorld,
    decodePersonFile,
    selectStartingWorldFromSections,
    validateAsset,
} from 'game/history/HistoryAssetSelection';
import { PersonId } from 'types/Genealogy';
import { decompress } from 'util/compress';

// The base URL the asset is served from (relative to the app root). Overridable for tests.
export const HISTORY_ASSET_BASE_URL = 'history';

// null until a small asset is committed inline. When set, it is a compressed HistoryAsset payload string.
export const COMMITTED_HISTORY_ASSET: string | null = null;

// Decompresses + parses + validates an asset payload. Returns null on any failure (corrupt payload,
// incompatible formatVersion), so callers cold-start rather than crash.
export function decodeAsset(payload: string): HistoryAsset | null {
    try {
        const asset = JSON.parse(decompress(payload)) as HistoryAsset;
        return validateAsset(asset).ok ? asset : null;
    } catch {
        return null;
    }
}

export function loadCommittedAsset(): HistoryAsset | null {
    if (!COMMITTED_HISTORY_ASSET) {
        return null;
    }
    return decodeAsset(COMMITTED_HISTORY_ASSET);
}

// Fetches a URL's text body, or null on any failure (404, network, offline). Injected in tests.
export type FetchText = (url: string) => Promise<string | null>;

const httpFetchText: FetchText = async (url: string): Promise<string | null> => {
    try {
        const response = await fetch(url);
        return response.ok ? await response.text() : null;
    } catch {
        return null;
    }
};

// What a save pins so a LOADED game can keep hydrating people it places later: which asset dir, which window,
// and the asset's identity fingerprint (createdAt) — a regenerated asset is a different world, so a mismatch
// disables further hydration rather than mixing histories.
export interface HistoryHydrationRef {
    dir: string;
    window: number;
    createdAt: string;
}

// The lazy per-person history reader (task 012 follow-up). `has` answers from the header's people map without
// any round-trip; `fetchPeople` pulls + windows only the requested people's files.
export interface HistoryHydrationSource {
    ref: HistoryHydrationRef;
    has(personId: PersonId): boolean;
    fetchPeople(personIds: PersonId[]): Promise<HydratedPerson[]>;
}

export interface LoadedWorld {
    selected: SelectedWorld;
    hydration: HistoryHydrationSource;
}

// Resolves the asset dir against the base URL: "./" → the history root; "./dev/x/" → history/dev/x.
function resolveAssetBase(baseUrl: string, dir: string): string {
    const cleanDir = dir.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return cleanDir ? `${baseUrl}/${cleanDir}` : baseUrl;
}

function createHydrationSource(
    ref: HistoryHydrationRef,
    assetBase: string,
    header: AssetHeader,
    fetchText: FetchText,
): HistoryHydrationSource {
    return {
        ref,
        has: personId => personId in header.people,
        async fetchPeople(personIds: PersonId[]): Promise<HydratedPerson[]> {
            const results: HydratedPerson[] = [];
            for (const personId of personIds) {
                const file = header.people[personId];
                if (!file) {
                    continue;
                }
                const payload = await fetchText(`${assetBase}/${file}`);
                if (payload === null) {
                    continue; // degrade per person (no pre-game history) rather than fail materialization
                }
                results.push(decodePersonFile(personId, payload, ref.window));
            }
            return results;
        },
    };
}

// Loads the committed person-keyed asset over HTTP and selects a starting world from it. Fetches asset.json →
// the pointed-at asset's meta.json header → ONLY the small population + objects sections. Returns the selected
// world plus the hydration source for on-demand per-person history. Null (→ the caller cold-starts) if there
// is no asset, it is incompatible, or a required section fails to load — never a half-built world.
export async function loadSelectedWorldFromHttp(
    gameSeed: number,
    baseUrl: string = HISTORY_ASSET_BASE_URL,
    fetchText: FetchText = httpFetchText,
): Promise<LoadedWorld | null> {
    try {
        const pointerRaw = await fetchText(`${baseUrl}/asset.json`);
        if (!pointerRaw) {
            return null;
        }
        const dir = (JSON.parse(pointerRaw) as { dir?: string }).dir;
        if (!dir) {
            return null;
        }

        const assetBase = resolveAssetBase(baseUrl, dir);
        const metaRaw = await fetchText(`${assetBase}/meta.json`);
        if (!metaRaw) {
            return null;
        }
        const header = JSON.parse(metaRaw) as AssetHeader;
        if (!validateAsset({ meta: header.meta }).ok || !header.people) {
            return null;
        }

        // Only the files boot-time selection reads. Person files are NOT fetched here — that is the point.
        const needed = [header.sections.population, header.sections.objects];
        const store = new Map<string, string>();
        const fetched = await Promise.all(needed.map(async file => [file, await fetchText(`${assetBase}/${file}`)] as const));
        for (const [file, payload] of fetched) {
            if (payload === null) {
                return null; // a required section is missing — cold-start rather than a corrupt world
            }
            store.set(file, payload);
        }
        const selected = selectStartingWorldFromSections(header, file => store.get(file) ?? '', gameSeed);
        if (!selected) {
            return null;
        }
        const ref: HistoryHydrationRef = { dir, window: selected.window, createdAt: header.meta.createdAt };
        return { selected, hydration: createHydrationSource(ref, assetBase, header, fetchText) };
    } catch {
        return null;
    }
}

// Re-opens the hydration source for a LOADED game from the ref its save pinned. Null when the asset is gone or
// is a different generation (createdAt mismatch) — the caller degrades gracefully (people placed after the
// load simply arrive without pre-game histories; the sim itself never needed them).
export async function reopenHydrationSource(
    ref: HistoryHydrationRef,
    baseUrl: string = HISTORY_ASSET_BASE_URL,
    fetchText: FetchText = httpFetchText,
): Promise<HistoryHydrationSource | null> {
    try {
        const assetBase = resolveAssetBase(baseUrl, ref.dir);
        const metaRaw = await fetchText(`${assetBase}/meta.json`);
        if (!metaRaw) {
            return null;
        }
        const header = JSON.parse(metaRaw) as AssetHeader;
        if (!validateAsset({ meta: header.meta }).ok || !header.people || header.meta.createdAt !== ref.createdAt) {
            return null;
        }
        return createHydrationSource(ref, assetBase, header, fetchText);
    } catch {
        return null;
    }
}
