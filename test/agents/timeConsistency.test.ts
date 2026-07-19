import Clock from 'game/Clock';
import GameManager from 'game/GameManager';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import { PixelPosition, TilePosition } from 'types/Position';
import { effectiveFrameDelta } from 'util/time';

// The distortion-free time contract (W10 / proposal simulation-aliveness-3): the clock and the movement
// layer consume the SAME capped-and-scaled frame delta, so — for equal SIM time — any speed schedule
// produces the same world: same ticks elapsed, same walked positions. A framerate hitch stalls both
// together (the cap), and pause (scale 0) freezes both. This is the generalized LP-2 assertion.

function makeWorld(scaleRef: { scale: number }): { field: Field; clock: Clock } {
    const rows = 40;
    const cols = 40;
    const clock = new Clock();
    const game = {
        clock,
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
        // The one authority, exactly as GameManager implements it.
        effectiveTimeDelta: (raw: number) => effectiveFrameDelta(raw, scaleRef.scale),
        getTimeScale: () => scaleRef.scale,
        emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return { field, clock };
}

// Runs a frame schedule: `frames` update events of `deltaMs` each at the given scale, advancing the clock
// through the same transform GameManager.advanceTime uses.
function run(scaleRef: { scale: number }, field: Field, clock: Clock, frames: number, deltaMs: number): void {
    for (let frame = 0; frame < frames; frame++) {
        clock.advance(effectiveFrameDelta(deltaMs, scaleRef.scale));
        field.update({ time: frame * deltaMs, timeDelta: deltaMs });
    }
}

function walker(field: Field): { x: () => number; y: () => number } {
    // A straight road with a person walking to a building at its end.
    for (let col = 1; col <= 37; col += 3) {
        field.loadStructure('road', 1, col, 'r');
    }
    const home = field.loadStructure('house', 4, 4, 'h') as House;
    const work = field.loadStructure('work', 4, 34, 'w') as Workplace;
    const person = field.loadPerson(72, 72);
    person.social.setPersonId('p1');
    person.social.setHome(home);
    person.social.setAge(10); // walks (no car) — pure pedestrian movement under test
    person.setCurrentBuilding(home);
    person.setIndoors(true);
    person.setDestination(work);
    return { x: () => person.getPosition()!.x, y: () => person.getPosition()!.y };
}

describe('W10: the distortion-free time contract', () => {
    test('equal SIM time at 1×, 4×, and 8× lands the walker at the SAME position with the SAME clock', () => {
        const results: { x: number; y: number; ticks: number }[] = [];
        for (const [scale, frames] of [[1, 800], [4, 200], [8, 100]] as const) {
            const scaleRef = { scale };
            const { field, clock } = makeWorld(scaleRef);
            const position = walker(field);
            run(scaleRef, field, clock, frames, 16); // frames × 16ms × scale = 12,800 sim-ms every time
            results.push({ x: position.x(), y: position.y(), ticks: clock.getCurrentTick() });
        }
        expect(results[1]).toEqual(results[0]);
        expect(results[2]).toEqual(results[0]);
    });

    test('a framerate hitch stalls the world together: one 5s frame advances clock AND walker by the cap only', () => {
        const scaleRef = { scale: 1 };
        const { field, clock } = makeWorld(scaleRef);
        const position = walker(field);
        // Reference: a clean 100ms of movement.
        run(scaleRef, field, clock, 1, 100);
        const cleanX = position.x();
        const cleanClock = clock.getElapsedMs();

        // A fresh world takes the same journey through one monstrous 5000ms frame: capped to the same 100ms.
        const scaleRef2 = { scale: 1 };
        const { field: field2, clock: clock2 } = makeWorld(scaleRef2);
        const position2 = walker(field2);
        run(scaleRef2, field2, clock2, 1, 5000);
        expect(position2.x()).toBe(cleanX);
        expect(clock2.getElapsedMs()).toBe(cleanClock);
    });

    test('pause freezes everything coherently: scale 0 moves nothing and advances nothing', () => {
        const scaleRef = { scale: 0 };
        const { field, clock } = makeWorld(scaleRef);
        const position = walker(field);
        const startX = position.x();
        run(scaleRef, field, clock, 50, 16);
        expect(position.x()).toBe(startX);
        expect(clock.getCurrentTick()).toBe(0);
        expect(clock.getElapsedMs()).toBe(0);
    });
});
