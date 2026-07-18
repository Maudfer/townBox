import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import Field from 'game/world/Field';
import { PixelPosition, TilePosition } from 'types/Position';

// Field.update() drives every tracked person/vehicle each frame. The happy path is already exercised
// indirectly by other suites (spawning.test.ts drives Person.update directly); these tests focus on
// Field's OWN guard logic — the three early-return checks per entity (no pixel position, pixel maps to no
// tile position, tile position resolves to no tile) — which normal Person/Vehicle instances can't
// naturally trigger, so minimal fakes are injected directly into Field's private roster.

function makeGame(rows: number, cols: number, timeScale?: number) {
    const game = {
        // The debug time-throttle (LP-2): present only when a test opts in, so the default-1x fallback
        // path (harness games without the method) stays covered too.
        ...(timeScale !== undefined ? { getTimeScale: () => timeScale } : {}),
        gridParams: {
            rows, cols,
            cells: { width: 16, height: 16 },
            footprint: { tiles: 3, width: 48, height: 48 },
        },
        toolbelt: { soil: 'grass', road: 'road', house: 'house_1x1', work: 'work_1x1', select: '', bulldoze: '' },
        emit: () => {},
        on: () => {},
        tileToPixelPosition: (position: TilePosition) =>
            position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 },
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) return null;
            // Sentinel used to simulate a resolved tile position that falls outside the matrix (Field.getTile
            // then fails its own lookup) without having to fake an inconsistent grid size.
            if (pixel.x === 999999) return { row: 999, col: 999 };
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        setGameManager: () => {},
    } as unknown as GameManager;

    return new Field(game, rows, cols);
}

describe('Field.update', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    test('does nothing with an empty roster', () => {
        const field = makeGame(15, 15);
        expect(() => field.update({ time: 0, timeDelta: 16 })).not.toThrow();
    });

    test('drives a normally-loaded person and vehicle without throwing (no wander, no controlled destination)', () => {
        const field = makeGame(15, 15);
        field.loadPerson(24, 24);
        field.loadVehicle(40, 40);

        expect(() => field.update({ time: 0, timeDelta: 16 })).not.toThrow();
    });

    describe('per-person guards', () => {
        test('skips a person whose position cannot be resolved', () => {
            const field = makeGame(15, 15);
            const updateFn = jest.fn();
            const redrawFn = jest.fn();
            const fakePerson = { getPosition: () => null, update: updateFn, redraw: redrawFn } as unknown as Person;
            (field as unknown as { people: Person[] }).people.push(fakePerson);

            field.update({ time: 0, timeDelta: 16 });

            expect(updateFn).not.toHaveBeenCalled();
            expect(redrawFn).not.toHaveBeenCalled();
        });

        test('skips a person whose pixel position maps to no tile position', () => {
            const field = makeGame(15, 15);
            const updateFn = jest.fn();
            const fakePerson = {
                getPosition: () => ({ x: -5000, y: -5000 }),
                update: updateFn,
                redraw: jest.fn(),
            } as unknown as Person;
            (field as unknown as { people: Person[] }).people.push(fakePerson);

            field.update({ time: 0, timeDelta: 16 });

            expect(updateFn).not.toHaveBeenCalled();
        });

        test('skips a person whose resolved tile position has no tile', () => {
            const field = makeGame(15, 15);
            const updateFn = jest.fn();
            const fakePerson = {
                getPosition: () => ({ x: 999999, y: 0 }),
                update: updateFn,
                redraw: jest.fn(),
            } as unknown as Person;
            (field as unknown as { people: Person[] }).people.push(fakePerson);

            field.update({ time: 0, timeDelta: 16 });

            expect(updateFn).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalled();
        });

        test('updates and redraws a person whose position resolves cleanly', () => {
            const field = makeGame(15, 15);
            const updateFn = jest.fn();
            const redrawFn = jest.fn();
            const fakePerson = {
                getPosition: () => ({ x: 24, y: 24 }),
                update: updateFn,
                redraw: redrawFn,
            } as unknown as Person;
            (field as unknown as { people: Person[] }).people.push(fakePerson);

            field.update({ time: 0, timeDelta: 16 });

            expect(updateFn).toHaveBeenCalledTimes(1);
            expect(redrawFn).toHaveBeenCalledWith(16);
        });
    });

    describe('per-vehicle guards', () => {
        test('skips a vehicle whose position cannot be resolved', () => {
            const field = makeGame(15, 15);
            const driveFn = jest.fn();
            const fakeVehicle = {
                getPosition: () => null,
                drive: driveFn,
                isControlled: () => false,
                updateDestination: jest.fn(),
                redraw: jest.fn(),
            } as unknown as Vehicle;
            (field as unknown as { vehicles: Vehicle[] }).vehicles.push(fakeVehicle);

            field.update({ time: 0, timeDelta: 16 });

            expect(driveFn).not.toHaveBeenCalled();
        });

        test('skips a vehicle whose pixel position maps to no tile position', () => {
            const field = makeGame(15, 15);
            const driveFn = jest.fn();
            const fakeVehicle = {
                getPosition: () => ({ x: -5000, y: -5000 }),
                drive: driveFn,
                isControlled: () => false,
                updateDestination: jest.fn(),
                redraw: jest.fn(),
            } as unknown as Vehicle;
            (field as unknown as { vehicles: Vehicle[] }).vehicles.push(fakeVehicle);

            field.update({ time: 0, timeDelta: 16 });

            expect(driveFn).not.toHaveBeenCalled();
        });

        test('skips a vehicle whose resolved tile position has no tile', () => {
            const field = makeGame(15, 15);
            const driveFn = jest.fn();
            const fakeVehicle = {
                getPosition: () => ({ x: 999999, y: 0 }),
                drive: driveFn,
                isControlled: () => false,
                updateDestination: jest.fn(),
                redraw: jest.fn(),
            } as unknown as Vehicle;
            (field as unknown as { vehicles: Vehicle[] }).vehicles.push(fakeVehicle);

            field.update({ time: 0, timeDelta: 16 });

            expect(driveFn).not.toHaveBeenCalled();
        });

        test('drives, and (only when uncontrolled) updates the destination of a resolvable vehicle', () => {
            const field = makeGame(15, 15);
            const driveFn = jest.fn();
            const updateDestinationFn = jest.fn();
            const redrawFn = jest.fn();
            const fakeVehicle = {
                getPosition: () => ({ x: 24, y: 24 }),
                drive: driveFn,
                isControlled: () => false,
                updateDestination: updateDestinationFn,
                redraw: redrawFn,
            } as unknown as Vehicle;
            (field as unknown as { vehicles: Vehicle[] }).vehicles.push(fakeVehicle);

            field.update({ time: 0, timeDelta: 16 });

            expect(driveFn).toHaveBeenCalledTimes(1);
            expect(updateDestinationFn).toHaveBeenCalledTimes(1);
            expect(redrawFn).toHaveBeenCalledWith(16);
        });

        test('a controlled (commute) vehicle is driven but never picks its own destination', () => {
            const field = makeGame(15, 15);
            const driveFn = jest.fn();
            const updateDestinationFn = jest.fn();
            const fakeVehicle = {
                getPosition: () => ({ x: 24, y: 24 }),
                drive: driveFn,
                isControlled: () => true,
                updateDestination: updateDestinationFn,
                redraw: jest.fn(),
            } as unknown as Vehicle;
            (field as unknown as { vehicles: Vehicle[] }).vehicles.push(fakeVehicle);

            field.update({ time: 0, timeDelta: 16 });

            expect(driveFn).toHaveBeenCalledTimes(1);
            expect(updateDestinationFn).not.toHaveBeenCalled();
        });
    });
});

