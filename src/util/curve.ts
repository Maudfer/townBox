// Declarative scalar curves: a value that scales with a single numeric input. This is the shared math of
// the procedural simulation framework (docs/tasks/013-procedural-simulation-framework_DONE.md) — Engine A uses
// curves for size-driven quantities (how many clerks a supermarket of size N needs), and Engine B uses the
// exact same type for probability gradients (how likely pregnancy is at age N). Pure and deterministic:
// evaluateCurve is a total function of (curve, x), so manifests are fully unit-testable without a scene.

export type Curve =
    | { mode: 'const'; value: number }
    | { mode: 'linear'; base: number; perUnit: number; min?: number; max?: number }
    | { mode: 'sqrt'; base: number; coeff: number; min?: number; max?: number }
    | { mode: 'log'; base: number; coeff: number; min?: number; max?: number }
    | { mode: 'logistic'; floor: number; ceiling: number; midpoint: number; steepness: number }
    | { mode: 'step'; points: CurvePoint[] };

export interface CurvePoint {
    at: number;
    value: number;
}

// Clamp a value into [min, max], ignoring bounds left undefined.
function applyBounds(value: number, min?: number, max?: number): number {
    let result = value;
    if (min !== undefined && result < min) {
        result = min;
    }
    if (max !== undefined && result > max) {
        result = max;
    }
    return result;
}

// Clamp to [0, 1]. Use when a curve result is consumed as a probability (Engine B factors).
export function clamp01(value: number): number {
    if (value < 0) {
        return 0;
    }
    if (value > 1) {
        return 1;
    }
    return value;
}

// Evaluate a curve at input x. Conventions:
//  - linear: base + perUnit*x, clamped to [min, max] when provided.
//  - sqrt:   base + coeff*sqrt(max(0, x)), clamped (negative x is treated as 0).
//  - log:    base + coeff*ln(max(1, x)), clamped (x <= 1 contributes nothing, so the curve starts at base).
//  - logistic: a sigmoid from floor to ceiling, centred at midpoint with the given steepness.
//  - step:   the value of the last point whose `at` <= x (sorted by `at`); below the first threshold the
//            first point's value is held; an empty point list yields 0.
export function evaluateCurve(curve: Curve, x: number): number {
    switch (curve.mode) {
        case 'const':
            return curve.value;
        case 'linear':
            return applyBounds(curve.base + curve.perUnit * x, curve.min, curve.max);
        case 'sqrt':
            return applyBounds(curve.base + curve.coeff * Math.sqrt(Math.max(0, x)), curve.min, curve.max);
        case 'log':
            return applyBounds(curve.base + curve.coeff * Math.log(Math.max(1, x)), curve.min, curve.max);
        case 'logistic': {
            const span = curve.ceiling - curve.floor;
            return curve.floor + span / (1 + Math.exp(-curve.steepness * (x - curve.midpoint)));
        }
        case 'step':
            return evaluateStep(curve.points, x);
    }
}

function evaluateStep(points: CurvePoint[], x: number): number {
    if (points.length === 0) {
        return 0;
    }
    const sorted = [...points].sort((a, b) => a.at - b.at);
    let result = sorted[0]!.value; // held below the first threshold
    for (const point of sorted) {
        if (x >= point.at) {
            result = point.value;
        } else {
            break;
        }
    }
    return result;
}
