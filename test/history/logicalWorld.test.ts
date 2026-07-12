// Task 077 — the offline logical-economy world. Unit-tests the deterministic building blocks (homes, the
// WorldAdapter surface, direct school accrual, carried-inventory filtering) plus one end-to-end integration
// run proving the generator carries lived skills/careers/possessions into the asset.

import EventEngine from 'game/events/EventEngine';
import { generateHistoryAsset, DEFAULT_GENERATOR_PARAMS, HistoryGeneratorParams, HistoryAsset, HistoryAssetSink } from 'game/history/HistoryAsset';
import { sliceAndRebase, selectStartingWorld, selectStartingWorldFromSections, decodePersonFile, AssetHeader, PersonChunk } from 'game/history/HistoryAssetSelection';
import LogicalWorld, { LogicalJobMarket } from 'game/history/LogicalWorld';
import SkillBook from 'game/skills/SkillBook';
import { PopulationState } from 'types/Genealogy';
import { EventLogTable } from 'types/LifeEvent';
import { SkillTimeline } from 'types/Skill';
import { Genders } from 'types/Social';
import { compress } from 'util/compress';
import { TICKS_PER_YEAR } from 'util/time';

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

    test('requesting the same target twice is a no-op on the reverse location index (idempotent)', () => {
        const world = new LogicalWorld(2);
        world.assignHome('p0', poolWith({}).people);
        world.requestTransition('p0', { kind: 'building', key: 'biz:0' }, 5, null);
        // Same target again: setLocationIndex's early-return branch — must not duplicate the entry.
        world.requestTransition('p0', { kind: 'building', key: 'biz:0' }, 6, null);
        expect(world.peopleAt({ kind: 'building', key: 'biz:0' })).toEqual(['p0']);
    });

    test('register() assigns a fresh home for a bare id (no pool lookup)', () => {
        const world = new LogicalWorld(2);
        world.register('solo');
        expect(world.locationOf('solo').kind).toBe('building');
        expect(world.peopleAt(world.locationOf('solo'))).toEqual(['solo']);
    });

    test('assignHome is idempotent — calling it again for an already-homed person is a no-op', () => {
        const world = new LogicalWorld(2);
        world.assignHome('p0', poolWith({}).people);
        const before = world.locationOf('p0');
        world.assignHome('p0', poolWith({}).people); // second call must return early, home unchanged
        expect(world.locationOf('p0')).toEqual(before);
    });
});

