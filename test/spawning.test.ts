import Person from '../src/app/game/Person';
import Road from '../src/app/game/Road';
import PathFinder from '../src/app/game/PathFinder';

// Person.updateDestination uses the global Phaser.Math.RND; stub it so the wander path is exercisable in node.
beforeAll(() => {
    (global as unknown as { Phaser: unknown }).Phaser = { Math: { RND: { pick: (items: unknown[]) => items[0] } } };
});

describe('retire random wandering (task 016)', () => {
    const road = new Road(0, 0, 'road');
    const pathFinder = { findPath: () => [road] } as unknown as PathFinder;

    test('a resident (wander off) does not pick a random destination when idle', () => {
        const person = new Person(0, 0);
        person.update(road, 0, new Set(['5-5']), pathFinder);
        expect((person as unknown as { currentDestination: unknown }).currentDestination).toBeNull();
    });

    test('a debug person with wander enabled does pick a random destination', () => {
        const person = new Person(0, 0);
        person.enableWander();
        person.update(road, 0, new Set(['5-5']), pathFinder);
        expect((person as unknown as { currentDestination: unknown }).currentDestination).toEqual({ row: 5, col: 5 });
    });
});
