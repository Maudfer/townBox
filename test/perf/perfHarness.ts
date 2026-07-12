// Perf-suite harness. The gate is a DETERMINISTIC OPERATION-COUNT check: the sim does exactly the same work
// on every machine and every run for a fixed seed, so the counts (util/perfMeter probes) are byte-identical
// everywhere. That lets the gate demand EXACT equality — any change in how much work a part of the sim does
// (a new event, an extra requirement check, a lost cache) shifts a count and fails the gate, forcing a
// conscious baseline bump. There is NO drift tolerance and NO machine-class caveat: the check enforces
// identically on a dev box and on CI, always. Re-baseline after an intentional change:
//   PERF_UPDATE_BASELINES=1 npx jest --selectProjects perf --runInBand   (then commit test/perf/baselines.json)
//
// The one residue counts cannot see — a constant-factor slowdown INSIDE an operation (same work, slower) —
// is guarded by a single within-run TIMING RATIO in regressionGuards.test.ts (predicate precompilation). That
// ratio is machine-independent (both paths timed in the same process) but is the sole non-count check.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const UPDATE_BASELINES = process.env.PERF_UPDATE_BASELINES === '1';

const BASELINE_PATH = join(__dirname, 'baselines.json');

// Time `fn` (which performs `ops` internal operations) and return the MINIMUM ms-per-op over `iterations`
// runs, after `warmup` untimed runs. The minimum is the cleanest regression signal: a real slowdown raises
// the best case, while GC/scheduling noise only inflates individual samples (which the min discards). Used
// ONLY by the predicate precompilation ratio guard — the count gate needs no timing.
export function minMsPerOp(fn: () => void, ops: number, iterations = 12, warmup = 4): number {
    for (let i = 0; i < warmup; i++) {
        fn();
    }
    let min = Infinity;
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        fn();
        const dt = performance.now() - t0;
        if (dt < min) {
            min = dt;
        }
    }
    return min / ops;
}

// A single measured operation-count against its committed baseline.
export interface CountResult {
    label: string;
    value: number | null;    // measured count this run (null = a baselined counter that never fired → regression)
    baseline: number | null; // committed baseline (null = a new counter with no baseline yet → not a regression)
    regressed: boolean;      // value !== baseline (exact); a new counter is recorded, never failed
}

type Baselines = Record<string, number>;

function loadBaselines(): Baselines {
    if (!existsSync(BASELINE_PATH)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baselines;
    } catch {
        return {};
    }
}

// Gate (or, under PERF_UPDATE_BASELINES, rewrite) measured counts against baselines.json by EXACT equality.
// Compares the UNION of measured and baselined keys, so both a count that grew/shrank AND a baselined counter
// that stopped firing (value null) are regressions. A NEW counter (no baseline) is recorded on the next update
// and never fails, so adding instrumentation is non-breaking.
export function gateCounts(measured: Record<string, number>): CountResult[] {
    const baselines = loadBaselines();
    const labels = [...new Set([...Object.keys(baselines), ...Object.keys(measured)])].sort();
    const results: CountResult[] = labels.map(label => {
        const value = measured[label] ?? null;
        const baseline = baselines[label] ?? null;
        const regressed = !UPDATE_BASELINES && baseline !== null && value !== baseline;
        return { label, value, baseline, regressed };
    });

    if (UPDATE_BASELINES) {
        const next: Baselines = {};
        for (const label of Object.keys(measured).sort()) {
            next[label] = measured[label]!;
        }
        writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
    }
    return results;
}

// One-line-per-metric table for the log, so a failure shows exactly which counter moved and by how much.
export function formatCounts(results: CountResult[]): string {
    const rows = results.map(r => {
        const value = r.value === null ? '  (gone)' : String(r.value);
        const base = r.baseline === null ? '  (new)' : String(r.baseline);
        const delta = r.baseline !== null && r.value !== null && r.value !== r.baseline
            ? `  ${r.value > r.baseline ? '+' : ''}${r.value - r.baseline}` : '';
        const flag = r.regressed ? '  <<< REGRESSED' : '';
        return `  ${r.label.padEnd(24)} ${value.padStart(10)}  base ${base.padStart(10)}${delta}${flag}`;
    });
    return rows.join('\n');
}
