// Deterministic, seedable pseudo-random number generator (mulberry32). The household-generation system
// must be reproducible from a single per-save seed, so every random decision flows through an explicit
// SeededRandom instance rather than Math.random()/Phaser.Math.RND. The internal state is a single 32-bit
// integer, so a generator can be serialized/restored by storing its state (used for the placement-draw
// stream that must survive save/load).

const UINT32 = 0x100000000; // 2^32

export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        // Coerce to an unsigned 32-bit integer so construction from any number is stable.
        this.state = seed >>> 0;
    }

    // Returns the next float in [0, 1). mulberry32.
    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / UINT32;
    }

    // Integer in [minInclusive, maxInclusive]. Returns minInclusive if the range is empty/inverted.
    nextInt(minInclusive: number, maxInclusive: number): number {
        if (maxInclusive <= minInclusive) {
            return minInclusive;
        }
        const span = maxInclusive - minInclusive + 1;
        return minInclusive + Math.floor(this.next() * span);
    }

    // True with the given probability (clamped to [0, 1]).
    chance(probability: number): boolean {
        return this.next() < probability;
    }

    // Uniformly picks one item. Throws on an empty list so callers don't silently get undefined.
    pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
            throw new Error('[SeededRandom] Cannot pick from an empty list');
        }
        return items[this.nextInt(0, items.length - 1)]!;
    }

    // Derives an independent generator from this one's current state plus a salt. Useful for giving each
    // subsystem (pool generation vs. placement draws) its own stream without them interfering.
    fork(salt: number): SeededRandom {
        return new SeededRandom((Math.imul(this.state ^ (salt >>> 0), 0x9e3779b1) >>> 0));
    }

    getState(): number {
        return this.state;
    }

    setState(state: number): void {
        this.state = state >>> 0;
    }
}

// Hashes a string into a 32-bit seed (FNV-1a). Lets seeds be derived from stable keys (e.g. a save name).
export function hashStringToSeed(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
