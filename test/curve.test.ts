import { Curve, evaluateCurve, clamp01 } from '../src/util/curve';

describe('evaluateCurve', () => {
    test('const returns its value regardless of x', () => {
        const curve: Curve = { mode: 'const', value: 7 };
        expect(evaluateCurve(curve, 0)).toBe(7);
        expect(evaluateCurve(curve, 100)).toBe(7);
    });

    test('linear is base + perUnit*x and respects bounds', () => {
        const curve: Curve = { mode: 'linear', base: 1, perUnit: 1.2, max: 18 };
        expect(evaluateCurve(curve, 0)).toBeCloseTo(1);
        expect(evaluateCurve(curve, 5)).toBeCloseTo(7);
        expect(evaluateCurve(curve, 100)).toBe(18); // clamped to max
    });

    test('linear honours min', () => {
        const curve: Curve = { mode: 'linear', base: 0, perUnit: 1, min: 2 };
        expect(evaluateCurve(curve, -5)).toBe(2);
        expect(evaluateCurve(curve, 10)).toBe(10);
    });

    test('sqrt grows slowly and treats negative x as zero', () => {
        const curve: Curve = { mode: 'sqrt', base: 1, coeff: 0.9, max: 4 };
        expect(evaluateCurve(curve, 0)).toBeCloseTo(1);
        expect(evaluateCurve(curve, 4)).toBeCloseTo(1 + 0.9 * 2);
        expect(evaluateCurve(curve, -10)).toBeCloseTo(1); // negative clamped to 0 under the root
        expect(evaluateCurve(curve, 10_000)).toBe(4); // clamped to max
    });

    test('log contributes nothing for x <= 1 then rises', () => {
        const curve: Curve = { mode: 'log', base: 2, coeff: 1 };
        expect(evaluateCurve(curve, 0)).toBeCloseTo(2);
        expect(evaluateCurve(curve, 1)).toBeCloseTo(2);
        expect(evaluateCurve(curve, Math.E)).toBeCloseTo(3);
    });

    test('logistic spans floor..ceiling and sits at the midpoint between them', () => {
        const curve: Curve = { mode: 'logistic', floor: 1, ceiling: 25, midpoint: 5, steepness: 0.6 };
        expect(evaluateCurve(curve, 5)).toBeCloseTo(13); // (1 + 25) / 2
        expect(evaluateCurve(curve, -1000)).toBeCloseTo(1, 3);
        expect(evaluateCurve(curve, 1000)).toBeCloseTo(25, 3);
    });

    test('step holds the last crossed value and the first value below the first threshold', () => {
        const curve: Curve = {
            mode: 'step',
            points: [{ at: 16, value: 0.4 }, { at: 24, value: 1.0 }, { at: 35, value: 0.5 }, { at: 45, value: 0.05 }],
        };
        expect(evaluateCurve(curve, 10)).toBe(0.4); // below first threshold -> first value
        expect(evaluateCurve(curve, 16)).toBe(0.4);
        expect(evaluateCurve(curve, 30)).toBe(1.0);
        expect(evaluateCurve(curve, 40)).toBe(0.5);
        expect(evaluateCurve(curve, 99)).toBe(0.05);
    });

    test('step tolerates unsorted points and an empty list', () => {
        const unsorted: Curve = { mode: 'step', points: [{ at: 24, value: 1 }, { at: 16, value: 0.4 }] };
        expect(evaluateCurve(unsorted, 20)).toBe(0.4);
        expect(evaluateCurve({ mode: 'step', points: [] }, 5)).toBe(0);
    });

    test('the supermarket example: clerks scale faster with a higher ceiling than janitors', () => {
        const clerks: Curve = { mode: 'logistic', floor: 1, ceiling: 24, midpoint: 5, steepness: 0.6 };
        const janitors: Curve = { mode: 'sqrt', base: 1, coeff: 0.9, max: 4 };
        expect(evaluateCurve(clerks, 10)).toBeGreaterThan(evaluateCurve(janitors, 10));
        expect(evaluateCurve(clerks, 10)).toBeGreaterThan(evaluateCurve(clerks, 2));
    });
});

describe('clamp01', () => {
    test('clamps into [0, 1]', () => {
        expect(clamp01(-0.5)).toBe(0);
        expect(clamp01(0.3)).toBe(0.3);
        expect(clamp01(2)).toBe(1);
    });
});
