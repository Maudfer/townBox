import { SeededRandom, hashStringToSeed } from '../src/util/random';

describe('SeededRandom', () => {
    test('is deterministic for a given seed', () => {
        const a = new SeededRandom(42);
        const b = new SeededRandom(42);
        const seqA = Array.from({ length: 10 }, () => a.next());
        const seqB = Array.from({ length: 10 }, () => b.next());
        expect(seqA).toEqual(seqB);
    });

    test('different seeds produce different sequences', () => {
        const a = new SeededRandom(1);
        const b = new SeededRandom(2);
        const seqA = Array.from({ length: 10 }, () => a.next());
        const seqB = Array.from({ length: 10 }, () => b.next());
        expect(seqA).not.toEqual(seqB);
    });

    test('next() stays within [0, 1)', () => {
        const rng = new SeededRandom(123);
        for (let i = 0; i < 1000; i++) {
            const value = rng.next();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    test('nextInt() respects inclusive bounds', () => {
        const rng = new SeededRandom(7);
        for (let i = 0; i < 1000; i++) {
            const value = rng.nextInt(3, 6);
            expect(value).toBeGreaterThanOrEqual(3);
            expect(value).toBeLessThanOrEqual(6);
            expect(Number.isInteger(value)).toBe(true);
        }
    });

    test('nextInt() returns the lower bound for empty/inverted ranges', () => {
        const rng = new SeededRandom(7);
        expect(rng.nextInt(5, 5)).toBe(5);
        expect(rng.nextInt(9, 2)).toBe(9);
    });

    test('chance(0) is never true and chance(1) is always true', () => {
        const rng = new SeededRandom(99);
        for (let i = 0; i < 100; i++) {
            expect(rng.chance(0)).toBe(false);
            expect(rng.chance(1)).toBe(true);
        }
    });

    test('pick() returns an element and throws on empty', () => {
        const rng = new SeededRandom(55);
        const items = ['a', 'b', 'c'];
        expect(items).toContain(rng.pick(items));
        expect(() => rng.pick([])).toThrow();
    });

    test('state can be serialized and restored to reproduce a stream', () => {
        const rng = new SeededRandom(2024);
        rng.next();
        rng.next();
        const saved = rng.getState();
        const expected = Array.from({ length: 5 }, () => rng.next());

        const restored = new SeededRandom(0);
        restored.setState(saved);
        const actual = Array.from({ length: 5 }, () => restored.next());

        expect(actual).toEqual(expected);
    });

    test('fork() is deterministic per salt and independent of the parent stream', () => {
        const parent1 = new SeededRandom(500);
        const parent2 = new SeededRandom(500);
        const forkA = parent1.fork(1);
        const forkB = parent2.fork(1);
        expect(Array.from({ length: 5 }, () => forkA.next())).toEqual(Array.from({ length: 5 }, () => forkB.next()));

        const forkDifferent = new SeededRandom(500).fork(2);
        expect(Array.from({ length: 5 }, () => new SeededRandom(500).fork(1).next()))
            .not.toEqual(Array.from({ length: 5 }, () => forkDifferent.next()));
    });
});

describe('hashStringToSeed', () => {
    test('is stable for the same string and an unsigned 32-bit integer', () => {
        const seed = hashStringToSeed('townbox');
        expect(seed).toBe(hashStringToSeed('townbox'));
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(0x100000000);
        expect(Number.isInteger(seed)).toBe(true);
    });

    test('differs across distinct strings', () => {
        expect(hashStringToSeed('a')).not.toBe(hashStringToSeed('b'));
    });
});
