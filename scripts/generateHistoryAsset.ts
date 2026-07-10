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

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import process from 'node:process';

import { compress } from 'util/compress';
import { formatDuration } from 'util/time';
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

    // Naming (never overwrites, "latest" = numerically highest): history-<serial>-<hash>. `serial` is a
    // 14-digit sortable timestamp (YYYYMMDDHHMMSS) — monotonic and scalable to unlimited runs; a later run is
    // always a higher number. `hash` is 4 hex chars over (argv, seed, params, hrtime) for uniqueness/provenance
    // and to disambiguate two runs in the same second. A committed `latest.json` pointer (below) then makes
    // "load the newest asset" a one-file lookup.
    const historyRoot = resolve(process.cwd(), 'src/assets/history');
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const serial = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
    const hash = createHash('sha1')
        .update(JSON.stringify({ argv: process.argv.slice(2), seed: params.seed, params }) + process.hrtime.bigint().toString())
        .digest('hex').slice(0, 4);

    let outDir = typeof flags.out === 'string' ? resolve(flags.out) : join(historyRoot, `history-${serial}-${hash}`);
    // Never overwrite: if the target somehow already exists, bump a suffix instead of wiping it.
    if (existsSync(outDir)) {
        let suffix = 2;
        while (existsSync(`${outDir}-${suffix}`)) {
            suffix++;
        }
        outDir = `${outDir}-${suffix}`;
    }
    mkdirSync(outDir, { recursive: true });

    console.log(`[generate-history] generator v${HISTORY_GENERATOR_VERSION}, seed ${params.seed} → ${outDir}`);
    console.log(`[generate-history] founders ${params.founderCount} → threshold ${params.recordThreshold} → +${params.recordYears}y`
        + `, ${params.daysPerStep}d/step, target ${params.populationControl.enabled ? params.populationControl.target : 'off'}`
        + `, actionLog ${params.keepActionLog}, snapshot ${params.skillSnapshotYears}y, flush ${params.flushIntervalYears}y`
        + `, manifest ${params.reducedEventManifest ? 'reduced' : 'full'}${params.profile ? ', profile ON' : ''}`);

    // The streaming sink: each drained log/skill chunk becomes a compressed shard file on disk. min/max ticks
    // are accumulated in a running loop — NOT `Math.min(...ticks)` — because an action-log shard can hold
    // hundreds of thousands of entries, and spreading that many args overflows the call stack.
    let logIndex = 0;
    let skillIndex = 0;
    let shardBytes = 0;
    const emptyRange = (): { minTick: number; maxTick: number } => ({ minTick: 0, maxTick: 0 });
    const sink: HistoryAssetSink = {
        logShard(table: EventLogTable): ShardRef {
            const range = emptyRange();
            let seen = false;
            for (const entries of Object.values(table)) {
                for (const entry of entries) {
                    if (!seen) {
                        range.minTick = range.maxTick = entry.tick;
                        seen = true;
                    } else {
                        if (entry.tick < range.minTick) { range.minTick = entry.tick; }
                        if (entry.tick > range.maxTick) { range.maxTick = entry.tick; }
                    }
                }
            }
            const file = `log-${String(logIndex++).padStart(4, '0')}.tbz`;
            shardBytes += writeCompressed(outDir, file, table);
            return { file, ...range };
        },
        skillShard(timeline: SkillTimeline): ShardRef {
            const range = emptyRange();
            let seen = false;
            for (const snapshots of Object.values(timeline)) {
                for (const snapshot of snapshots) {
                    if (!seen) {
                        range.minTick = range.maxTick = snapshot.tick;
                        seen = true;
                    } else {
                        if (snapshot.tick < range.minTick) { range.minTick = snapshot.tick; }
                        if (snapshot.tick > range.maxTick) { range.maxTick = snapshot.tick; }
                    }
                }
            }
            const file = `skills-${String(skillIndex++).padStart(4, '0')}.tbz`;
            shardBytes += writeCompressed(outDir, file, timeline);
            return { file, ...range };
        },
    };

    let lastLog = Date.now();
    const onProgress = (progress: GenerationProgress): void => {
        // Year milestones always print; the finer weekly lines within them are rate-limited so a fast run
        // (many weeks per real second) doesn't flood the console.
        if (!progress.yearBoundary && Date.now() - lastLog < 1000) {
            return;
        }
        lastLog = Date.now();
        if (progress.yearBoundary) {
            console.log(`  [${progress.phase}] year ${progress.yearsDone} · living ${progress.living} · retained ${progress.retained}`);
        } else {
            const month = String(progress.monthOfYear + 1).padStart(2, '0');
            const week = String(progress.weekOfYear + 1).padStart(2, '0');
            console.log(`  [${progress.phase}] year ${progress.yearsDone} · month ${month} · week ${week} · living ${progress.living}`);
        }
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

    // Exhaustive provenance manifest (human/tooling-facing; the loader only needs meta.json). Everything we
    // know about how this asset was produced: when, on what, with which flags/params, and its measured stats.
    const generatedAt = now.toISOString();
    const manifest = {
        generatedAt,
        serial,
        hash,
        dir: basename(outDir),
        generator: { version: HISTORY_GENERATOR_VERSION, script: 'scripts/generateHistoryAsset.ts' },
        gitCommit: asset.meta.gitCommit,
        environment: { node: process.version, platform: `${process.platform}/${process.arch}`, host: hostname() },
        invocation: { argv: process.argv.slice(2), flags },
        params,
        seed: params.seed,
        assetMeta: {
            formatVersion: asset.meta.formatVersion,
            generatorVersion: asset.meta.generatorVersion,
            epochTick: asset.meta.epochTick,
            endTick: asset.meta.endTick,
            ticksPerYear: asset.meta.ticksPerYear,
            createdAt: asset.meta.createdAt,
        },
        stats: asset.meta.stats,
        runtime: formatDuration(asset.meta.stats.runtimeMs),
        files: {
            sections: header.sections,
            logShards: header.logShards.length,
            skillShards: header.skillShards.length,
        },
        sizes: { shardBytes, sectionBytes, totalCompressedBytes: totalCompressed },
    };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // "Latest" pointer (default-located assets only): a one-file lookup so the game/tooling can resolve the
    // newest asset without listing the directory. `serial` is monotonic, so this always points at the newest.
    if (typeof flags.out !== 'string') {
        const latest = {
            dir: basename(outDir),
            serial,
            hash,
            generatedAt,
            generatorVersion: HISTORY_GENERATOR_VERSION,
            seed: params.seed,
            livingAtEnd: asset.meta.stats.livingAtEnd,
            retainedPeople: asset.meta.stats.retainedPeople,
            totalCompressedBytes: totalCompressed,
        };
        writeFileSync(join(historyRoot, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');
    }

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
    console.log(`  runtime:             ${formatDuration(stats.runtimeMs)}`);
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

        // Finer attribution (task 079): the brain bucket split per-hook + arbitration, and the actions bucket
        // split per advance sub-phase. Sorted heaviest-first so the dominant cost is obvious at a glance.
        const subRow = (label: string, ms: number) => console.log(`      ${label.padEnd(20)} ${perAgentUs(ms).padStart(8)} µs   ${pct(ms).padStart(5)}%`);
        const sortedEntries = (record: Record<string, number>) => Object.entries(record).sort((a, b) => b[1] - a[1]);
        if (p.brainHooks) {
            console.log(`\n    brain breakdown (µs/agent-step, share of TOTAL):`);
            for (const [hook, ms] of sortedEntries(p.brainHooks)) {
                subRow(`hook:${hook}`, ms);
            }
            subRow('resolveIntents', p.brainResolve ?? 0);
        }
        if (p.actionsAdvance) {
            console.log(`\n    actions breakdown (µs/agent-step, share of TOTAL):`);
            for (const [phase, ms] of sortedEntries(p.actionsAdvance)) {
                subRow(`advance:${phase}`, ms);
            }
        }
    }
    console.log('  population trajectory (per decade):');
    for (const point of stats.trajectory) {
        console.log(`    year ${String(point.year).padStart(4)} · living ${point.living}`);
    }
    console.log(`\n[generate-history] wrote ${outDir}`);
    console.log(`[generate-history]   + manifest.json (exhaustive provenance)`);
    if (typeof flags.out !== 'string') {
        console.log(`[generate-history]   + latest.json → ${basename(outDir)} (newest asset pointer)`);
    }
}

main().catch(error => {
    console.error('[generate-history] failed:', error);
    process.exit(1);
});
