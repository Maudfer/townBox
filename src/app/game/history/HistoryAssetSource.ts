// The committed history asset source (task 055/077 Part B). A fresh game selects a starting world from a
// committed asset; when none is present it cold-starts (a plain generated pool — the §3.7 fallback).
//
// TWO source paths:
//   - SHARDED over HTTP (the generator's default output — the primary path). The generator writes the asset
//     (a meta.json header + compressed section/shard files) under src/history/ (the committed default) or
//     src/history/dev/<name>/ (a --dev build), plus an `asset.json` pointer naming the dir. `copy-history`
//     mirrors the pointed asset into `<served>/history/` and writes one `<served>/history/asset.json` with the
//     effective dir. `loadSelectedWorldFromHttp` fetches `<served>/history/asset.json` → `<dir>/meta.json` →
//     and ONLY the section + shard files the chosen window needs (chunked load, so browser memory stays
//     bounded), then runs `selectStartingWorldFromShards`. Both `npm run dev` (./dist) and `npm run build-prod`
//     (./bin) load from the same `/history` path.
//   - SINGLE-FILE constant (small assets / fixtures): set COMMITTED_HISTORY_ASSET to a compressed HistoryAsset
//     payload; `loadCommittedAsset` decodes it and the caller runs selectStartingWorld. Kept as a bundle-time
//     fallback for a tiny committed asset.

import { HistoryAsset } from 'game/history/HistoryAsset';
import { AssetHeader, SelectedWorld, pickWindow, selectStartingWorldFromShards, validateAsset } from 'game/history/HistoryAssetSelection';
import { decompress } from 'util/compress';

// The base URL the sharded asset is served from (relative to the app root). Overridable for tests.
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

// Loads the committed SHARDED asset over HTTP and selects a starting world from it. Fetches asset.json → the
// pointed-at asset's meta.json header → and only the section + shard files the chosen window `w` needs
// (chunked, memory-bounded). Returns null (→ the caller cold-starts) if there is no asset, it is incompatible,
// or any required file fails to load — never a half-built world.
export async function loadSelectedWorldFromHttp(
    gameSeed: number,
    baseUrl: string = HISTORY_ASSET_BASE_URL,
    fetchText: FetchText = httpFetchText,
): Promise<SelectedWorld | null> {
    try {
        const pointerRaw = await fetchText(`${baseUrl}/asset.json`);
        if (!pointerRaw) {
            return null;
        }
        const dir = (JSON.parse(pointerRaw) as { dir?: string }).dir;
        if (!dir) {
            return null;
        }

        // Resolve the dir against the base URL: "./" → the history root; "./dev/history-x/" → history/dev/history-x.
        const cleanDir = dir.replace(/^\.?\/+/, '').replace(/\/+$/, '');
        const assetBase = cleanDir ? `${baseUrl}/${cleanDir}` : baseUrl;
        const metaRaw = await fetchText(`${assetBase}/meta.json`);
        if (!metaRaw) {
            return null;
        }
        const header = JSON.parse(metaRaw) as AssetHeader;
        if (!validateAsset({ meta: header.meta }).ok) {
            return null;
        }

        // Only the files selection reads: the population + objects sections, and the log/skill shards whose
        // range starts at/before the window. Future shards (minTick > w) are never fetched.
        const w = pickWindow(header.meta, gameSeed);
        const needed = [
            header.sections.population,
            header.sections.objects,
            ...header.logShards.filter(shard => shard.minTick <= w).map(shard => shard.file),
            ...header.skillShards.filter(shard => shard.minTick <= w).map(shard => shard.file),
        ];
        const store = new Map<string, string>();
        const fetched = await Promise.all(needed.map(async file => [file, await fetchText(`${assetBase}/${file}`)] as const));
        for (const [file, payload] of fetched) {
            if (payload === null) {
                return null; // a required file is missing — cold-start rather than a corrupt world
            }
            store.set(file, payload);
        }
        return selectStartingWorldFromShards(header, file => store.get(file) ?? '', gameSeed);
    } catch {
        return null;
    }
}
