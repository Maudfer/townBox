// Deterministic operation-count instrumentation for the perf suite (test/perf).
//
// Wall-clock timing drifts with the machine and the runner's load; a COUNT of work units does not. Given the
// simulation's determinism (fixed world seed → the same events fire, the same predicates evaluate, the same
// caches miss, on every machine and every run), these counts are byte-for-byte identical everywhere — so the
// perf gate can demand EXACT equality with no drift tolerance, and any change that makes a part of the sim do
// more work forces a conscious baseline bump. What counts CANNOT see is a constant-factor slowdown inside a
// single operation (same work, executed slower) — that residue is guarded by the one within-run TIMING ratio
// in regressionGuards.test.ts (predicate precompilation), the sole machine-dependent check left.
//
// Ambient + opt-in. Probes call `count(...)`; when no meter is active — all normal play and the whole offline
// generator — `count` is a single monomorphic null check (V8 inlines it), so production pays effectively
// nothing and, crucially, the counting reads nothing that could affect logic or the RNG stream, so enabling it
// never changes simulation output. A meter is live only for the window a perf test wraps in begin/endMeter.

export interface Meter {
    tally: Record<string, number>;
}

let active: Meter | null = null;

// Start counting into a fresh meter and return it. Nesting isn't supported (the perf tests are --runInBand and
// meter one window at a time); a second begin simply replaces the active meter.
export function beginMeter(): Meter {
    active = { tally: {} };
    return active;
}

// Stop counting. Probes become no-ops again until the next beginMeter.
export function endMeter(): void {
    active = null;
}

// Record `n` (default 1) units of work under `key`. No-op unless a meter is active. Keep call sites at
// per-operation granularity (one call per query/eval/scan, passing the magnitude as `n` when it varies), never
// per-element in a hot inner loop — that keeps probe frequency, and thus the always-present inactive overhead,
// negligible while still capturing algorithmic scaling (a 100× larger scan shows up as a 100× larger `n`).
export function count(key: string, n = 1): void {
    if (active !== null) {
        active.tally[key] = (active.tally[key] ?? 0) + n;
    }
}
