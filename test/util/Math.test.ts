import { degreesToRadians, radiansToDegrees } from 'util/Math';

describe('degreesToRadians / radiansToDegrees', () => {
    test('converts common angles', () => {
        expect(degreesToRadians(0)).toBe(0);
        expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
        expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
        expect(degreesToRadians(-90)).toBeCloseTo(-Math.PI / 2);
        expect(degreesToRadians(360)).toBeCloseTo(2 * Math.PI);
    });

    test('is the inverse of radiansToDegrees', () => {
        for (const degrees of [0, 45, 90, 135, 180, -90, 270]) {
            expect(radiansToDegrees(degreesToRadians(degrees))).toBeCloseTo(degrees);
        }
    });

    test('radiansToDegrees converts common angles', () => {
        expect(radiansToDegrees(0)).toBe(0);
        expect(radiansToDegrees(Math.PI)).toBeCloseTo(180);
        expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90);
    });
});
