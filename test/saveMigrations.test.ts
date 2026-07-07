import { migrateSnapshot } from '../src/app/game/save/migrations';
import { WorldSnapshot } from '../src/types/Save';
import { TICKS_PER_YEAR, DAYS_PER_YEAR } from '../src/util/time';

// v7 → v8 (task 040): day ticks become hour ticks; every persisted tick scales by 24 so derived ages and
// event recency read identically under the new TICKS_PER_YEAR.
describe('save migrations', () => {
    function v7Snapshot(): WorldSnapshot {
        return {
            version: 7,
            city: { name: 'Testville', population: 1 },
            structures: [],
            people: [
                {
                    id: 'u1', x: 0, y: 0, direction: 'down', indoors: false, personId: 'p1',
                    firstName: 'Ana', familyName: 'Silva', age: 30, birthTick: -30 * DAYS_PER_YEAR,
                    gender: 'female', homeId: null, relationships: {}, job: null, skills: [], vehicleId: null,
                } as unknown as WorldSnapshot['people'][number],
            ],
            vehicles: [],
            households: [],
            homelessHouseholds: [],
            population: {
                worldSeed: 1,
                drawSeed: 1,
                placedIds: [],
                nextSeq: 2,
                lastSimulatedYear: 0,
                people: {
                    p1: {
                        id: 'p1', firstName: 'Ana', familyName: 'Silva', gender: 'female',
                        birthTick: -30 * DAYS_PER_YEAR, deathTick: null, fatherId: null, motherId: null,
                        partnerships: [{ partnerId: 'p2', startTick: -5 * DAYS_PER_YEAR, endTick: null }],
                    },
                    p2: {
                        id: 'p2', firstName: 'Rui', familyName: 'Costa', gender: 'male',
                        birthTick: -32 * DAYS_PER_YEAR, deathTick: -1 * DAYS_PER_YEAR, fatherId: null, motherId: null,
                        partnerships: [{ partnerId: 'p1', startTick: -5 * DAYS_PER_YEAR, endTick: -1 * DAYS_PER_YEAR }],
                    },
                },
            },
            clock: { elapsedMs: 123456 },
            eventHistory: { p1: { fell_ill: { count: 2, lastTick: -10 } } },
        } as unknown as WorldSnapshot;
    }

    test('v7 day ticks are scaled to hour ticks and derived ages are preserved', () => {
        const snapshot = migrateSnapshot(v7Snapshot());
        expect(snapshot.version).toBe(8);

        const p1 = snapshot.population!.people['p1']!;
        const p2 = snapshot.population!.people['p2']!;
        expect(p1.birthTick).toBe(-30 * DAYS_PER_YEAR * 24);
        expect(p2.deathTick).toBe(-1 * DAYS_PER_YEAR * 24);
        expect(p1.partnerships[0]!.startTick).toBe(-5 * DAYS_PER_YEAR * 24);
        expect(p2.partnerships[0]!.endTick).toBe(-1 * DAYS_PER_YEAR * 24);

        // The load-bearing property: age at tick 0 under hour ticks equals the old age under day ticks.
        expect(Math.floor((0 - p1.birthTick) / TICKS_PER_YEAR)).toBe(30);

        expect(snapshot.people[0]!.birthTick).toBe(-30 * DAYS_PER_YEAR * 24);
        expect(snapshot.eventHistory!['p1']!['fell_ill']!.lastTick).toBe(-240);
        // Aggregate counts and non-tick fields are untouched.
        expect(snapshot.eventHistory!['p1']!['fell_ill']!.count).toBe(2);
        expect(snapshot.clock!.elapsedMs).toBe(123456);
    });

    test('v8 snapshots pass through unchanged', () => {
        const snapshot = v7Snapshot();
        snapshot.version = 8;
        const birth = snapshot.population!.people['p1']!.birthTick;
        migrateSnapshot(snapshot);
        expect(snapshot.population!.people['p1']!.birthTick).toBe(birth);
    });
});
