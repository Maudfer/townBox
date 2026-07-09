// The offline history-asset generator CLI (task 055 §2.6; sharded streaming since 077). Run with
// `npm run generate-history` (tsx resolves the game/* tsconfig path aliases). It reuses the pure generator
// core (game/HistoryAsset.generateHistoryAsset) and STREAMS the two big, ever-growing sections (event log +
// skill timeline) to sharded files as it goes, so RAM stays bounded no matter how long the run is. The output
// is a DIRECTORY (a small meta.json header + compressed section/shard files), not a single file — so a large
// asset splits into chunks the game loads on demand (only the shards up to the selected window), and stays
// git-friendly without LFS.
//
// The DEFAULT config (json/historyGenerator.json) is the richest simulation: daily stepping, the logical
// economy fully on, yearly skill snapshots. It is intentionally slow. The full ACTION log is OFF by default —
// it can't fit a sane asset budget and is regenerated live in-game — turn it on with --keep-action-log for a
// local ultra-rich asset (streaming keeps it RAM-safe).
//
// CLI flags override json/historyGenerator.json:
//   --seed N  --years N  --threshold N  --founders N  --capacity N (thermostat target)  --band F  --step-days N
//   --suppress-level F  --snapshot-years N  --flush-years N  --keep-action-log  --no-action-log  --no-capacity
//   --max-hours N  --max-people N  --out DIR
//   --full-manifest (run the full event manifest — texture events included; slower, for correctness runs)
//   --reduced-manifest (force the reduced walk on)  --profile (per-phase timing attribution → printed at end)

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import process from 'node:process';

import { compress } from 'util/compress';
import {
    generateHistoryAsset,
    DEFAULT_GENERATOR_PARAMS,
    HISTORY_GENERATOR_VERSION,
    HistoryGeneratorParams,
    GenerationProgress,
    HistoryAssetSink,
    ShardRef,
} from 'game/HistoryAsset';
import { EventLogTable } from 'types/LifeEvent';
import { SkillTimeline } from 'types/Skill';
import { AssetHeader } from 'game/HistoryAssetSelection';

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

