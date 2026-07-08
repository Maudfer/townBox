// The committed default history asset + its decoder (task 055 Part B, §7-B). A fresh clone should run out of
// the box, so the game looks here for a committed asset to select a starting world from; when none is present
// it cold-starts (a plain generated pool with empty histories — the §3.7 fallback).
//
// Since task 077 the generator writes a SHARDED asset (a directory: meta.json header + compressed section/shard
// files) so a large asset streams to disk and loads in chunks. Two committed-asset paths therefore exist:
//   - SINGLE-FILE (small assets / fixtures): set COMMITTED_HISTORY_ASSET to a compressed HistoryAsset payload;
//     the game calls selectStartingWorld on the decoded asset.
//   - SHARDED (the default generator output): commit the directory under src/assets/history/<name>/ and wire a
//     reader that fetches shard files by name, then call selectStartingWorldFromShards(header, read, seed)
//     (game/HistoryAssetSelection) — it fetches only the shards up to the selected window, so browser memory
//     stays bounded. (The browser fetch/bundle wiring for a committed sharded directory is a thin follow-up;
//     the selection core + Node round-trip are covered by test/logicalWorld.test.ts.)
//
// COMMITTED_HISTORY_ASSET is a module constant (not a runtime read) so Parcel resolves it into the bundle and
// Jest can exercise the decode path.

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
