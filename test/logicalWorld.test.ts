// Task 077 — the offline logical-economy world. Unit-tests the deterministic building blocks (homes, the
// WorldAdapter surface, direct school accrual, carried-inventory filtering) plus one end-to-end integration
// run proving the generator carries lived skills/careers/possessions into the asset.

import LogicalWorld from '../src/app/game/LogicalWorld';
import SkillBook from '../src/app/game/SkillBook';
import EventEngine from '../src/app/game/EventEngine';
import { generateHistoryAsset, DEFAULT_GENERATOR_PARAMS, HistoryGeneratorParams, HistoryAsset } from '../src/app/game/HistoryAsset';
import { sliceAndRebase } from '../src/app/game/HistoryAssetSelection';
import { TICKS_PER_YEAR } from '../src/util/time';
import { Genders } from '../src/types/Social';
import { PopulationState } from '../src/types/Genealogy';

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

describe('Part B — consuming asset skills + possessions (sliceAndRebase)', () => {
    function assetWithSkills(): HistoryAsset {
        const people: PopulationState['people'] = {
            p1: { id: 'p1', firstName: 'A', familyName: 'X', gender: Genders.Male, birthTick: 0, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
            p2: { id: 'p2', firstName: 'B', familyName: 'X', gender: Genders.Female, birthTick: 50000, deathTick: null, fatherId: null, motherId: null, partnerships: [] }, // future
        };
        return {
            meta: { formatVersion: 1, generatorVersion: 't', seed: 1, params: { ...DEFAULT_GENERATOR_PARAMS, warmMarginYears: 0 }, createdAt: '', gitCommit: null, epochTick: 0, endTick: 100000, ticksPerYear: 8640, stats: { retainedPeople: 2, livingAtEnd: 2, births: 0, deaths: 0, medianHistoryLen: 0, trajectory: [], runtimeMs: 0, rawBytes: 0, compressedBytes: 0 } },
            population: { worldSeed: 1, people, drawSeed: 0, placedIds: [], nextSeq: 3, lastSimulatedYear: 0 },
            eventHistory: {}, eventLog: {}, eventLogSeq: 1, eventSchedule: { queue: [], nextScheduleSeq: 0 },
            skillBook: {
                records: {
                    p1: { math: { proficiency: 60, firstAcquiredTick: 5000, lastProgressedTick: 25000, provenance: ['school'] } },
                    p2: { math: { proficiency: 60, firstAcquiredTick: 55000, lastProgressedTick: 60000, provenance: ['school'] } },
                },
                initialized: { p1: true, p2: true },
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

    test('keeps retained people, drops future ones, and rebases skill/object ticks', () => {
        const sliced = sliceAndRebase(assetWithSkills(), 30000);
        expect(Object.keys(sliced.population.people)).toEqual(['p1']); // p2 (birthTick 50000 > w) dropped
        expect(sliced.skillBook!.records.p1!.math!.firstAcquiredTick).toBe(5000 - 30000);
        expect(sliced.skillBook!.records.p2).toBeUndefined();
        expect(sliced.skillBook!.initialized).toEqual({ p1: true }); // so setupHousehold.initialize no-ops for p1
        expect(Object.keys(sliced.objects!.instances)).toEqual(['o1']); // p2's possession dropped
        expect(sliced.objects!.instances.o1!.createdAtTick).toBe(10000 - 30000);
    });
});

describe('generator with the logical-economy world (task 077, integration)', () => {
    jest.setTimeout(180000);
    const params: HistoryGeneratorParams = {
        ...DEFAULT_GENERATOR_PARAMS,
        seed: 7, founderCount: 40, recordThreshold: 30, recordYears: 6, daysPerStep: 30,
        carryingCapacity: { enabled: true, soft: 55, steepness: 4 },
        logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
    };

    test('carries a SkillBook + carried possessions, and careers progress', async () => {
        const asset = await generateHistoryAsset(params);
        expect(asset.skillBook).toBeDefined();
        expect(asset.objects).toBeDefined();
        // Adults arrive with real proficiency (basics seeded at the educated baseline of 60) and possessions.
        expect(Object.keys(asset.skillBook!.records).length).toBeGreaterThan(0);
        expect(Object.keys(asset.objects!.instances).length).toBeGreaterThan(0);
        const anAdult = Object.values(asset.skillBook!.records).find(r => (r['math']?.proficiency ?? 0) >= 60);
        expect(anAdult).toBeDefined();
        // Employment + promotion happened off-map (a real career, not synthesized).
        const has = (defId: string) => Object.values(asset.eventLog).some(entries => entries.some(e => e.defId === defId));
        expect(has('get_job') || has('got_promoted')).toBe(true);
        // Some person accrued a job-progressed skill (provenance job:*).
        const anyJobSkill = Object.values(asset.skillBook!.records).some(record =>
            Object.values(record).some(rec => rec.provenance.some(p => p.startsWith('job:'))));
        expect(anyJobSkill).toBe(true);
    });

    test('is deterministic — same (seed, params) → identical skills + possessions', async () => {
        const a = await generateHistoryAsset(params);
        const b = await generateHistoryAsset(params);
        expect(b.skillBook).toEqual(a.skillBook);
        expect(b.objects).toEqual(a.objects);
    });
});
