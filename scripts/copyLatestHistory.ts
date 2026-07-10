// Copies the NEWEST generated history asset into the served build output so the game can fetch it at runtime
// (task 077 loading). Reads src/assets/history/latest.json (written by generate-history), copies the pointed-at
// asset directory + the pointer into `<target>/history/`, where `<target>` is the served root (./dist for dev,
// ./bin for prod, default ./dist). A stale copy of that asset is cleared first so old shards never linger.
//
// If there is no latest.json (no asset generated yet), it is a no-op — the game cold-starts. Wired into
// `npm run dev` (copies to ./dist) and `npm run build-prod`'s package flow (copies to ./bin).

import { existsSync, mkdirSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

function main(): void {
    const historySrc = resolve(process.cwd(), 'src/assets/history');
    const target = resolve(process.cwd(), process.argv[2] ?? 'dist');
    const destHistory = join(target, 'history');

    const latestPath = join(historySrc, 'latest.json');
    if (!existsSync(latestPath)) {
        console.log('[copy-history] no src/assets/history/latest.json — nothing to copy (the game will cold-start).');
        return;
    }

    let dir: string | undefined;
    try {
        dir = (JSON.parse(readFileSync(latestPath, 'utf8')) as { dir?: string }).dir;
    } catch {
        console.warn('[copy-history] latest.json is unreadable — skipping.');
        return;
    }
    if (!dir) {
        console.warn('[copy-history] latest.json has no `dir` — skipping.');
        return;
    }

    const srcAsset = join(historySrc, dir);
    if (!existsSync(srcAsset)) {
        console.error(`[copy-history] latest asset directory is missing: ${srcAsset}`);
        process.exit(1);
    }

    mkdirSync(destHistory, { recursive: true });
    const destAsset = join(destHistory, dir);
    if (existsSync(destAsset)) {
        rmSync(destAsset, { recursive: true, force: true }); // refresh: no stale shards from a prior copy
    }
    cpSync(srcAsset, destAsset, { recursive: true });
    cpSync(latestPath, join(destHistory, 'latest.json'));
    console.log(`[copy-history] copied ${dir} → ${destHistory}`);
}

main();
