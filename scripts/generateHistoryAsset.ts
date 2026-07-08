// The offline history-asset generator CLI (task 055 §2.6). Run with `npm run generate-history` (tsx resolves
// the game/* tsconfig path aliases). It reuses the pure generator core (game/HistoryAsset.generateHistoryAsset)
// — NOT the retired browser worker — runs the full-fidelity phased simulation, prints the measurements the
// maintainer needs (final living population, retained people, births/deaths, raw vs compressed size, runtime,
// and the per-decade population trajectory), and writes the compressed, versioned asset under
// src/assets/history/.
//
// The DEFAULT config (json/historyGenerator.json) is the RICHEST, most expensive simulation: daily stepping
// (daysPerStep 1), the full action log kept, yearly skill snapshots, and the logical-economy world fully on.
// A centuries-long default run is very long AND produces a very large asset — that is intended. Use the flags
// below to dial it back for calibration / a feasible run.
//
// CLI flags override json/historyGenerator.json:
//   --seed N  --years N  --threshold N  --founders N  --capacity N  --steepness N  --step-days N
//   --snapshot-years N  --no-action-log  --no-capacity  --max-hours N  --max-people N  --out PATH

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import process from 'node:process';

import { compress } from 'util/compress';
import {
    generateHistoryAsset,
    DEFAULT_GENERATOR_PARAMS,
    HISTORY_GENERATOR_VERSION,
    HistoryGeneratorParams,
    GenerationProgress,
} from 'game/HistoryAsset';

function parseFlags(argv: string[]): Record<string, string | boolean> {
    const flags: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (!token.startsWith('--')) {
            continue;
        }
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            flags[key] = true;
        } else {
            flags[key] = next;
            i++;
        }
    }
    return flags;
}

function num(value: string | boolean | undefined, fallback: number): number {
    if (typeof value !== 'string') {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function gitCommit(): string | null {
    try {
        return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    const base = DEFAULT_GENERATOR_PARAMS;

    const params: HistoryGeneratorParams = {
        ...base,
        seed: num(flags.seed, base.seed),
        recordYears: num(flags.years, base.recordYears),
        recordThreshold: num(flags.threshold, base.recordThreshold),
        founderCount: num(flags.founders, base.founderCount),
        daysPerStep: num(flags['step-days'], base.daysPerStep),
        keepActionLog: flags['no-action-log'] ? false : (flags['keep-action-log'] ? true : base.keepActionLog),
        skillSnapshotYears: num(flags['snapshot-years'], base.skillSnapshotYears),
        carryingCapacity: {
            enabled: flags['no-capacity'] ? false : base.carryingCapacity.enabled,
            soft: num(flags.capacity, base.carryingCapacity.soft),
            steepness: num(flags.steepness, base.carryingCapacity.steepness),
        },
        safety: {
            maxRuntimeMs: num(flags['max-hours'], 0) > 0 ? num(flags['max-hours'], 0) * 3600_000 : base.safety.maxRuntimeMs,
            maxPeople: num(flags['max-people'], base.safety.maxPeople),
        },
    };

    const shortSeed = (params.seed >>> 0).toString(16);
    const outPath = typeof flags.out === 'string'
        ? resolve(flags.out)
        : resolve(process.cwd(), `src/assets/history/history-v${HISTORY_GENERATOR_VERSION}-${shortSeed}.tbz`);

    console.log(`[generate-history] generator v${HISTORY_GENERATOR_VERSION}, seed ${params.seed}`);
    console.log(`[generate-history] founders ${params.founderCount} → threshold ${params.recordThreshold} → +${params.recordYears}y`
        + `, ${params.daysPerStep}d/step, capacity ${params.carryingCapacity.enabled ? params.carryingCapacity.soft : 'off'}`);

    let lastLog = Date.now();
    const onProgress = (progress: GenerationProgress): void => {
        // Throttle console spam to ~once/second; always show phase transitions cheaply via the year counter.
        if (Date.now() - lastLog < 1000) {
            return;
        }
        lastLog = Date.now();
        console.log(`  [${progress.phase}] year ${progress.yearsDone} · living ${progress.living} · retained ${progress.retained}`);
    };

    const asset = await generateHistoryAsset(params, onProgress, gitCommit());

    const json = JSON.stringify(asset);
    asset.meta.stats.rawBytes = Buffer.byteLength(json, 'utf8');
    const payload = compress(JSON.stringify(asset));
    asset.meta.stats.compressedBytes = Buffer.byteLength(payload, 'utf8');

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, payload, 'utf8');

    const { stats } = asset.meta;
    console.log('\n[generate-history] done. Measurements:');
    console.log(`  epoch tick (t0):     ${asset.meta.epochTick}`);
    console.log(`  end tick:            ${asset.meta.endTick}  (${Math.round((asset.meta.endTick - asset.meta.epochTick) / params.ticksPerYear)}y recorded)`);
    console.log(`  final living:        ${stats.livingAtEnd}`);
    console.log(`  retained people:     ${stats.retainedPeople}`);
    console.log(`  births / deaths:     ${stats.births} / ${stats.deaths}`);
    console.log(`  median history len:  ${stats.medianHistoryLen}`);
    console.log(`  raw bytes:           ${stats.rawBytes.toLocaleString()}`);
    console.log(`  compressed bytes:    ${stats.compressedBytes.toLocaleString()}  (${(stats.compressedBytes / 1_048_576).toFixed(2)} MB)`);
    console.log(`  runtime:             ${(stats.runtimeMs / 1000).toFixed(1)}s`);
    console.log('  population trajectory (per decade):');
    for (const point of stats.trajectory) {
        console.log(`    year ${String(point.year).padStart(4)} · living ${point.living}`);
    }
    console.log(`\n[generate-history] wrote ${outPath}`);
}

main().catch(error => {
    console.error('[generate-history] failed:', error);
    process.exit(1);
});
