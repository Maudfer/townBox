import GameManager from 'game/GameManager';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import { BusinessInstance } from 'types/Business';
import { PixelPosition, TilePosition } from 'types/Position';

// Loiter nodes (task 128): the curb in front of a GATHERING venue (park/beach/bar/…) is a preferred
// ambulatory-wander destination. Field.getLoiterAnchors() recomputes this lazily behind a dirty flag,
// scanning the building destinations for gathering blueprints and mapping each to its adjacent road anchor.
//
// NOTE on the manual `destinations.add`: under ts-jest, Field.stampFootprint's `instanceof Building` guard
// sees a different Building class object than the test's import (a circular-import module-duplication
// artifact; production bundling dedupes, so destinations/roadAnchors populate correctly live). loadStructure
// therefore does NOT populate `destinations` here, so we seed the building anchor directly — the recompute
// under test (gathering-blueprint filter + adjacent-road mapping) is exactly the new code, independent of
// that pre-existing quirk. `getTile(...) instanceof Workplace` DOES resolve correctly (loadStructure builds
// the Workplace with Field's own binding), which is what the recompute's own instanceof relies on.

function makeField(rows = 40, cols = 40): Field {
    const game = {
        field: null,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {},
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return field;
}

// Places a road above and a work lot flush below it, assigns the given blueprint, and registers the lot as a
// building destination (see the NOTE above). Returns the Field ready for a loiter recompute.
function fieldWithVenue(blueprintKey: string): Field {
    const field = makeField();
    field.loadStructure('road', 1, 4, 'r');                            // rows 0-2, cols 3-5
    const venue = field.loadStructure('work', 4, 4, 'v') as Workplace; // rows 3-5, cols 3-5 — flush below
    venue.setBusiness({ blueprintKey, positions: [] } as unknown as BusinessInstance);
    (field as unknown as { destinations: Set<string> }).destinations.add('4-4');
    field.markLoiterDirty();
    return field;
}

describe('Field loiter anchors (task 128)', () => {
    test('a gathering venue registers the curb in front of it as a loiter node', () => {
        const loiter = fieldWithVenue('park').getLoiterAnchors();
        // The road's anchor key ("1-4") is the loiter node — the curb the wander prefers.
        expect(loiter.has('1-4')).toBe(true);
        expect(loiter.size).toBe(1);
    });

    test('a bar and a beach are gathering venues too', () => {
        expect(fieldWithVenue('bar').getLoiterAnchors().has('1-4')).toBe(true);
        expect(fieldWithVenue('beach').getLoiterAnchors().has('1-4')).toBe(true);
    });

    test('a non-gathering business (a shop) contributes no loiter node', () => {
        expect(fieldWithVenue('supermarket').getLoiterAnchors().size).toBe(0);
    });

    test('a workplace with no business yet yields no loiter node (stamp precedes assignment)', () => {
        const field = makeField();
        field.loadStructure('road', 1, 4, 'r');
        field.loadStructure('work', 4, 4, 'w'); // business not set
        (field as unknown as { destinations: Set<string> }).destinations.add('4-4');
        expect(field.getLoiterAnchors().size).toBe(0);
    });

    test('markLoiterDirty forces a recompute that picks up a newly-assigned gathering business', () => {
        const field = makeField();
        field.loadStructure('road', 1, 4, 'r');
        const venue = field.loadStructure('work', 4, 4, 'v') as Workplace;
        (field as unknown as { destinations: Set<string> }).destinations.add('4-4');

        // First read: no business → empty, and the result is cached (dirty cleared).
        expect(field.getLoiterAnchors().size).toBe(0);

        // The business is assigned AFTER the first read; without an invalidation the cache stays empty.
        venue.setBusiness({ blueprintKey: 'cafe', positions: [] } as unknown as BusinessInstance);
        expect(field.getLoiterAnchors().size).toBe(0); // still cached-stale until invalidated

        field.markLoiterDirty();
        expect(field.getLoiterAnchors().has('1-4')).toBe(true);
    });
});
