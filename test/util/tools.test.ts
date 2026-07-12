import { Direction } from 'types/Movement';
import { directionToRadianRotation } from 'util/tools';

describe('directionToRadianRotation', () => {
    test('maps each cardinal direction to its expected rotation', () => {
        expect(directionToRadianRotation(Direction.East)).toBeCloseTo(0);
        expect(directionToRadianRotation(Direction.North)).toBeCloseTo(-Math.PI / 2);
        expect(directionToRadianRotation(Direction.South)).toBeCloseTo(Math.PI / 2);
        expect(directionToRadianRotation(Direction.West)).toBeCloseTo(Math.PI);
    });

    test('throws on Direction.NULL', () => {
        expect(() => directionToRadianRotation(Direction.NULL)).toThrow('[Tools] Invalid direction: 0');
    });
});