describe('LogicalWorld — schools/jobs disabled and missing-candidate guards', () => {
    test('buildSchools is a no-op when config.schools is false — the sweep never enrolls anyone', () => {
        const world = new LogicalWorld(3, { homes: true, schools: false, jobs: false, objects: false });
        world.buildSchools(50);
        const engine = new EventEngine();
        const tick = 20 * TICKS_PER_YEAR;
        const kidBirth = tick - 10 * TICKS_PER_YEAR;
        const state = poolWith({
            kid: { id: 'kid', firstName: 'K', familyName: 'Z', gender: Genders.Female, birthTick: kidBirth, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
        });
        world.assignHome('kid', state.people);
        world.runSchoolSweep(state, tick, TICKS_PER_YEAR, engine);
        expect(world.schoolRegistry.assignmentOf('kid')).toBeNull();
    });

    test('runSchoolSweep is also a no-op when schools are enabled but buildSchools was never called (no seats)', () => {
        const world = new LogicalWorld(3, { homes: true, schools: true, jobs: false, objects: false });
        const engine = new EventEngine();
        const tick = 20 * TICKS_PER_YEAR;
        const kidBirth = tick - 10 * TICKS_PER_YEAR;
        const state = poolWith({
            kid: { id: 'kid', firstName: 'K', familyName: 'Z', gender: Genders.Female, birthTick: kidBirth, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
        });
        world.assignHome('kid', state.people);
        world.runSchoolSweep(state, tick, TICKS_PER_YEAR, engine); // schoolSeats.length === 0 ⇒ early return
        expect(world.schoolRegistry.assignmentOf('kid')).toBeNull();
    });

    test('runSchoolSweep and runSkillMilestones skip candidate ids missing from state.people (defensive)', () => {
        const world = new LogicalWorld(3, { homes: true, schools: true, jobs: false, objects: false });
        world.buildSchools(50);
        const engine = new EventEngine();
        const skillBook = new SkillBook();
        const tick = 20 * TICKS_PER_YEAR;
        // 'ghost' is passed explicitly as a candidate id but never appears in state.people.
        expect(() => world.runSchoolSweep(poolWith({}), tick, TICKS_PER_YEAR, engine, ['ghost'])).not.toThrow();
        expect(() => world.runSkillMilestones(poolWith({}), tick, TICKS_PER_YEAR, skillBook, ['ghost'])).not.toThrow();
        expect(world.schoolRegistry.assignmentOf('ghost')).toBeNull();
    });

    test('sweepIds (via runDaily) skips ids in the `living` set that were never registered (unhomed)', () => {
        const world = new LogicalWorld(3, { homes: true, schools: true, jobs: true, objects: false });
        world.buildSchools(50);
        const skillBook = new SkillBook();
        world.buildJobs(skillBook, 50);
        const engine = new EventEngine();
        // 'ghost' never went through assignHome/register, so homeKeyOf.has('ghost') is false — sweepIds must
        // filter it out rather than crash on a person with no home.
        expect(() => world.runDaily(poolWith({}), 0, 24, TICKS_PER_YEAR, skillBook, engine, new Set(['ghost']))).not.toThrow();
    });

    test('buildJobs is a no-op when config.jobs is false — tickFacts exposes no job market', () => {
        const world = new LogicalWorld(3, { homes: true, schools: false, jobs: false, objects: false });
        const skillBook = new SkillBook();
        world.buildJobs(skillBook, 50);
        const facts = world.tickFacts(skillBook, 0);
        expect(facts.ctx.markets.jobMarket).toBeNull();
    });
});

describe('LogicalWorld — zero-elapsed accrual windows are no-ops', () => {
    test('a fromTick === toTick window awards no school or work-day progress', () => {
        const world = new LogicalWorld(5, { homes: true, schools: true, jobs: true, objects: false });
        world.buildSchools(50);
        const skillBook = new SkillBook();
        world.buildJobs(skillBook, 50);
        const engine = new EventEngine();
        const tick = 25 * TICKS_PER_YEAR;

        // An enrolled school-age kid.
        const kidBirth = tick - 10 * TICKS_PER_YEAR;
        // An adult hired directly through the real (off-map) job market, bypassing the intra-day shift chain.
        const adultBirth = tick - 25 * TICKS_PER_YEAR;
        const state = poolWith({
            kid: { id: 'kid', firstName: 'K', familyName: 'Z', gender: Genders.Female, birthTick: kidBirth, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
            adult: { id: 'adult', firstName: 'A', familyName: 'Z', gender: Genders.Male, birthTick: adultBirth, deathTick: null, fatherId: null, motherId: null, partnerships: [] },
        });
        world.onEnter('kid', 10, kidBirth, tick, skillBook, state.people);
        world.onEnter('adult', 25, adultBirth, tick, skillBook, state.people);
        const jobMarket = world.tickFacts(skillBook, tick).ctx.markets.jobMarket!;
        expect(jobMarket.hire('adult')).toBe(true); // the self-climbing entry-grant rule guarantees SOME hire

        const kidBefore = skillBook.proficiency('kid', 'math');
        const adultRecordsBefore = JSON.stringify(skillBook.skillsOf('adult'));

        world.runDaily(state, tick, tick, TICKS_PER_YEAR, skillBook, engine); // zero-length window
        expect(skillBook.proficiency('kid', 'math')).toBe(kidBefore); // no school-day gain
        expect(JSON.stringify(skillBook.skillsOf('adult'))).toBe(adultRecordsBefore); // no work-day gain
        expect(jobMarket.assignmentOf('adult')!.workDaysInRank ?? 0).toBe(0); // no promotion-clock progress
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

    test('walks nested object containers (pencil-in-backpack) up to the carrying person', () => {
        const world = new LogicalWorld(4);
        const inv = world.inventory;
        const bag = inv.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'keep' }, container: { kind: 'possessions', personId: 'keep' }, tick: 0 });
        inv.createInstance({ archetypeId: 'pencil', owner: { kind: 'person', personId: 'keep' }, container: { kind: 'object', instanceId: bag.id }, tick: 0 });
        const carried = world.carriedInventoryState(new Set(['keep']));
        expect(carried.instances[bag.id]).toBeDefined();
        expect(Object.values(carried.instances).map(i => i.archetypeId).sort()).toEqual(['backpack', 'pencil']);
    });

    test('a broken containment cycle (unreachable via the live Inventory API) resolves to dropped, not an infinite loop', () => {
        const world = new LogicalWorld(4);
        const inv = world.inventory;
        const bagA = inv.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'keep' }, container: { kind: 'possessions', personId: 'keep' }, tick: 0 });
        const bagB = inv.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'keep' }, container: { kind: 'object', instanceId: bagA.id }, tick: 0 });
        // moveInstance() rejects containment cycles — a corrupt/hand-edited state is the only way to produce
        // one, so mutate the live state directly (getState() returns the real internal reference) to point
        // bagA back into bagB, closing the loop A → B → A.
        const state = inv.getState();
        state.instances[bagA.id]!.container = { kind: 'object', instanceId: bagB.id };
        const carried = world.carriedInventoryState(new Set(['keep']));
        expect(carried.instances[bagA.id]).toBeUndefined();
        expect(carried.instances[bagB.id]).toBeUndefined();
    });

    test('a dangling object-container reference (points at a nonexistent instance) resolves to dropped', () => {
        const world = new LogicalWorld(4);
        const inv = world.inventory;
        const dangling = inv.createInstance({ archetypeId: 'pencil', owner: { kind: 'person', personId: 'keep' }, container: { kind: 'possessions', personId: 'keep' }, tick: 0 });
        const state = inv.getState();
        state.instances[dangling.id]!.container = { kind: 'object', instanceId: 'does-not-exist' };
        const carried = world.carriedInventoryState(new Set(['keep']));
        expect(carried.instances[dangling.id]).toBeUndefined();
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

describe('streaming to person files + boot-from-sections (task 077; person-keyed since the task-012 follow-up)', () => {
    jest.setTimeout(180000);
    // A few flush intervals over the run so every person file accumulates multiple chunk lines.
    const params: HistoryGeneratorParams = {
        ...DEFAULT_GENERATOR_PARAMS,
        seed: 11, founderCount: 40, recordThreshold: 30, recordYears: 12, daysPerStep: 30,
        skillSnapshotYears: 1, flushIntervalYears: 3, keepActionLog: false,
        populationControl: { enabled: true, target: 55, band: 0.05, suppressLevel: 0.1, allowLevel: 1 },
        logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
    };

    // An in-memory sink standing in for the CLI's disk sink: chunk lines append to a body per person file.
    function memorySink(bodies: Map<string, string>): { sink: HistoryAssetSink; chunksAppended: () => number } {
        let chunks = 0;
        const append = (personId: string, chunk: PersonChunk): void => {
            const file = `person-${personId}.tbz`;
            bodies.set(file, (bodies.get(file) ?? '') + compress(JSON.stringify(chunk)) + '\n');
            chunks++;
        };
        const sink: HistoryAssetSink = {
            logChunk(table: EventLogTable): void {
                for (const [id, entries] of Object.entries(table)) {
                    append(id, { log: entries });
                }
            },
            skillChunk(timeline: SkillTimeline): void {
                for (const [id, snapshots] of Object.entries(timeline)) {
                    append(id, { skills: snapshots });
                }
            },
        };
        return { sink, chunksAppended: () => chunks };
    }

    test('streamed person files + boot-from-sections reproduce the in-memory selection exactly', async () => {
        const inMem = await generateHistoryAsset(params);

        const bodies = new Map<string, string>();
        const { sink, chunksAppended } = memorySink(bodies);
        const streamed = await generateHistoryAsset(params, undefined, null, sink);
        // The log + timeline were streamed to the sink, not held inline; multiple chunks were appended
        // (several flush intervals over the run), so decode genuinely merges chunk lines.
        expect(streamed.eventLog).toEqual({});
        expect(streamed.skillTimeline).toBeUndefined();
        expect(chunksAppended()).toBeGreaterThan(Object.keys(streamed.population.people).length);

        const store = new Map<string, string>(bodies);
        store.set('population.tbz', compress(JSON.stringify(streamed.population)));
        store.set('objects.tbz', compress(JSON.stringify(streamed.objects)));
        const retained = Object.keys(streamed.population.people);
        const header: AssetHeader = {
            meta: streamed.meta, eventLogSeq: streamed.eventLogSeq,
            sections: { population: 'population.tbz', objects: 'objects.tbz', eventHistory: 'eventHistory.tbz' },
            people: Object.fromEntries(retained.filter(id => bodies.has(`person-${id}.tbz`)).map(id => [id, `person-${id}.tbz`])),
        };
        const read = (file: string) => store.get(file)!;

        for (const seed of [1, 42, 7777]) {
            const fromSections = selectStartingWorldFromSections(header, read, seed)!;
            const fromMemory = selectStartingWorld(inMem, seed)!;
            expect(fromSections.window).toBe(fromMemory.window);
            expect(fromSections.population.people).toEqual(fromMemory.population.people);
            expect(fromSections.objects).toEqual(fromMemory.objects);
            // Boot deliberately installs NO logs/skills — those hydrate per person below.
            expect(fromSections.eventLog).toEqual({});
            expect(fromSections.skillBook).toBeUndefined();

            // Per-person decode of the chunked file reproduces the eager windowed log, aggregate and skills.
            for (const id of Object.keys(fromMemory.eventLog).slice(0, 8)) {
                const file = header.people[id];
                expect(file).toBeDefined();
                const hydrated = decodePersonFile(id, read(file!), fromSections.window);
                expect(hydrated.log).toEqual(fromMemory.eventLog[id]);
                expect(hydrated.history).toEqual(fromMemory.eventHistory[id] ?? {});
                expect(hydrated.skills ?? undefined).toEqual(fromMemory.skillBook?.records[id]);
            }
        }
    });
});

// --- LogicalJobMarket (task 077) — standalone unit tests -----------------------------------------------------
// LogicalJobMarket is exported independently of LogicalWorld, so its matching/hiring logic (ported from
// game/JobMarket.ts, minus distance scoring) can be driven directly with hand-built businesses — including
// shapes real generated data never produces (a title with no matching job def), which is what exercises the
// "generic, rank-less position" fallback branch of matchPosition.

function fakeBusiness(key: string, title: string, requirements: string[]): ConstructorParameters<typeof LogicalJobMarket>[0][number] {
    return {
        key,
        blueprintKey: 'fake',
        positions: [{ title, salary: 1000, requirements, shiftStart: 480, shiftEnd: 960 }],
        filled: [false],
        position: null,
    };
}

describe('LogicalJobMarket — generic (no matching job definition) positions', () => {
    test('hires into a made-up title when its (empty) requirements are met', () => {
        const skillBook = new SkillBook();
        skillBook.grant('p1', 'reading', { toAtLeast: 1 }, 0, 'test'); // just enough for hasAny() to pass
        const market = new LogicalJobMarket([fakeBusiness('biz:fake', 'Fake Gig', [])], skillBook);
        expect(market.canHire('p1')).toBe(true);
        expect(market.hire('p1')).toBe(true);
        expect(market.assignmentOf('p1')!.title).toBe('Fake Gig');
        expect(market.employerKeyOf('p1')).toBe('biz:fake');
        expect(market.isEmployed('p1')).toBe(true);
    });

    test('refuses a made-up title whose requirement the candidate lacks', () => {
        const skillBook = new SkillBook();
        skillBook.grant('p2', 'reading', { toAtLeast: 1 }, 0, 'test');
        const market = new LogicalJobMarket([fakeBusiness('biz:fake', 'Fake Gig', ['a_skill_p2_never_learned'])], skillBook);
        expect(market.canHire('p2')).toBe(false);
        expect(market.hire('p2')).toBe(false);
        expect(market.assignmentOf('p2')).toBeNull();
    });
});

describe('LogicalJobMarket — real ranked job, unreachable candidate', () => {
    // A real job (Checkout Clerk) whose entry-rank entryTrainingGrant covers its own `requires` exactly, but
    // (like every real job) leans on skill DEPENDENCIES the adult educated baseline (basics = 60) would
    // normally satisfy. A completely bare SkillBook — no adult initialization at all — never reaches that
    // baseline, so the entry-grant shortcut is infeasible and no rank matches.
    function checkoutClerkBusiness() {
        return fakeBusiness('biz:real', 'Checkout Clerk', []);
    }

    test('hire() fails when no rank is met and the entry-grant shortcut is infeasible (missing basics)', () => {
        const skillBook = new SkillBook();
        // A real but wholly unrelated skill — just enough for hasAny() to be true, so the failure below comes
        // from matchPosition/shortcutFeasible actually running, not from the earlier hasAny() short-circuit.
        const granted = skillBook.grant('p3', 'music', { toAtLeast: 1 }, 0, 'test');
        expect(granted.ok).toBe(true);
        expect(skillBook.hasAny('p3')).toBe(true);
        const market = new LogicalJobMarket([checkoutClerkBusiness()], skillBook);
        expect(market.canHire('p3')).toBe(false);
        expect(market.hire('p3')).toBe(false);
    });

    test('bestMatch short-circuits (no work) for an already-assigned person or one with zero skills', () => {
        const skillBook = new SkillBook();
        const market = new LogicalJobMarket([checkoutClerkBusiness()], skillBook);
        // No skills at all ⇒ hasAny() false ⇒ hire fails immediately, before any position is even scanned.
        expect(market.hire('nobody')).toBe(false);

        skillBook.grant('p4', 'reading', { toAtLeast: 1 }, 0, 'test');
        skillBook.initialize('p4', 25, -25 * TICKS_PER_YEAR, 0, 1, new Set()); // adult baseline (basics = 60)
        expect(market.hire('p4')).toBe(true); // reachable now that basics cover the dependency chain
        // Already assigned: a second hire attempt must short-circuit false without re-scanning positions.
        expect(market.hire('p4')).toBe(false);
    });

    test('fire() frees the position so a subsequent candidate can be hired into it', () => {
        const skillBook = new SkillBook();
        skillBook.initialize('p5', 25, -25 * TICKS_PER_YEAR, 0, 2, new Set());
        skillBook.initialize('p6', 25, -25 * TICKS_PER_YEAR, 0, 3, new Set());
        const market = new LogicalJobMarket([checkoutClerkBusiness()], skillBook);
        expect(market.hire('p5')).toBe(true);
        expect(market.hire('p6')).toBe(false); // the single position is filled
        market.fire('p5');
        expect(market.employerKeyOf('p5')).toBeNull();
        expect(market.isEmployed('p5')).toBe(false);
        expect(market.hire('p6')).toBe(true); // now free
    });

    test('fire() on someone never employed here is a harmless no-op', () => {
        const skillBook = new SkillBook();
        const market = new LogicalJobMarket([checkoutClerkBusiness()], skillBook);
        expect(() => market.fire('never-hired')).not.toThrow();
        expect(market.employerKeyOf('never-hired')).toBeNull();
    });
});
