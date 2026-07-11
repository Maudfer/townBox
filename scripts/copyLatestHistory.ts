// Copies the committed history asset into the served build output so the game can fetch it at runtime (task
// 077 loading). Reads the asset pointer under src/history/ — `asset.local.json` (a gitignored --dev override)
// when present, else the committed `asset.json` — resolves its `dir`, and mirrors the pointed asset into
// `<target>/history/` (preserving the dir path), alongside a fresh `<target>/history/asset.json` carrying the
// effective dir. `<target>` is the served root (./dist for dev, ./bin for prod; default ./dist).
//
// If there is no pointer (no asset generated yet), it is a no-op — the game cold-starts. Wired into
// `npm run dev` (→ ./dist) and `npm run build-prod`'s package flow (→ ./bin).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

// "./" → "" (the history root); "./dev/history-x/" → "dev/history-x". Leading "./" and trailing "/" stripped.
function normalizeDir(dir: string): string {
    return dir.replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

function main(): void {
    const historySrc = resolve(process.cwd(), 'src/history');
    const target = resolve(process.cwd(), process.argv[2] ?? 'dist');
    const destHistory = join(target, 'history');

    // Prefer the gitignored dev override, then the committed default pointer.
    const pointerPath = existsSync(join(historySrc, 'asset.local.json'))
        ? join(historySrc, 'asset.local.json')
        : join(historySrc, 'asset.json');
    if (!existsSync(pointerPath)) {
        console.log('[copy-history] no src/history/asset.json — nothing to copy (the game will cold-start).');
        return;
    }

    let dir: string | undefined;
    try {
        dir = (JSON.parse(readFileSync(pointerPath, 'utf8')) as { dir?: string }).dir;
    } catch {
        console.warn('[copy-history] asset pointer is unreadable — skipping.');
        return;
    }
    if (!dir) {
        console.warn('[copy-history] asset pointer has no `dir` — skipping.');
        return;
    }

    const clean = normalizeDir(dir);
    const srcAsset = clean ? join(historySrc, clean) : historySrc;
    if (!existsSync(srcAsset)) {
        console.error(`[copy-history] pointed asset is missing: ${srcAsset}`);
        process.exit(1);
    }

    // Refresh the whole served history dir so no stale shards (or a prior dev asset) linger.
    rmSync(destHistory, { recursive: true, force: true });
    const destAsset = clean ? join(destHistory, clean) : destHistory;
    mkdirSync(destAsset, { recursive: true });

    if (clean) {
        // A dev asset lives in its own subfolder — copy it wholesale.
        cpSync(srcAsset, destAsset, { recursive: true });
    } else {
        // The default asset shares the history root with dev/ and the pointer files — copy only the top-level
        // asset FILES (meta.json / manifest.json / shards), never the dev/ subtree or the pointer files.
        for (const entry of readdirSync(srcAsset, { withFileTypes: true })) {
            if (entry.isFile() && entry.name !== 'asset.json' && entry.name !== 'asset.local.json') {
                cpSync(join(srcAsset, entry.name), join(destAsset, entry.name));
            }
        }
    }

    // A single served pointer carrying the effective dir (the runtime reads this, not the override).
    writeFileSync(join(destHistory, 'asset.json'), JSON.stringify({ dir }, null, 2), 'utf8');
    console.log(`[copy-history] copied ${clean || '(root)'} → ${destHistory} (asset.json dir "${dir}")`);
}

main();
