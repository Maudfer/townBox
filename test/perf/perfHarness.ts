// Unit performance-regression harness for the offline history generation (perf module).
//
// Goal: catch regressions in the SUBCOMPONENTS of the generation spine — especially per-agent step cost —
// that would erode the strides landed in tasks 078/079. The mentality is UNIT perf testing: measure small
// parts, in isolation or via the profiler's per-phase breakdown, so the sum of the parts stands in for
// benchmarking the whole flow (which we otherwise never run in CI).
//
// The hard problem is machine variance: CI runners are slower/faster than a dev box, so absolute µs baselines
// don't transfer. Every measurement is therefore NORMALIZED against an in-run CALIBRATION workload (a blended
// mix of the primitives the sim leans on — RNG draws, Map churn, object/closure access, array scans). A
// component's normalized cost = (its ns/op) / (calibration ns/unit): a uniform machine slowdown scales both,
// leaving the ratio stable, while a real regression raises the component alone. Baselines are the committed
// normalized ratios in test/perf/baselines.json; a measurement fails when it exceeds baseline × (1 + TOLERANCE).
//
// Re-baseline (after an intentional change, or on a new reference machine): run
//   PERF_UPDATE_BASELINES=1 npx jest --selectProjects perf
// which rewrites baselines.json from the current run instead of gating. Do this on a quiet machine.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The maintainer's strictness bar is 5%, but raw wall-clock on a CI runner varies far more than that
// process-to-process (empirically ~15–40% for short benches). So the 5% bar is enforced RELIABLY via the
// deterministic + within-run-RATIO guards in regressionGuards.test.ts (identity/counts/ratios cancel machine
// noise and carry huge regression signals). The normalized wall-clock costs in generationPerf.test.ts are the
// AGGREGATE per-agent/per-phase view (profiled, averaged over thousands of agent-steps + min-of-R, so far
// steadier than a micro-bench); they gate at COST_TOLERANCE — loose enough to survive runner noise, tight
// enough to catch a real slowdown — and log the full table every run so trends are watchable at a glance.
export const COST_TOLERANCE = 0.20;
export const UPDATE_BASELINES = process.env.PERF_UPDATE_BASELINES === '1';

// The aggregate wall-clock cost gate is only ENFORCED in an isolated run (the CI `perf` job runs jest
// --runInBand with PERF_ENFORCE=1). Under a parallel `npm test`, sibling workers hammer the CPU and the
// memory-bound sim slows more than the compute-bound calibration, so the normalized costs inflate — there it
// LOGS only, never fails. The deterministic + within-run-ratio GUARDS are robust under load and always
// enforce. (Baseline-update runs implicitly enforce nothing — they rewrite instead.)
export const ENFORCE_COST_GATE = process.env.PERF_ENFORCE === '1' && !UPDATE_BASELINES;

const BASELINE_PATH = join(__dirname, 'baselines.json');

// Time `fn` (which performs `ops` internal operations) and return the MINIMUM ms-per-op over `iterations`
// runs, after `warmup` untimed runs. The minimum is the cleanest regression signal: a real slowdown raises
// the best case, while GC/scheduling noise only inflates individual samples (which the min discards).
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

// The calibration workload: a tight, ALLOCATION-FREE integer loop (mulberry32 — the exact core of the sim's
// SeededRandom, the single most-called primitive of a step). Pure compute means no GC, so its cost is a
// low-noise, CPU-clock-proportional yardstick: dividing a component's cost by it cancels a uniform machine
// speedup. (An earlier blended, allocation-heavy calibration was GC-noisy and made the normalization flake —
// every bucket moving together is the tell-tale of a noisy denominator, not a real regression.) The residual
// cross-machine imperfection — compute-bound calibration vs a more memory-bound sim — is absorbed by the loose
// COST_TOLERANCE; the TIGHT protection is the within-run-ratio guards.
export function calibrationCostPerUnit(): number {
    const UNITS = 2_000_000;
    const imul = Math.imul;
    const run = (): void => {
        let state = 0x9e3779b1 >>> 0;
        let acc = 0;
        for (let i = 0; i < UNITS; i++) {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = imul(t ^ (t >>> 15), t | 1);
            t ^= t + imul(t ^ (t >>> 7), t | 61);
            acc = (acc + ((t ^ (t >>> 14)) >>> 0)) >>> 0;
        }
        if (acc === 0xffffffff && state === 0) {
            throw new Error('unreachable'); // keep acc/state observable so the loop isn't optimized away
        }
    };
    return minMsPerOp(run, UNITS, 25, 8);
}

// A single measured, calibration-normalized cost with its committed baseline and whether it regressed.
export interface PerfResult {
    label: string;
    normalized: number;      // measured cost / calibration cost (machine-independent units)
    baseline: number | null; // committed baseline, or null when new/updating
    ratio: number | null;    // normalized / baseline (>1 means slower); null when no baseline
    regressed: boolean;
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

// Gate (or, under PERF_UPDATE_BASELINES, rewrite) a map of measured normalized costs against baselines.json.
// Returns a per-label verdict; callers assert `every(r => !r.regressed)` and log the table. New labels (no
// baseline yet) never fail — they're recorded on the next update so adding a measurement is non-breaking.
export function gateNormalized(measured: Record<string, number>, tolerance = COST_TOLERANCE): PerfResult[] {
    const baselines = loadBaselines();
    const results: PerfResult[] = Object.entries(measured).map(([label, normalized]) => {
        const baseline = baselines[label] ?? null;
        const ratio = baseline !== null && baseline > 0 ? normalized / baseline : null;
        const regressed = !UPDATE_BASELINES && ratio !== null && ratio > 1 + tolerance;
        return { label, normalized, baseline, ratio, regressed };
    });

    if (UPDATE_BASELINES) {
        const next: Baselines = { ...baselines };
        for (const r of results) {
            next[r.label] = Number(r.normalized.toFixed(4));
        }
        writeFileSync(BASELINE_PATH, JSON.stringify(next, Object.keys(next).sort(), 2) + '\n', 'utf8');
    }
    return results;
}

// Pretty one-line-per-metric table for the CI log, so a failure shows exactly which component regressed.
export function formatResults(results: PerfResult[]): string {
    const rows = results.map(r => {
        const base = r.baseline === null ? '   (new)' : r.baseline.toFixed(4);
        const ratio = r.ratio === null ? '    -' : `${(r.ratio * 100).toFixed(1)}%`;
        const flag = r.regressed ? '  <<< REGRESSED' : '';
        return `  ${r.label.padEnd(26)} norm ${r.normalized.toFixed(4).padStart(9)}  base ${base.padStart(9)}  ${ratio.padStart(7)}${flag}`;
    });
    return rows.join('\n');
}