// LP-2 (proposal simulation-aliveness-2 P0-5): movement runs on SIM time. The debug throttle scales the
// clock by timeScale — movement must scale by the same factor or a 16× session makes every commute consume
// 16× its in-game duration (arrival-gated behavior silently degrades).
describe('Field.update: time-throttle movement scaling (LP-2)', () => {
    function makeThrottledField(scale: number) {
        return makeGame(15, 15, scale);
    }

    test('the frame delta passed to people and vehicles is multiplied by the current timeScale', () => {
        const field = makeThrottledField(4);
        const personUpdate = jest.fn();
        const fakePerson = { getPosition: () => ({ x: 24, y: 24 }), update: personUpdate, redraw: jest.fn() } as unknown as Person;
        (field as unknown as { people: Person[] }).people.push(fakePerson);
        const drive = jest.fn();
        const fakeVehicle = { getPosition: () => ({ x: 40, y: 40 }), drive, redraw: jest.fn(), isControlled: () => true } as unknown as Vehicle;
        (field as unknown as { vehicles: Vehicle[] }).vehicles.push(fakeVehicle);

        field.update({ time: 0, timeDelta: 16 });

        expect(personUpdate).toHaveBeenCalledWith(expect.anything(), 64, expect.anything(), expect.anything());
        expect(drive).toHaveBeenCalledWith(expect.anything(), 64);
    });

    test('a harness game without getTimeScale defaults to 1x (no scaling)', () => {
        const field = makeGame(15, 15);
        const personUpdate = jest.fn();
        const fakePerson = { getPosition: () => ({ x: 24, y: 24 }), update: personUpdate, redraw: jest.fn() } as unknown as Person;
        (field as unknown as { people: Person[] }).people.push(fakePerson);

        field.update({ time: 0, timeDelta: 16 });

        expect(personUpdate).toHaveBeenCalledWith(expect.anything(), 16, expect.anything(), expect.anything());
    });
});
