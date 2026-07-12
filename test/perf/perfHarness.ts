// Unit performance-regression harness for the offline history generation (perf module).
//
// Goal: catch regressions in the SUBCOMPONENTS of the generation spine — especially per-agent step cost —
// that would erode the strides landed in tasks 078/079. The mentality is UNIT perf testing: measure small
// parts, in isolation or via the profiler's per-phase breakdown, so the sum of the parts stands in for
// benchmarking the whole flow (which we otherwise never run in CI).
//
// The hard problem is machine variance: CI runners (2-vCPU shared VMs) vary WILDLY at short timescales — a
// first CI run measured a supposedly-stable pure-compute calibration swinging 12× across six samples, from
// scheduler preemption. So absolute wall-clock, even normalized against a calibration, can't gate tightly.
//
// Two robust mechanisms instead, both machine-independent because they compare measurements taken in the SAME
// run so any jitter cancels:
//   1) DETERMINISTIC + within-run-RATIO guards (regressionGuards.test.ts): reference identity for the caches/
//      pruning, and cost ratios with huge signals (2–100×) for the agent-list gating and precompilation.
//   2) Per-phase COST FRACTIONS of a step (generationPerf.test.ts): each profiler bucket is expressed as
//      bucket / (total − bucket) — a dimensionless share of the tick. A uniform machine slowdown scales both
//      numerator and denominator equally, so the fraction is invariant; a component that gets slower raises
//      its own fraction (the denominator excludes it, so there's no absorption → full 5% sensitivity).
// Baselines are the committed fractions in test/perf/baselines.json; a metric fails above baseline × (1 + TOL).
//
// Re-baseline (after an intentional change): PERF_UPDATE_BASELINES=1 npx jest --selectProjects perf --runInBand

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The fraction metrics cancel machine JITTER within a run, but they still drift a little across DIFFERENT
// microarchitectures (a component's share of a tick depends on how that CPU weights its op mix). So the gate
// is strict but not razor-thin, and — critically — the committed baselines are measured on the same machine
// class that runs the gate (CI), not a dev box: the first CI run of the DOMINANT buckets landed within ±6% of
// a dev box, while the small (< ~0.05-share) buckets swung ±15%. So only the dominant buckets are ENFORCED
// (see ENFORCED_FRACTIONS in generationPerf), at a tolerance with headroom over that ±6% for CI-to-CI noise;
// the small buckets are logged for trend and covered precisely by the deterministic guards.
export const FRACTION_TOLERANCE = 0.12;
export const UPDATE_BASELINES = process.env.PERF_UPDATE_BASELINES === '1';

// The aggregate fraction gate ENFORCES only when PERF_ENFORCE=1 (set on the CI `perf` job once its baselines
// are CI-measured). Otherwise — a dev run, or CI before the baselines are trusted — it LOGS the table but
// never fails. The deterministic + within-run-ratio GUARDS in regressionGuards.test.ts are machine-independent
// and ALWAYS enforce (they're what makes the perf job a safe blocking check).
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

// A single measured metric with its committed baseline and whether it regressed.
export interface PerfResult {
    label: string;
    value: number;           // the measured fraction (dimensionless, machine-independent)
    baseline: number | null; // committed baseline, or null when new/updating
    ratio: number | null;    // value / baseline (>1 means the component grew its share); null when no baseline
    enforced: boolean;       // whether crossing the tolerance FAILS the gate (vs. logged for trend only)
    regressed: boolean;      // enforced AND over tolerance
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

// Gate (or, under PERF_UPDATE_BASELINES, rewrite) a map of measured metrics against baselines.json. Returns a
// per-label verdict; callers assert `every(r => !r.regressed)` and log the table. `enforced` names the subset
// whose over-tolerance FAILS the gate — everything else is measured and logged (for trend) but never fails, so
// the small, noisy buckets don't cause flakes. New labels (no baseline yet) never fail either — they're
// recorded on the next update, so adding a metric is non-breaking.
export function gateAgainstBaselines(measured: Record<string, number>, enforced?: Set<string>, tolerance = FRACTION_TOLERANCE): PerfResult[] {
    const baselines = loadBaselines();
    const results: PerfResult[] = Object.entries(measured).map(([label, value]) => {
        const baseline = baselines[label] ?? null;
        const ratio = baseline !== null && baseline > 0 ? value / baseline : null;
        const isEnforced = enforced === undefined || enforced.has(label);
        const regressed = isEnforced && !UPDATE_BASELINES && ratio !== null && ratio > 1 + tolerance;
        return { label, value, baseline, ratio, enforced: isEnforced, regressed };
    });

    if (UPDATE_BASELINES) {
        const next: Baselines = { ...baselines };
        for (const r of results) {
            next[r.label] = Number(r.value.toFixed(5));
        }
        writeFileSync(BASELINE_PATH, JSON.stringify(next, Object.keys(next).sort(), 2) + '\n', 'utf8');
    }
    return results;
}

// Pretty one-line-per-metric table for the CI log, so a failure shows exactly which component grew its share.
export function formatResults(results: PerfResult[]): string {
    const rows = results.map(r => {
        const base = r.baseline === null ? '  (new)' : r.baseline.toFixed(5);
        const ratio = r.ratio === null ? '    -' : `${(r.ratio * 100).toFixed(1)}%`;
        const tier = r.enforced ? '*' : ' '; // '*' = enforced (can fail the gate); ' ' = logged for trend only
        const flag = r.regressed ? '  <<< REGRESSED' : '';
        return `${tier} ${r.label.padEnd(26)} frac ${r.value.toFixed(5).padStart(9)}  base ${base.padStart(9)}  ${ratio.padStart(7)}${flag}`;
    });
    return rows.join('\n');
}
