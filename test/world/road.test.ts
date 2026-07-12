import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import { Direction } from 'types/Movement';
import { NeighborMap } from 'types/Neighbor';

describe('Road waypoint computation', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    test('calculateCurb warns and no-ops on missing cellParams/pixelCenter', () => {
        const road = new Road(0, 0, null);
        // @ts-expect-error exercising the defensive guard with invalid input
        road.calculateCurb(null, { x: 1, y: 1 });
        expect(road.getCurb()).toBeNull();
        road.calculateCurb({ width: 48, height: 48 }, null);
        expect(road.getCurb()).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    test('calculateLanes warns and no-ops on missing cellParams/pixelCenter', () => {
        const road = new Road(0, 0, null);
        // @ts-expect-error exercising the defensive guard with invalid input
        road.calculateLanes(null, { x: 1, y: 1 });
        expect(road.getLane()).toBeNull();
        road.calculateLanes({ width: 48, height: 48 }, null);
        expect(road.getLane()).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    describe('getClosestCurbPoint', () => {
        const cellParams = { width: 48, height: 48 };

        test('warns and returns null when there is no curb yet', () => {
            const road = new Road(0, 0, null);
            expect(road.getClosestCurbPoint({ x: 0, y: 0 })).toBeNull();
            expect(warnSpy).toHaveBeenCalled();
        });

        test('warns and returns null for a null currentPosition', () => {
            const road = new Road(0, 0, null);
            road.calculateCurb(cellParams, { x: 100, y: 100 });
            expect(road.getClosestCurbPoint(null)).toBeNull();
            expect(warnSpy).toHaveBeenCalled();
        });

        test('picks each corner based on proximity', () => {
            const road = new Road(5, 5, null);
            road.calculateCurb(cellParams, { x: 100, y: 100 });
            const curb = road.getCurb()!;

            expect(road.getClosestCurbPoint({ x: 81, y: 81 })).toEqual(curb.topLeft);
            expect(road.getClosestCurbPoint({ x: 119, y: 81 })).toEqual(curb.topRight);
            expect(road.getClosestCurbPoint({ x: 81, y: 119 })).toEqual(curb.bottomLeft);
            expect(road.getClosestCurbPoint({ x: 119, y: 119 })).toEqual(curb.bottomRight);
        });
    });

    describe('getLaneEntryPoint', () => {
        const cellParams = { width: 48, height: 48 };

        test('warns and returns null when there is no lane yet', () => {
            const road = new Road(0, 0, null);
            expect(road.getLaneEntryPoint(Direction.North)).toBeNull();
            expect(warnSpy).toHaveBeenCalled();
        });

        test('warns and returns null for a falsy relativeDirection', () => {
            const road = new Road(0, 0, null);
            road.calculateLanes(cellParams, { x: 100, y: 100 });
            expect(road.getLaneEntryPoint(Direction.NULL)).toBeNull();
            expect(warnSpy).toHaveBeenCalled();
        });

        test('maps each cardinal direction to the matching lane entry corner', () => {
            const road = new Road(5, 5, null);
            road.calculateLanes(cellParams, { x: 100, y: 100 });
            const lane = road.getLane()!;

            expect(road.getLaneEntryPoint(Direction.North)).toEqual(lane.bottomRight);
            expect(road.getLaneEntryPoint(Direction.South)).toEqual(lane.topLeft);
            expect(road.getLaneEntryPoint(Direction.East)).toEqual(lane.bottomLeft);
            expect(road.getLaneEntryPoint(Direction.West)).toEqual(lane.topRight);
        });
    });

    describe('updateSelfBasedOnNeighbors (4-bit neighbor code -> sprite)', () => {
        function neighbors(top: boolean, bottom: boolean, left: boolean, right: boolean): NeighborMap {
            const asRoad = (flag: boolean) => (flag ? new Road(0, 0, null) : new Soil(0, 0, 'grass'));
            return { top: asRoad(top), bottom: asRoad(bottom), left: asRoad(left), right: asRoad(right) };
        }

        type NeighborCase = { top: boolean; bottom: boolean; left: boolean; right: boolean; expectedSuffix: string };
        const cases: NeighborCase[] = [
            // No/partial-top-only neighbors collapse to the "endpoint" tile 1100
            { top: false, bottom: false, left: false, right: false, expectedSuffix: '1100' },
            { top: true, bottom: false, left: false, right: false, expectedSuffix: '1100' },
            { top: false, bottom: true, left: false, right: false, expectedSuffix: '1100' },
            // Left/right-only combos collapse to the horizontal-through tile 0011
            { top: false, bottom: false, left: true, right: false, expectedSuffix: '0011' },
            { top: false, bottom: false, left: false, right: true, expectedSuffix: '0011' },
            { top: false, bottom: false, left: true, right: true, expectedSuffix: '0011' },
            // Everything else passes through as-is
            { top: true, bottom: true, left: false, right: false, expectedSuffix: '1100' },
            { top: true, bottom: false, left: true, right: false, expectedSuffix: '1010' },
            { top: true, bottom: false, left: false, right: true, expectedSuffix: '1001' },
            { top: false, bottom: true, left: true, right: false, expectedSuffix: '0110' },
            { top: false, bottom: true, left: false, right: true, expectedSuffix: '0101' },
            { top: true, bottom: true, left: true, right: false, expectedSuffix: '1110' },
            { top: true, bottom: true, left: false, right: true, expectedSuffix: '1101' },
            { top: true, bottom: false, left: true, right: true, expectedSuffix: '1011' },
            { top: false, bottom: true, left: true, right: true, expectedSuffix: '0111' },
            { top: true, bottom: true, left: true, right: true, expectedSuffix: '1111' },
        ];

        test.each(cases)('neighbor code $top$bottom$left$right -> road_$expectedSuffix', ({ top, bottom, left, right, expectedSuffix }) => {
            const road = new Road(1, 1, null);
            road.updateSelfBasedOnNeighbors(neighbors(top, bottom, left, right));
            expect(road.getAssetName()).toBe(`road_${expectedSuffix}`);
        });

        test('missing (null) neighbors count as "not a road"', () => {
            const road = new Road(1, 1, null);
            road.updateSelfBasedOnNeighbors({ top: null, bottom: null, left: null, right: null });
            expect(road.getAssetName()).toBe('road_1100');
        });
    });

    describe('getConnectingRoads', () => {
        test('returns only the neighbors that are Road instances', () => {
            const road = new Road(1, 1, null);
            const north = new Road(0, 1, null);
            const south = new Soil(2, 1, 'grass');

            const connecting = road.getConnectingRoads({ top: north, bottom: south, left: null, right: null });
            expect(connecting).toEqual([north]);
        });

        test('returns an empty array when nothing connects', () => {
            const road = new Road(1, 1, null);
            expect(road.getConnectingRoads({ top: null, bottom: null, left: null, right: null })).toEqual([]);
        });
    });

    test('calculateDepth scales with row only (row * 10)', () => {
        const road = new Road(7, 99, null);
        expect(road.calculateDepth()).toBe(70);
    });
});
