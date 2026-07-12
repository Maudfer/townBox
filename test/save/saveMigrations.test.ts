import { migrateSnapshot } from 'game/save/migrations';
import { EventLogEntry } from 'types/LifeEvent';
import { SAVE_VERSION, WorldSnapshot } from 'types/Save';
import { TICKS_PER_YEAR, DAYS_PER_YEAR } from 'util/time';

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
        expect(snapshot.version).toBe(SAVE_VERSION);

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

    test('v7 aggregates synthesize a minimal, deterministic event log', () => {
        const snapshot = migrateSnapshot(v7Snapshot());
        const log = snapshot.eventLog!;
        expect(log['p1']).toHaveLength(1);
        expect(log['p1']![0]).toMatchObject({
            seq: 0,
            tick: -240, // lastTick scaled to hour ticks first
            kind: 'event',
            defId: 'fell_ill',
            triggerSource: 'system',
            causationId: null,
        });
        expect((log['p1']![0] as EventLogEntry).roles).toEqual({ subject: 'p1' });
        expect(snapshot.eventLogSeq).toBe(1);
    });

    test('v8 snapshots pass through unchanged', () => {
        const snapshot = v7Snapshot();
        snapshot.version = 8;
        const birth = snapshot.population!.people['p1']!.birthTick;
        migrateSnapshot(snapshot);
        expect(snapshot.population!.people['p1']!.birthTick).toBe(birth);
    });

    // v7 → v8: synthesizeEventLog is a no-op when there's nothing to synthesize FROM (no eventHistory at
    // all) — the older aggregate-history-only saves this synthesis targets always carry SOME history table
    // (even if empty {}), so a totally absent one means there's genuinely no log to build.
    test('synthesizeEventLog is a no-op when the snapshot carries no eventHistory at all', () => {
        const snapshot = v7Snapshot();
        delete snapshot.eventHistory;
        migrateSnapshot(snapshot);
        expect(snapshot.eventLog).toBeUndefined();
        expect(snapshot.eventLogSeq).toBeUndefined();
    });

    // v12 → v13 (bounded fertility): backfillMaxChildren is a no-op on a snapshot with no genealogy pool at
    // all (e.g. a v1-era save that never picked up a population section) — nothing to backfill onto.
    test('backfillMaxChildren is a no-op when the snapshot carries no population pool', () => {
        const snapshot = v7Snapshot();
        snapshot.version = 12;
        delete snapshot.population;
        expect(() => migrateSnapshot(snapshot)).not.toThrow();
        expect(snapshot.version).toBe(SAVE_VERSION);
        expect(snapshot.population).toBeUndefined();
    });

    // v10 → v11 (task 064): an existing employee whose job has no rankId yet is defaulted to their job's
    // entry rank, with zeroed work-day counters — this is the branch where a real jobs.json match is found.
    test('defaultJobRanks assigns the entry rank + zeroed counters to a matched, rank-less job', () => {
        const snapshot = v7Snapshot();
        snapshot.version = 10;
        snapshot.people[0]!.job = {
            title: 'Checkout Clerk', salary: 1300, requirements: [], shiftStart: 540, shiftEnd: 1020,
        };

        migrateSnapshot(snapshot);

        expect(snapshot.version).toBe(SAVE_VERSION);
        const job = snapshot.people[0]!.job!;
        expect(job.rankId).toBe('entry');
        expect(job.workDaysInRank).toBe(0);
        expect(job.totalWorkDays).toBe(0);
    });
});
