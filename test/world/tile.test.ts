import Tile from 'game/world/Tile';
import { Direction } from 'types/Movement';

describe('Tile (base class)', () => {
    test('calculateDepth() on the base class throws — subclasses must override it', () => {
        const tile = new Tile(0, 0, null);
        expect(() => tile.calculateDepth()).toThrow(/should always be overridden/);
    });

    test('getRow/getCol/getPosition/getIdentifier reflect the anchor cell', () => {
        const tile = new Tile(3, 7, 'sprite');
        expect(tile.getRow()).toBe(3);
        expect(tile.getCol()).toBe(7);
        expect(tile.getPosition()).toEqual({ row: 3, col: 7 });
        expect(tile.getIdentifier()).toBe('3-7');
    });

    describe('getRelativeDirection', () => {
        test('same row, other tile to the east', () => {
            const a = new Tile(5, 5, null);
            const b = new Tile(5, 8, null);
            expect(a.getRelativeDirection(b)).toBe(Direction.East);
        });

        test('same row, other tile to the west', () => {
            const a = new Tile(5, 8, null);
            const b = new Tile(5, 5, null);
            expect(a.getRelativeDirection(b)).toBe(Direction.West);
        });

        test('other tile on a lower row (south)', () => {
            const a = new Tile(5, 5, null);
            const b = new Tile(8, 5, null);
            expect(a.getRelativeDirection(b)).toBe(Direction.South);
        });

        test('other tile on a higher row (north)', () => {
            const a = new Tile(8, 5, null);
            const b = new Tile(5, 5, null);
            expect(a.getRelativeDirection(b)).toBe(Direction.North);
        });
    });

    test('asset name get/set', () => {
        const tile = new Tile(0, 0, 'initial');
        expect(tile.getAssetName()).toBe('initial');
        tile.setAssetName('updated');
        expect(tile.getAssetName()).toBe('updated');
    });

    test('asset get/set', () => {
        const tile = new Tile(0, 0, null);
        expect(tile.getAsset()).toBeNull();
        const fakeAsset = { destroy: jest.fn() } as unknown as ReturnType<Tile['getAsset']>;
        tile.setAsset(fakeAsset);
        expect(tile.getAsset()).toBe(fakeAsset);
    });

    test('debug text get/set', () => {
        const tile = new Tile(0, 0, null);
        expect(tile.getDebugText()).toBeUndefined();
        const fakeText = { destroy: jest.fn() } as unknown as Phaser.GameObjects.Text;
        tile.setDebugText(fakeText);
        expect(tile.getDebugText()).toBe(fakeText);
    });

    test('updateSelfBasedOnNeighbors is a no-op on the base class', () => {
        const tile = new Tile(0, 0, 'grass');
        expect(() => tile.updateSelfBasedOnNeighbors({ top: null, bottom: null, left: null, right: null })).not.toThrow();
        expect(tile.getAssetName()).toBe('grass');
    });

    test('getFootprintCells centers the footprint on the anchor', () => {
        const tile = new Tile(4, 4, null);
        const cells = tile.getFootprintCells(3);
        expect(cells).toHaveLength(9);
        expect(cells[0]).toEqual({ row: 3, col: 3 });
        expect(cells[8]).toEqual({ row: 5, col: 5 });
    });
});
