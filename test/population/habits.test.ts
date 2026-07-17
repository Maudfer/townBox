import Habits, { HABITS_CONFIG } from 'game/population/Habits';

// The habits ledger (task 095 / proposal G3): per-vice counters with closed-form cooling — practice bumps,
// abstinence cools, the level multiplies the vice's own selection weight (escalation). Deterministic and
// RNG-free; reads never mutate (the K2 stride rule).

const DAY = 24;

describe('the counter', () => {
    test('unknown people and unpracticed habits read zero; practice bumps by the configured amount', () => {
        const habits = new Habits();
        expect(habits.levelOf('a', 'drinking', 0)).toBe(0);
        habits.practice('a', 'drinking', 0);
        expect(habits.levelOf('a', 'drinking', 0)).toBe(HABITS_CONFIG.practiceBump);
        // Habits are independent per key and per person.
        expect(habits.levelOf('a', 'gambling', 0)).toBe(0);
        expect(habits.levelOf('b', 'drinking', 0)).toBe(0);
    });

    test('cooling is closed-form: exactly half after one half-life, and reads never mutate (K2)', () => {
        const habits = new Habits();
        habits.practice('a', 'drinking', 0);
        const halfLifeTicks = HABITS_CONFIG.halfLifeDays * DAY;
        // Read at an intermediate tick first — a stride-tolerant store must not care.
        const early = habits.levelOf('a', 'drinking', Math.floor(halfLifeTicks / 2));
        expect(early).toBeGreaterThan(HABITS_CONFIG.practiceBump / 2);
        expect(habits.levelOf('a', 'drinking', halfLifeTicks)).toBeCloseTo(HABITS_CONFIG.practiceBump / 2, 10);
        // Same answer regardless of how many reads happened in between.
        const fresh = new Habits();
        fresh.practice('a', 'drinking', 0);
        expect(fresh.levelOf('a', 'drinking', halfLifeTicks)).toBeCloseTo(habits.levelOf('a', 'drinking', halfLifeTicks), 12);
    });

    test('practice materializes-then-bumps (cooled base, not the raw stored level) and caps at maxLevel', () => {
        const habits = new Habits();
        habits.practice('a', 'drinking', 0);
        // A day later the level cooled a little; the next practice adds on top of the COOLED value.
        habits.practice('a', 'drinking', DAY);
        const cooledFirst = HABITS_CONFIG.practiceBump * Math.pow(0.5, DAY / (HABITS_CONFIG.halfLifeDays * DAY));
        expect(habits.levelOf('a', 'drinking', DAY)).toBeCloseTo(cooledFirst + HABITS_CONFIG.practiceBump, 10);
        // Hammering the habit saturates at the cap, never beyond.
        for (let i = 0; i < 50; i++) {
            habits.practice('a', 'drinking', DAY);
        }
        expect(habits.levelOf('a', 'drinking', DAY)).toBe(HABITS_CONFIG.maxLevel);
    });
});

describe('the escalation multiplier', () => {
    test('no habit key or no practice → 1; a practiced habit multiplies up by escalationPerLevel', () => {
        const habits = new Habits();
        expect(habits.selectionMultiplier('a', undefined, 0)).toBe(1);
        expect(habits.selectionMultiplier('a', 'drinking', 0)).toBe(1);
        habits.practice('a', 'drinking', 0);
        expect(habits.selectionMultiplier('a', 'drinking', 0)).toBeCloseTo(1 + HABITS_CONFIG.practiceBump * HABITS_CONFIG.escalationPerLevel, 10);
        // The multiplier cools with the habit — abstinence genuinely de-escalates.
        const later = habits.selectionMultiplier('a', 'drinking', HABITS_CONFIG.halfLifeDays * DAY * 4);
        expect(later).toBeGreaterThan(1);
        expect(later).toBeLessThan(1.1);
    });
});

describe('lifecycle & persistence', () => {
    test('serialize/loadState round-trips deep copies; removePerson forgets', () => {
        const habits = new Habits();
        habits.practice('a', 'drinking', 5);
        habits.practice('a', 'gambling', 7);
        habits.practice('b', 'drinking', 9);

        const snapshot = habits.serialize();
        const restored = new Habits();
        restored.loadState(snapshot);
        expect(restored.levelOf('a', 'gambling', 7)).toBe(habits.levelOf('a', 'gambling', 7));
        // Deep copy: mutating the restored store never leaks back into the snapshot or the source.
        restored.practice('a', 'drinking', 5);
        expect(habits.levelOf('a', 'drinking', 5)).toBe(HABITS_CONFIG.practiceBump);
        expect(snapshot.people['a']!['drinking']!.level).toBe(HABITS_CONFIG.practiceBump);

        habits.removePerson('a');
        expect(habits.levelOf('a', 'drinking', 5)).toBe(0);
        expect(habits.levelOf('b', 'drinking', 9)).toBe(HABITS_CONFIG.practiceBump);
        // loadState(undefined) resets clean (older saves have no habits section).
        restored.loadState(undefined);
        expect(restored.levelOf('b', 'drinking', 9)).toBe(0);
    });
});
