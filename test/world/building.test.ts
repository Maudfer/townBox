import Building from 'game/world/Building';

describe('Building', () => {
    test('calculateDepth is (row + 1) * 10', () => {
        const building = new Building(9, 0, null);
        expect(building.calculateDepth()).toBe(100);
    });

    test('objectsGenerated flag defaults to false and is settable (task 070)', () => {
        const building = new Building(0, 0, null);
        expect(building.isObjectsGenerated()).toBe(false);
        building.setObjectsGenerated(true);
        expect(building.isObjectsGenerated()).toBe(true);
        building.setObjectsGenerated(false);
        expect(building.isObjectsGenerated()).toBe(false);
    });

    test('entrance defaults to null until calculated', () => {
        const building = new Building(0, 0, null);
        expect(building.getEntrance()).toBeNull();
    });

    test('calculateEntrance warns and no-ops on missing cellParams/pixelCenter', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const building = new Building(0, 0, null);

        // @ts-expect-error exercising the defensive guard with invalid input
        building.calculateEntrance(null, { x: 1, y: 1 });
        expect(building.getEntrance()).toBeNull();

        building.calculateEntrance({ width: 48, height: 48 }, null);
        expect(building.getEntrance()).toBeNull();

        expect(warnSpy).toHaveBeenCalledTimes(2);
        warnSpy.mockRestore();
    });
});