// Writes a compressed section/shard file into the output dir and returns its byte size.
function writeCompressed(dir: string, file: string, data: unknown): number {
    const payload = compress(JSON.stringify(data));
    writeFileSync(join(dir, file), payload, 'utf8');
    return Buffer.byteLength(payload, 'utf8');
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
        reducedEventManifest: flags['full-manifest'] ? false : (flags['reduced-manifest'] ? true : base.reducedEventManifest),
        profile: flags.profile ? true : base.profile,
        skillSnapshotYears: num(flags['snapshot-years'], base.skillSnapshotYears),
        flushIntervalYears: num(flags['flush-years'], base.flushIntervalYears),
        populationControl: {
            ...base.populationControl,
            enabled: flags['no-capacity'] ? false : base.populationControl.enabled,
            target: num(flags.capacity, base.populationControl.target),
            band: num(flags.band, base.populationControl.band),
            suppressLevel: num(flags['suppress-level'], base.populationControl.suppressLevel),
        },
        safety: {
            maxRuntimeMs: num(flags['max-hours'], 0) > 0 ? num(flags['max-hours'], 0) * 3600_000 : base.safety.maxRuntimeMs,
            maxPeople: num(flags['max-people'], base.safety.maxPeople),
        },
    };

    const shortSeed = (params.seed >>> 0).toString(16);
    const outDir = typeof flags.out === 'string'
        ? resolve(flags.out)
        : resolve(process.cwd(), `src/assets/history/history-v${HISTORY_GENERATOR_VERSION}-${shortSeed}`);

    if (existsSync(outDir)) {
        rmSync(outDir, { recursive: true, force: true }); // fresh dir so stale shards from a prior run never linger
    }
    mkdirSync(outDir, { recursive: true });

    console.log(`[generate-history] generator v${HISTORY_GENERATOR_VERSION}, seed ${params.seed} → ${outDir}`);
    console.log(`[generate-history] founders ${params.founderCount} → threshold ${params.recordThreshold} → +${params.recordYears}y`
        + `, ${params.daysPerStep}d/step, target ${params.populationControl.enabled ? params.populationControl.target : 'off'}`
        + `, actionLog ${params.keepActionLog}, snapshot ${params.skillSnapshotYears}y, flush ${params.flushIntervalYears}y`
        + `, manifest ${params.reducedEventManifest ? 'reduced' : 'full'}${params.profile ? ', profile ON' : ''}`);

    // The streaming sink: each drained log/skill chunk becomes a compressed shard file on disk.
    let logIndex = 0;
    let skillIndex = 0;
    let shardBytes = 0;
    const tickRange = (ticks: number[]): { minTick: number; maxTick: number } => ({
        minTick: ticks.length ? Math.min(...ticks) : 0,
        maxTick: ticks.length ? Math.max(...ticks) : 0,
    });
    const sink: HistoryAssetSink = {
        logShard(table: EventLogTable): ShardRef {
            const ticks: number[] = [];
            for (const entries of Object.values(table)) {
                for (const entry of entries) {
                    ticks.push(entry.tick);
                }
            }
            const file = `log-${String(logIndex++).padStart(4, '0')}.tbz`;
            shardBytes += writeCompressed(outDir, file, table);
            return { file, ...tickRange(ticks) };
        },
        skillShard(timeline: SkillTimeline): ShardRef {
            const ticks: number[] = [];
            for (const snapshots of Object.values(timeline)) {
                for (const snapshot of snapshots) {
                    ticks.push(snapshot.tick);
                }
            }
            const file = `skills-${String(skillIndex++).padStart(4, '0')}.tbz`;
            shardBytes += writeCompressed(outDir, file, timeline);
            return { file, ...tickRange(ticks) };
        },
    };

    let lastLog = Date.now();
    const onProgress = (progress: GenerationProgress): void => {
        if (Date.now() - lastLog < 1000) {
            return;
        }
        lastLog = Date.now();
        console.log(`  [${progress.phase}] year ${progress.yearsDone} · living ${progress.living} · retained ${progress.retained}`);
    };

    const asset = await generateHistoryAsset(params, onProgress, gitCommit(), sink);

    // Write the section files (small, held in RAM) + the header.
    let sectionBytes = 0;
    sectionBytes += writeCompressed(outDir, 'population.tbz', asset.population);
    sectionBytes += writeCompressed(outDir, 'objects.tbz', asset.objects ?? { instances: {}, nextInstanceSeq: 0 });
    sectionBytes += writeCompressed(outDir, 'eventHistory.tbz', asset.eventHistory);

    const totalCompressed = shardBytes + sectionBytes;
    asset.meta.stats.compressedBytes = totalCompressed;

    const header: AssetHeader = {
        meta: asset.meta,
        eventLogSeq: asset.eventLogSeq,
        sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz' },
        logShards: asset.logShards ?? [],
        skillShards: asset.skillShards ?? [],
    };
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(header, null, 2), 'utf8');

    const { stats } = asset.meta;
    const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
    console.log('\n[generate-history] done. Measurements:');
    console.log(`  epoch tick (t0):     ${asset.meta.epochTick}`);
    console.log(`  end tick:            ${asset.meta.endTick}  (${Math.round((asset.meta.endTick - asset.meta.epochTick) / params.ticksPerYear)}y recorded)`);
    console.log(`  final living:        ${stats.livingAtEnd}`);
    console.log(`  retained people:     ${stats.retainedPeople}`);
    console.log(`  births / deaths:     ${stats.births} / ${stats.deaths}`);
    console.log(`  median history len:  ${stats.medianHistoryLen}`);
    console.log(`  log shards:          ${header.logShards.length}   skill shards: ${header.skillShards.length}`);
    console.log(`  shard bytes:         ${mb(shardBytes)} MB   section bytes: ${mb(sectionBytes)} MB`);
    console.log(`  TOTAL on disk:       ${mb(totalCompressed)} MB`);
    console.log(`  runtime:             ${(stats.runtimeMs / 1000).toFixed(1)}s`);
    if (stats.profile) {
        const p = stats.profile;
        const perAgentUs = (ms: number) => p.agentSteps > 0 ? ((ms * 1000) / p.agentSteps).toFixed(2) : '0';
        const pct = (ms: number) => p.total > 0 ? ((ms / p.total) * 100).toFixed(1) : '0';
        console.log(`\n  profile (${p.steps} steps, ${p.agentSteps} agent-steps; µs/agent-step, share of total):`);
        const row = (label: string, ms: number) => console.log(`    ${label.padEnd(12)} ${perAgentUs(ms).padStart(8)} µs   ${pct(ms).padStart(5)}%`);
        row('actions', p.actions);
        row('events', p.events);
        row('progression', p.progression);
        row('brain', p.brain);
        row('runDaily', p.runDaily);
        row('snapshot', p.snapshot);
        row('other', p.other);
        console.log(`    ${'TOTAL'.padEnd(12)} ${perAgentUs(p.total).padStart(8)} µs   ${(stats.profile.total / 1000).toFixed(1)}s`);
    }
    console.log('  population trajectory (per decade):');
    for (const point of stats.trajectory) {
        console.log(`    year ${String(point.year).padStart(4)} · living ${point.living}`);
    }
    console.log(`\n[generate-history] wrote ${outDir}`);
}

main().catch(error => {
    console.error('[generate-history] failed:', error);
    process.exit(1);
});
