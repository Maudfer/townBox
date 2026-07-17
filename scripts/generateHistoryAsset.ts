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

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
    generateHistoryAsset,
    DEFAULT_GENERATOR_PARAMS,
    HISTORY_GENERATOR_VERSION,
    HistoryGeneratorParams,
    GenerationProgress,
    HistoryAssetSink,
} from 'game/history/HistoryAsset';
import { AssetHeader, PersonChunk } from 'game/history/HistoryAssetSelection';
import { PersonId } from 'types/Genealogy';
import { EventLogTable } from 'types/LifeEvent';
import { SkillTimeline } from 'types/Skill';
import { compress } from 'util/compress';
import { formatDuration, DAYS_PER_YEAR, DAYS_PER_MONTH, DAYS_PER_WEEK } from 'util/time';

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

    // Asset identity: history-<serial>-<hash>. `serial` is a 14-digit sortable timestamp (YYYYMMDDHHMMSS);
    // `hash` is 4 hex chars over (argv, seed, params, hrtime) for uniqueness/provenance. Used to name --dev
    // subfolders and stamped into manifest.json.
    const historyRoot = resolve(process.cwd(), 'src/history');
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const serial = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
    const hash = createHash('sha1')
        .update(JSON.stringify({ argv: process.argv.slice(2), seed: params.seed, params }) + process.hrtime.bigint().toString())
        .digest('hex').slice(0, 4);
    const assetName = `history-${serial}-${hash}`;

    // Output location + pointer mode (the asset is versioned as ONE committed copy, not an accumulating pile):
    //   --out DIR : explicit dir, no pointer, no clear (tests / throwaway runs).
    //   --dev     : src/history/dev/<assetName>/ (gitignored) + the gitignored asset.local.json override —
    //               iterate on assets without touching or risking a commit of the real pointer.
    //   default   : src/history/ root (the single committed asset). Clears the previous default IN PLACE
    //               (keeping the dev/ subtree) and writes asset.json → "./" (dropping any dev override).
    const explicitOut = typeof flags.out === 'string';
    const devMode = !explicitOut && !!flags.dev;
    const defaultMode = !explicitOut && !flags.dev;
    const outDir = explicitOut ? resolve(flags.out as string)
        : devMode ? join(historyRoot, 'dev', assetName)
        : historyRoot;

    if (defaultMode && existsSync(historyRoot)) {
        // Overwrite the previous default in place: remove top-level files (old asset + asset.json +
        // asset.local.json), but leave dev/ (accumulated dev generations) alone.
        for (const entry of readdirSync(historyRoot, { withFileTypes: true })) {
            if (entry.isFile()) {
                rmSync(join(historyRoot, entry.name), { force: true });
            }
        }
    }
    if (devMode && existsSync(outDir)) {
        rmSync(outDir, { recursive: true, force: true }); // a same-name dev run overwrites its own subfolder
    }
    mkdirSync(outDir, { recursive: true });

    console.log(`[generate-history] generator v${HISTORY_GENERATOR_VERSION}, seed ${params.seed} → ${outDir}`);
    // Human-readable generation plan: granularity, expected log cadence per period, and (from the step size)
    // what week/month skips to expect. Printed once, up front, so the progress stream below reads in context.
    const stepDays = Math.max(1, Math.floor(params.daysPerStep));
    const weekLogsPerYear = stepDays <= DAYS_PER_WEEK ? 52 : Math.ceil(DAYS_PER_YEAR / stepDays);
    const monthLogsPerYear = stepDays <= DAYS_PER_MONTH ? 12 : Math.ceil(DAYS_PER_YEAR / stepDays);
    const stepDesc = stepDays === 1 ? 'daily — every day simulated'
        : stepDays <= DAYS_PER_WEEK ? `${stepDays} days/step — every week boundary hit`
        : `${stepDays} days/step — weeks jumped ${stepDays} days at a time (see "N days simulated")`;
    console.log(`[generate-history] plan:`);
    console.log(`  stepping   : ${stepDesc}`);
    console.log(`  logs / year: ~${weekLogsPerYear} weeks, ${monthLogsPerYear} months, 1 year (logged at each period's end)`);
    console.log(`  warmup     : grow ${params.founderCount} → ${params.recordThreshold} living, then record ${params.recordYears} years`);
    console.log(`  event walk : ${params.reducedEventManifest ? 'reduced' : 'full'} manifest · action log ${params.keepActionLog ? 'kept' : 'off'}`
        + `, snapshot ${params.skillSnapshotYears}y, flush ${params.flushIntervalYears}y`);
    console.log(`  console    : progress batched once/sec, all lines kept${params.profile ? ' · profile ON' : ''}`);

    // The streaming sink (format v2, the person-keyed lazy layout): each drained log/skill flush is split BY
    // PERSON, and every person's slice is appended as one compressed chunk line to that person's file
    // (`person-<id>.tbz`, newline-separated — base64 payloads are newline-free, so appends need no framing).
    // The game later fetches exactly the files of the people it materializes; nothing else is ever read.
    const personFiles = new Map<PersonId, string>();
    let personBytes = 0;
    const appendPersonChunk = (personId: PersonId, chunk: PersonChunk): void => {
        let file = personFiles.get(personId);
        if (!file) {
            file = `person-${personId}.tbz`;
            personFiles.set(personId, file);
        }
        const line = compress(JSON.stringify(chunk)) + '\n';
        appendFileSync(join(outDir, file), line, 'utf8');
        personBytes += Buffer.byteLength(line, 'utf8');
    };
    const sink: HistoryAssetSink = {
        logChunk(table: EventLogTable): void {
            for (const [personId, entries] of Object.entries(table)) {
                appendPersonChunk(personId, { log: entries });
            }
        },
        skillChunk(timeline: SkillTimeline): void {
            for (const [personId, snapshots] of Object.entries(timeline)) {
                appendPersonChunk(personId, { skills: snapshots });
            }
        },
    };

    // --- Sequential period-end progress, batched to the console once per second ---------------------------
    // The generator fires per step; here we detect week/month/year ENDS (phase-relative — recording years count
    // from 0) and roll them up finest→coarsest. Lines accumulate in `logBuffer` and flush in ONE write at most
    // once per real second, so completeness never costs the loop more than a single synchronous TTY write/sec
    // (simulation performance stays the priority). A per-second buffer is memory-bounded (≤1s of lines).
    const ticksPerDay = params.ticksPerYear / DAYS_PER_YEAR;
    const pad2 = (n: number): string => String(n).padStart(2, '0');
    const logBuffer: string[] = [];
    let lastFlush = Date.now();
    const flushLog = (force: boolean): void => {
        if (logBuffer.length === 0 || (!force && Date.now() - lastFlush < 1000)) {
            return;
        }
        process.stdout.write(logBuffer.join('\n') + '\n');
        logBuffer.length = 0;
        lastFlush = Date.now();
    };

    // Period trackers (the CURRENTLY in-progress period; a period is logged when the NEXT one begins).
    let logPhase: GenerationProgress['phase'] | null = null;
    let pWeek = -1, pWeekYear = -1, weekStartDay = 0;
    let pMonth = -1, pMonthYear = -1;
    let pYear = -1;
    let lastDay = -1, lastLiving = 0; // captured for the trailing partials (the run stops mid-period)

    const onProgress = (p: GenerationProgress): void => {
        const tag = p.phase === 'warmup' ? '[warmup] ' : '';
        // Phase change → flush, banner, reset trackers (recording restarts the year count at 0).
        if (p.phase !== logPhase) {
            flushLog(true);
            if (p.phase === 'recording') {
                logBuffer.push(`── recording window begins · ${params.recordYears} years ──`);
            }
            logPhase = p.phase;
            pWeek = pMonth = pYear = -1;
            pWeekYear = pMonthYear = -1;
            weekStartDay = 0;
        }
        const day = Math.floor(p.ticksIntoPhase / ticksPerDay);
        const dayOfYear = ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
        const week = Math.floor(dayOfYear / DAYS_PER_WEEK);   // 0..51 (week 51 = the 3-day year-end stub)
        const month = Math.floor(dayOfYear / DAYS_PER_MONTH); // 0..11
        const year = Math.floor(day / DAYS_PER_YEAR);
        lastDay = day;
        lastLiving = p.living;
        // First fire of the phase: seed the trackers, emit nothing (no period has completed yet).
        if (pYear === -1) {
            pWeek = week; pWeekYear = year; pMonth = month; pMonthYear = year; pYear = year; weekStartDay = day;
            return;
        }
        // Week ended → the PREVIOUS week completed; "N days simulated" reports the days actually stepped in it
        // (7 for a full week, 3 for the year-end stub, or the whole jump under coarse stepping).
        if (year !== pWeekYear || week !== pWeek) {
            logBuffer.push(`${tag}Simulated week ${pad2(pWeek + 1)} · ${day - weekStartDay} days simulated · ${p.living} living`);
            pWeek = week; pWeekYear = year; weekStartDay = day;
        }
        if (year !== pMonthYear || month !== pMonth) {
            logBuffer.push(`${tag}Simulated month ${pad2(pMonth + 1)} of year ${pMonthYear} · ${p.living} living`);
            pMonth = month; pMonthYear = year;
        }
        if (year !== pYear) {
            logBuffer.push(`${tag}Simulated year ${pYear}`);
            pYear = year;
        }
        flushLog(false);
    };

    const asset = await generateHistoryAsset(params, onProgress, gitCommit(), sink);

    // Trailing partials: termination breaks BEFORE the final period boundary fires, so emit the still-in-progress
    // week/month/year — otherwise the last simulated year would never print. Then flush the batch unconditionally.
    if (logPhase !== null && lastDay >= 0) {
        const tag = logPhase === 'warmup' ? '[warmup] ' : '';
        // Inclusive day count (lastDay is the last day reached, vs the normal path's exclusive day-after-end),
        // so the trailing stub week matches the count a fully-completed one would show.
        logBuffer.push(`${tag}Simulated week ${pad2(pWeek + 1)} · ${lastDay - weekStartDay + 1} days simulated · ${lastLiving} living`);
        logBuffer.push(`${tag}Simulated month ${pad2(pMonth + 1)} of year ${pMonthYear} · ${lastLiving} living`);
        logBuffer.push(`${tag}Simulated year ${pYear}`);
    }
    flushLog(true);

    // Prune person files for people the generator dropped as warm-up scaffolding (they streamed chunks while
    // alive but are not in the retained pool), so the asset carries exactly one file per RETAINED person and
    // the header's people map doubles as the existence check.
    const retained = new Set(Object.keys(asset.population.people));
    let prunedFiles = 0;
    for (const [personId, file] of [...personFiles]) {
        if (retained.has(personId)) {
            continue;
        }
        const path = join(outDir, file);
        if (existsSync(path)) {
            personBytes -= statSync(path).size;
            rmSync(path, { force: true });
        }
        personFiles.delete(personId);
        prunedFiles++;
    }

    // Write the section files (small, held in RAM) + the header.
    let sectionBytes = 0;
    sectionBytes += writeCompressed(outDir, 'population.tbz', asset.population);
    sectionBytes += writeCompressed(outDir, 'objects.tbz', asset.objects ?? { instances: {}, nextInstanceSeq: 0 });
    sectionBytes += writeCompressed(outDir, 'eventHistory.tbz', asset.eventHistory);
    sectionBytes += writeCompressed(outDir, 'socialGraph.tbz', asset.socialGraph ?? { edges: {} });

    const totalCompressed = personBytes + sectionBytes;
    asset.meta.stats.compressedBytes = totalCompressed;

    const header: AssetHeader = {
        meta: asset.meta,
        eventLogSeq: asset.eventLogSeq,
        sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz', socialGraph: 'socialGraph.tbz' },
        people: Object.fromEntries(personFiles),
    };
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(header, null, 2), 'utf8');

    // Run-provenance card (human/tooling-facing). It records ONLY what meta.json does not already carry — the
    // where/how/when of the run and the on-disk size breakdown. All asset identity, config, ticks and measured
    // stats are the machine source of truth in meta.json (which the loader reads), so they are NOT echoed here:
    //   params / seed → meta.meta.params (+ .params.seed)      gitCommit → meta.meta.gitCommit
    //   formatVersion/generatorVersion/epochTick/endTick/      stats (trajectory/births/deaths/runtimeMs/…)
    //     ticksPerYear/createdAt → meta.meta.*                   → meta.meta.stats
    //   sections + per-shard tick ranges → meta.sections/logShards/skillShards
    // Read meta.json for any of the above; this file adds environment, invocation, naming, a human runtime,
    // and the size split (total = shardBytes + sectionBytes = meta.meta.stats.compressedBytes).
    const generatedAt = now.toISOString();
    const manifest = {
        generatedAt,
        serial,
        hash,
        name: assetName,
        generator: { script: 'scripts/generateHistoryAsset.ts' },
        environment: { node: process.version, platform: `${process.platform}/${process.arch}`, host: hostname() },
        invocation: { argv: process.argv.slice(2), flags },
        runtime: formatDuration(asset.meta.stats.runtimeMs),
        people: { files: personFiles.size, prunedWarmupFiles: prunedFiles },
        sizes: { personBytes, sectionBytes },
    };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // Asset pointer — a one-property file naming which asset dir to load ({ "dir": "./" } for the committed
    // default, "./dev/<assetName>/" for a dev build). It carries nothing else: everything latest.json used to
    // duplicate (serial/hash/generatedAt live in manifest.json; generatorVersion/seed/livingAtEnd/
    // retainedPeople/compressedBytes live in meta.json) is already in those files. Default → the committed
    // `asset.json`; --dev → the GITIGNORED `asset.local.json` override (preferred over asset.json by
    // copy-history + the runtime), so a dev pointer can never be committed. Explicit --out writes no pointer.
    if (defaultMode) {
        writeFileSync(join(historyRoot, 'asset.json'), JSON.stringify({ dir: './' }, null, 2), 'utf8');
    } else if (devMode) {
        writeFileSync(join(historyRoot, 'asset.local.json'), JSON.stringify({ dir: `./dev/${assetName}/` }, null, 2), 'utf8');
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
    console.log(`  person files:        ${personFiles.size} (pruned ${prunedFiles} warm-up-only)`);
    console.log(`  person bytes:        ${mb(personBytes)} MB   section bytes: ${mb(sectionBytes)} MB`);
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
    console.log(`[generate-history]   + manifest.json (run provenance: env/invocation/naming/sizes)`);
    if (defaultMode) {
        console.log(`[generate-history]   + asset.json → ./ (committed default pointer)`);
    } else if (devMode) {
        console.log(`[generate-history]   + asset.local.json → ./dev/${assetName}/ (gitignored dev override)`);
    }
}

main().catch(error => {
    console.error('[generate-history] failed:', error);
    process.exit(1);
});
