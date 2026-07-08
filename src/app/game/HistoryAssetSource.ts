// The committed default history asset + its decoder (task 055 Part B, §7-B). A fresh clone should run out of
// the box, so the game looks here for a committed asset to select a starting world from; when none is present
// it cold-starts (a plain generated pool with empty histories — the §3.7 fallback).
//
// Committing an asset: run `npm run generate-history` (see scripts/generateHistoryAsset.ts), then set
// COMMITTED_HISTORY_ASSET to the produced .tbz file's contents (the compressed, base64 payload string) — or
// re-export it from a data module. It is kept as a module constant (rather than a runtime file read/fetch) so
// Parcel always resolves it into the bundle and Jest can exercise the decode path.

import { decompress } from 'util/compress';

import { HistoryAsset } from 'game/HistoryAsset';
import { validateAsset } from 'game/HistoryAssetSelection';

// null until a generated asset is committed. When set, it is the compressed payload string
// (util/compress.compress output) of a HistoryAsset.
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
