// Task 077 — the offline logical-economy world. Unit-tests the deterministic building blocks (homes, the
// WorldAdapter surface, direct school accrual, carried-inventory filtering) plus one end-to-end integration
// run proving the generator carries lived skills/careers/possessions into the asset.

import LogicalWorld from 'game/history/LogicalWorld';
import SkillBook from 'game/skills/SkillBook';
import EventEngine from 'game/events/EventEngine';
import { generateHistoryAsset, DEFAULT_GENERATOR_PARAMS, HistoryGeneratorParams, HistoryAsset, HistoryAssetSink, ShardRef } from 'game/history/HistoryAsset';
import { sliceAndRebase, selectStartingWorld, selectStartingWorldFromShards, AssetHeader } from 'game/history/HistoryAssetSelection';
import { compress } from 'util/compress';
import { EventLogTable } from 'types/LifeEvent';
import { SkillTimeline } from 'types/Skill';
import { TICKS_PER_YEAR } from 'util/time';
import { Genders } from 'types/Social';
import { PopulationState } from 'types/Genealogy';

function poolWith(records: PopulationState['people']): PopulationState {
    return { worldSeed: 1, people: records, drawSeed: 0, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

describe('LogicalWorld — homes', () => {
    test('a partner joins their partner; a child joins a parent; a founder gets a fresh home', () => {
        const world = new LogicalWorld(1);
        const people: PopulationState['people'] = {
            p0: { id: 'p0', firstName: 'A', familyName: 'X', gender: Genders.Male, birthTick: -30 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [{ partnerId: 'p1', startTick: -8 * TICKS_PER_YEAR, endTick: null }] },
            p1: { id: 'p1', firstName: 'B', familyName: 'Y', gender: Genders.Female, birthTick: -28 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [{ partnerId: 'p0', startTick: -8 * TICKS_PER_YEAR, endTick: null }] },
            p2: { id: 'p2', firstName: 'C', familyName: 'X', gender: Genders.Male, birthTick: -5 * TICKS_PER_YEAR, deathTick: null, fatherId: 'p0', motherId: 'p1', partnerships: [] },
        };
        // Enter in id order (founder p0 first), as the generator does.
        world.assignHome('p0', people);
        world.assignHome('p1', people);
        world.assignHome('p2', people);
        const home = (id: string) => (world.locationOf(id) as { key: string }).key;
        expect(home('p1')).toBe(home('p0')); // partner joined
        expect(home('p2')).toBe(home('p0')); // child joined a parent
    });
});

describe('LogicalWorld — WorldAdapter surface', () => {
    test('transitions resolve immediately and peopleAt groups by location', () => {
        const world = new LogicalWorld(2);
        world.assignHome('p0', poolWith({}).people);
        world.assignHome('p1', poolWith({}).people);
        // Both default to their own homes.
        expect(world.locationOf('p0').kind).toBe('building');
        const handle = world.requestTransition('p0', { kind: 'building', key: 'biz:0' }, 5, null);
        expect(handle.status).toBe('arrived');
        expect(world.locationOf('p0')).toEqual({ kind: 'building', key: 'biz:0' });
        expect(world.peopleAt({ kind: 'building', key: 'biz:0' })).toEqual(['p0']);
    });
});

describe('LogicalWorld — direct school accrual (task 077 §3)', () => {
    test('an enrolled school-age child gains basic proficiency per school day, clamped at 60', () => {
        const world = new LogicalWorld(3, { homes: true, schools: true, jobs: false, objects: false });
        world.buildSchools(50);
        const skillBook = new SkillBook();
        const engine = new EventEngine();
        // A 10-year-old (school-age): born 10 years before the current tick.
        const tick = 20 * TICKS_PER_YEAR;
        const kidBirth = tick - 10 * TICKS_PER_YEAR;
        const state = poolWith({
            kid: { id: 'kid', firstName: 'K', familyName: 'Z', gender: Genders.Female, birthTick: kidBirth, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
        });
        world.onEnter('kid', 10, kidBirth, tick, skillBook, state.people);
        const before = skillBook.proficiency('kid', 'math');

        // Run ~one year of monthly steps: the sweep enrolls, accrual awards school days.
        const step = 30 * 24;
        for (let t = tick; t < tick + TICKS_PER_YEAR; t += step) {
            world.runDaily(state, t, t + step, TICKS_PER_YEAR, skillBook, engine);
        }
        expect(world.schoolRegistry.assignmentOf('kid')).not.toBeNull(); // enrolled
        expect(skillBook.proficiency('kid', 'math')).toBeGreaterThan(before); // gained
        expect(skillBook.proficiency('kid', 'math')).toBeLessThanOrEqual(60); // clamped
    });
});

describe('LogicalWorld — carried inventory filtering', () => {
    test('carriedInventoryState keeps only instances rooted at a retained person', () => {
        const world = new LogicalWorld(4);
        const inv = world.inventory;
        // A carried item for a retained person, and one for a dropped person + a building fixture.
        inv.createInstance({ archetypeId: 'pencil', owner: { kind: 'person', personId: 'keep' }, container: { kind: 'possessions', personId: 'keep' }, tick: 0 });
        inv.createInstance({ archetypeId: 'pencil', owner: { kind: 'person', personId: 'drop' }, container: { kind: 'possessions', personId: 'drop' }, tick: 0 });
        inv.createInstance({ archetypeId: 'pencil', owner: { kind: 'building', key: 'home:x' }, container: { kind: 'location', key: 'building:home:x' }, tick: 0 });
        const carried = world.carriedInventoryState(new Set(['keep']));
        const owners = Object.values(carried.instances).map(i => (i.container.kind === 'possessions' ? i.container.personId : '?'));
        expect(owners).toEqual(['keep']);
    });
});

describe('Part B — per-window skill snapshotting (sliceAndRebase)', () => {
    function assetWithTimeline(): HistoryAsset {
        const people: PopulationState['people'] = {
            p1: { id: 'p1', firstName: 'A', familyName: 'X', gender: Genders.Male, birthTick: 0, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
            p2: { id: 'p2', firstName: 'B', familyName: 'X', gender: Genders.Female, birthTick: 50000, deathTick: null, fatherId: null, motherId: null, partnerships: [] }, // future
        };
        const rec = (prof: number, tick: number) => ({ suture_wounds: { proficiency: prof, firstAcquiredTick: 8000, lastProgressedTick: tick, provenance: ['job:doctor'] } });
        return {
            meta: { formatVersion: 1, generatorVersion: 't', seed: 1, params: { ...DEFAULT_GENERATOR_PARAMS, warmMarginYears: 0 }, createdAt: '', gitCommit: null, epochTick: 0, endTick: 100000, ticksPerYear: 8640, stats: { retainedPeople: 2, livingAtEnd: 2, births: 0, deaths: 0, medianHistoryLen: 0, trajectory: [], runtimeMs: 0, rawBytes: 0, compressedBytes: 0 } },
            population: { worldSeed: 1, people, drawSeed: 0, placedIds: [], nextSeq: 3, lastSimulatedYear: 0 },
            eventHistory: {}, eventLog: {}, eventLogSeq: 1, eventSchedule: { queue: [], nextScheduleSeq: 0 },
            skillTimeline: {
                // p1's job skill grows over time — a window at 30000 must pick the tick-10000 snapshot (20), NOT
                // the end-of-life 90 that the old flat snapshot would have installed.
                p1: [{ tick: 10000, skills: rec(20, 10000) }, { tick: 40000, skills: rec(60, 40000) }, { tick: 90000, skills: rec(90, 90000) }],
                p2: [{ tick: 60000, skills: rec(30, 60000) }],
            },
            objects: {
                instances: {
                    o1: { id: 'o1', archetypeId: 'pencil', quantity: 1, owner: { kind: 'person', personId: 'p1' }, container: { kind: 'possessions', personId: 'p1' }, createdAtTick: 10000, provenance: null },
                    o2: { id: 'o2', archetypeId: 'pencil', quantity: 1, owner: { kind: 'person', personId: 'p2' }, container: { kind: 'possessions', personId: 'p2' }, createdAtTick: 55000, provenance: null },
                },
                nextInstanceSeq: 3,
            },
        };
    }

    test('installs each person\'s skills AS OF the window (not the end-of-life snapshot)', () => {
        const sliced = sliceAndRebase(assetWithTimeline(), 30000);
        expect(Object.keys(sliced.population.people)).toEqual(['p1']); // p2 (birthTick 50000 > w) dropped
        // The tick-10000 snapshot wins (<= w=30000), so job proficiency reads 20 — matching the windowed age.
        expect(sliced.skillBook!.records.p1!.suture_wounds!.proficiency).toBe(20);
        expect(sliced.skillBook!.records.p1!.suture_wounds!.lastProgressedTick).toBe(10000 - 30000); // rebased
        expect(sliced.skillBook!.records.p2).toBeUndefined();
        expect(sliced.skillBook!.initialized).toEqual({ p1: true }); // so setupHousehold.initialize no-ops for p1
        expect(Object.keys(sliced.objects!.instances)).toEqual(['o1']); // p2's possession dropped
    });

    test('a person with no snapshot as of the window is left for live age-appropriate init', () => {
        // Window before p1's first snapshot (tick 10000): no records installed → not initialized.
        const sliced = sliceAndRebase(assetWithTimeline(), 5000);
        expect(sliced.skillBook!.records.p1).toBeUndefined();
        expect(sliced.skillBook!.initialized.p1).toBeUndefined();
    });
});

describe('generator with the logical-economy world (task 077, integration)', () => {
    jest.setTimeout(180000);
    const params: HistoryGeneratorParams = {
        ...DEFAULT_GENERATOR_PARAMS,
        seed: 7, founderCount: 40, recordThreshold: 30, recordYears: 6, daysPerStep: 30, skillSnapshotYears: 1,
        populationControl: { enabled: true, target: 55, band: 0.05, suppressLevel: 0.1, allowLevel: 1 },
        logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
    };

    test('carries a per-person skill timeline + possessions, and careers progress', async () => {
        const asset = await generateHistoryAsset(params);
        expect(asset.skillTimeline).toBeDefined();
        expect(asset.objects).toBeDefined();
        expect(Object.keys(asset.skillTimeline!).length).toBeGreaterThan(0);
        expect(Object.keys(asset.objects!.instances).length).toBeGreaterThan(0);
        // A person whose skills changed over the run has multiple snapshots (the timeline captures growth).
        expect(Object.values(asset.skillTimeline!).some(timeline => timeline.length > 1)).toBe(true);
        // An adult reached the educated baseline (basics at 60) in some snapshot.
        const anAdult = Object.values(asset.skillTimeline!).some(timeline =>
            timeline.some(snap => (snap.skills['math']?.proficiency ?? 0) >= 60));
        expect(anAdult).toBe(true);
        // Employment + promotion happened off-map (a real career, not synthesized).
        const has = (defId: string) => Object.values(asset.eventLog).some(entries => entries.some(e => e.defId === defId));
        expect(has('get_job') || has('got_promoted')).toBe(true);
        // Some snapshot carries a job-progressed skill (provenance job:*).
        const anyJobSkill = Object.values(asset.skillTimeline!).some(timeline =>
            timeline.some(snap => Object.values(snap.skills).some(rec => rec.provenance.some(p => p.startsWith('job:')))));
        expect(anyJobSkill).toBe(true);
    });

    test('is deterministic — same (seed, params) → identical timeline + possessions', async () => {
        const a = await generateHistoryAsset(params);
        const b = await generateHistoryAsset(params);
        expect(b.skillTimeline).toEqual(a.skillTimeline);
        expect(b.objects).toEqual(a.objects);
    });
});

describe('streaming to shards + chunked loading (task 077)', () => {
    jest.setTimeout(180000);
    // A few flush intervals over the run so multiple shards are produced.
    const params: HistoryGeneratorParams = {
        ...DEFAULT_GENERATOR_PARAMS,
        seed: 11, founderCount: 40, recordThreshold: 30, recordYears: 12, daysPerStep: 30,
        skillSnapshotYears: 1, flushIntervalYears: 3, keepActionLog: false,
        populationControl: { enabled: true, target: 55, band: 0.05, suppressLevel: 0.1, allowLevel: 1 },
        logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
    };

    // An in-memory sink standing in for the CLI's disk sink: shard payloads land in a map keyed by file name.
    function memorySink(store: Map<string, string>): { sink: HistoryAssetSink } {
        let li = 0;
        let si = 0;
        const range = (ticks: number[]) => ({ minTick: ticks.length ? Math.min(...ticks) : 0, maxTick: ticks.length ? Math.max(...ticks) : 0 });
        const sink: HistoryAssetSink = {
            logShard(table: EventLogTable): ShardRef {
                const ticks = Object.values(table).flatMap(entries => entries.map(e => e.tick));
                const file = `log-${li++}.tbz`;
                store.set(file, compress(JSON.stringify(table)));
                return { file, ...range(ticks) };
            },
            skillShard(timeline: SkillTimeline): ShardRef {
                const ticks = Object.values(timeline).flatMap(snaps => snaps.map(s => s.tick));
                const file = `skills-${si++}.tbz`;
                store.set(file, compress(JSON.stringify(timeline)));
                return { file, ...range(ticks) };
            },
        };
        return { sink };
    }

    test('streamed + chunk-loaded selection equals in-memory selection (multiple shards)', async () => {
        const inMem = await generateHistoryAsset(params);

        const store = new Map<string, string>();
        const { sink } = memorySink(store);
        const streamed = await generateHistoryAsset(params, undefined, null, sink);
        // The log + timeline were streamed to shards, not held inline.
        expect(streamed.eventLog).toEqual({});
        expect(streamed.skillTimeline).toBeUndefined();
        expect(streamed.logShards!.length).toBeGreaterThan(1); // actually sharded across flush intervals

        store.set('population.tbz', compress(JSON.stringify(streamed.population)));
        store.set('objects.tbz', compress(JSON.stringify(streamed.objects)));
        store.set('eventHistory.tbz', compress(JSON.stringify(streamed.eventHistory)));
        const header: AssetHeader = {
            meta: streamed.meta, eventLogSeq: streamed.eventLogSeq,
            sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz' },
            logShards: streamed.logShards!, skillShards: streamed.skillShards!,
        };
        const read = (file: string) => store.get(file)!;

        for (const seed of [1, 42, 7777]) {
            const fromShards = selectStartingWorldFromShards(header, read, seed)!;
            const fromMemory = selectStartingWorld(inMem, seed)!;
            expect(fromShards.window).toBe(fromMemory.window);
            expect(fromShards.population.people).toEqual(fromMemory.population.people);
            expect(fromShards.skillBook).toEqual(fromMemory.skillBook);
            expect(fromShards.objects).toEqual(fromMemory.objects);
            expect(fromShards.eventLog).toEqual(fromMemory.eventLog);
        }
    });

    test('chunked loading only reads shards up to the window', async () => {
        const store = new Map<string, string>();
        const { sink } = memorySink(store);
        const streamed = await generateHistoryAsset(params, undefined, null, sink);
        store.set('population.tbz', compress(JSON.stringify(streamed.population)));
        store.set('objects.tbz', compress(JSON.stringify(streamed.objects)));
        store.set('eventHistory.tbz', compress(JSON.stringify(streamed.eventHistory)));
        const header: AssetHeader = {
            meta: streamed.meta, eventLogSeq: streamed.eventLogSeq,
            sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz' },
            logShards: streamed.logShards!, skillShards: streamed.skillShards!,
        };
        const readFiles: string[] = [];
        const read = (file: string) => { readFiles.push(file); return store.get(file)!; };
        const selected = selectStartingWorldFromShards(header, read, 3)!;
        // No shard whose window starts after the selected present tick should have been fetched.
        for (const shard of [...header.logShards, ...header.skillShards]) {
            if (shard.minTick > selected.window) {
                expect(readFiles).not.toContain(shard.file);
            }
        }
    });
});
