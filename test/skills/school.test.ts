import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick } from 'game/execution/TickRunner';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import SchoolRegistry, { SchoolCandidate, SchoolSeat } from 'game/skills/SchoolRegistry';
import schoolsConfig from 'json/schools.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { SchoolConfig, SchoolFacts } from 'types/School';
import { Genders } from 'types/Social';
import { isSchoolAge, isSchoolDay, isSchoolInSession, schoolFactsFor } from 'util/school';
import { TICKS_PER_DAY } from 'util/time';


// School scheduling (task 058): the pure schedule math, the deterministic enrollment sweep, the Brain
// school-obligation hook (over the REAL manifests — attend_school and the school-day events are shipped
// data), and the per-day school-day-credit lifecycle in bootstrap mode.

const TPY = 8640;
const CONFIG = schoolsConfig as unknown as SchoolConfig;

// json/schools.json ships an 08:00–14:00 mon–fri school day for ages 7–17.
const SCHOOL: SchoolFacts = schoolFactsFor(CONFIG, '5-5');

function person(id: string, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(entries: [string, number][]): PopulationState {
    const people: Record<string, GenPerson> = {};
    entries.forEach(([id, age]) => (people[id] = person(id, age)));
    return { worldSeed: 77, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

function harness(schoolOf?: (id: string) => SchoolFacts | null, ages: [string, number][] = [['kid', 10]]) {
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const state = pool(ages);
    const makeDeps = (tick: number): BrainDeps => ({
        state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory, ...(schoolOf ? { schoolOf } : {}),
    });
    return { engine, actions, brain, world, inventory, state, makeDeps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

// Day 0 of the calendar is a Monday (util/time, task 057).
const MONDAY = 0;
const SATURDAY = 5;
const at = (day: number, hour: number): number => day * TICKS_PER_DAY + hour;

describe('school schedule math (util/school)', () => {
    test('school days are weekdays only', () => {
        expect(isSchoolDay(CONFIG, MONDAY)).toBe(true);
        expect(isSchoolDay(CONFIG, 4)).toBe(true); // friday
        expect(isSchoolDay(CONFIG, SATURDAY)).toBe(false);
        expect(isSchoolDay(CONFIG, 6)).toBe(false); // sunday
        expect(isSchoolDay(CONFIG, 7)).toBe(true); // next monday
        expect(isSchoolDay(CONFIG, -1)).toBe(false); // day −1 is a Sunday (bootstrap pre-history)
    });

    test('in-session tracks the day window on school days only', () => {
        expect(isSchoolInSession(CONFIG, at(MONDAY, 7))).toBe(false);
        expect(isSchoolInSession(CONFIG, at(MONDAY, 8))).toBe(true);
        expect(isSchoolInSession(CONFIG, at(MONDAY, 13))).toBe(true);
        expect(isSchoolInSession(CONFIG, at(MONDAY, 14))).toBe(false); // exclusive end
        expect(isSchoolInSession(CONFIG, at(SATURDAY, 10))).toBe(false); // weekend
    });

    test('the enrollment band is 7 through 17 inclusive', () => {
        expect(isSchoolAge(CONFIG, 6)).toBe(false);
        expect(isSchoolAge(CONFIG, 7)).toBe(true);
        expect(isSchoolAge(CONFIG, 17)).toBe(true);
        expect(isSchoolAge(CONFIG, 18)).toBe(false);
    });
});

describe('SchoolRegistry sweep', () => {
    const seat = (key: string, seats: number, row: number, col: number): SchoolSeat => ({ key, seats, position: { row, col } });
    const kid = (personId: string, ageYears: number, row: number, col: number): SchoolCandidate => ({ personId, ageYears, homePosition: { row, col } });

    test('enrolls school-age children into the nearest school with a free seat, deterministically', () => {
        const registry = new SchoolRegistry();
        const outcome = registry.sweep(CONFIG, [kid('a', 10, 0, 0), kid('b', 9, 0, 20)], [seat('near', 10, 0, 2), seat('far', 10, 0, 22)], 5);
        expect(outcome.enrolled.map(assignment => [assignment.personId, assignment.schoolKey])).toEqual([['a', 'near'], ['b', 'far']]);
        expect(registry.assignmentOf('a')?.schoolKey).toBe('near');
        // Re-running is a no-op (idempotent).
        expect(registry.sweep(CONFIG, [kid('a', 10, 0, 0), kid('b', 9, 0, 20)], [seat('near', 10, 0, 2), seat('far', 10, 0, 22)], 6).enrolled).toEqual([]);
    });

    test('capacity binds: a full school overflows to the next; nobody enrolls past the seats', () => {
        const registry = new SchoolRegistry();
        const outcome = registry.sweep(CONFIG, [kid('a', 8, 0, 0), kid('b', 8, 0, 1), kid('c', 8, 0, 2)], [seat('tiny', 2, 0, 0)], 1);
        expect(outcome.enrolled).toHaveLength(2);
        expect(registry.assignmentOf('c')).toBeNull(); // no seat — stays unenrolled, no silent auto-schooling
        expect(registry.enrolledCount('tiny')).toBe(2);
    });

    test('too young / aged-out people are not enrolled; turning 18 releases with an agedOut record', () => {
        const registry = new SchoolRegistry();
        expect(registry.sweep(CONFIG, [kid('young', 6, 0, 0)], [seat('s', 10, 0, 0)], 1).enrolled).toEqual([]);

        registry.sweep(CONFIG, [kid('teen', 17, 0, 0)], [seat('s', 10, 0, 0)], 1);
        expect(registry.assignmentOf('teen')).not.toBeNull();
        const outcome = registry.sweep(CONFIG, [kid('teen', 18, 0, 0)], [seat('s', 10, 0, 0)], 2);
        expect(outcome.released).toEqual(['teen']);
        expect(outcome.agedOut).toEqual(['teen']);
        expect(registry.assignmentOf('teen')).toBeNull();
    });

    test('a vanished school releases its students (not as graduations) and they re-enroll where seats exist', () => {
        const registry = new SchoolRegistry();
        registry.sweep(CONFIG, [kid('a', 10, 0, 0)], [seat('gone', 10, 0, 0)], 1);
        const released = registry.sweep(CONFIG, [kid('a', 10, 0, 0)], [seat('other', 10, 5, 5)], 2);
        expect(released.agedOut).toEqual([]);
        expect(registry.assignmentOf('a')?.schoolKey).toBe('other'); // released AND re-enrolled in one sweep
    });

    test('releaseSchool drops exactly that school\'s assignments (closure/bulldoze path)', () => {
        const registry = new SchoolRegistry();
        registry.assign('a', 's1', 1);
        registry.assign('b', 's2', 1);
        expect(registry.releaseSchool('s1')).toEqual(['a']);
        expect(registry.assignmentOf('a')).toBeNull();
        expect(registry.assignmentOf('b')?.schoolKey).toBe('s2');
    });

    test('state round-trips (save/load)', () => {
        const registry = new SchoolRegistry();
        registry.assign('a', 's1', 42);
        const restored = new SchoolRegistry();
        restored.loadState(registry.getState());
        expect(restored.assignmentOf('a')).toEqual({ personId: 'a', schoolKey: 's1', assignedAtTick: 42 });
    });
});

describe('the school obligation (Brain hook, real manifests)', () => {
    test('an enrolled child attends school in session: attend_school at the assigned building, day-start logged', () => {
        const { engine, brain, makeDeps } = harness(id => (id === 'kid' ? SCHOOL : null));
        brain.processTick(['kid'], makeDeps(at(MONDAY, 9)), [], result());

        const status = brain.statusOf('kid');
        const instance = brain.getActionEngine().getInstance(status.activeActionInstanceId!)!;
        expect(instance.defId).toBe('attend_school');
        expect(instance.locationOverride).toBe('building:5-5');
        expect(instance.status).toBe('running'); // bootstrap: the transition resolved instantly
        const started = engine.getPersonLog('kid').find(e => e.kind === 'event' && e.defId === 'school_day_started');
        expect(started?.triggerSource).toBe('action');
    });

    test('weekends and out-of-window hours propose nothing', () => {
        const { brain, makeDeps } = harness(() => SCHOOL);
        brain.processTick(['kid'], makeDeps(at(SATURDAY, 10)), [], result());
        expect(brain.getActionEngine().activeInstanceOf('kid')?.defId).not.toBe('attend_school');

        const { brain: brain2, makeDeps: makeDeps2 } = harness(() => SCHOOL);
        brain2.processTick(['kid'], makeDeps2(at(MONDAY, 6)), [], result());
        expect(brain2.getActionEngine().activeInstanceOf('kid')?.defId).not.toBe('attend_school');
    });

    test('no valid assignment → normal free-time behavior, never attend_school', () => {
        const { brain, makeDeps } = harness(() => null);
        brain.processTick(['kid'], makeDeps(at(MONDAY, 9)), [], result());
        expect(brain.getActionEngine().activeInstanceOf('kid')?.defId).not.toBe('attend_school');
    });

    test('the obligation displaces leisure and ends with the session', () => {
        const { brain, makeDeps } = harness(() => SCHOOL);
        // 06:00: free time first.
        brain.processTick(['kid'], makeDeps(at(MONDAY, 6)), [], result());
        const before = brain.getActionEngine().activeInstanceOf('kid');
        expect(before?.defId).not.toBe('attend_school');

        // 08:00: school starts and interrupts the leisure activity.
        brain.processTick(['kid'], makeDeps(at(MONDAY, 8)), [], result());
        expect(brain.getActionEngine().activeInstanceOf('kid')?.defId).toBe('attend_school');
    });
});

describe('the school day credit (per-day, both lifecycle paths)', () => {
    async function runDay(hours: number[], schoolOf: (id: string) => SchoolFacts | null, harnessed = harness(schoolOf)) {
        const { engine, actions, brain, world, state } = harnessed;
        for (const hour of hours) {
            await runTick({
                engine, actionEngine: actions, brain,
                state, agentIds: ['kid'], tick: at(MONDAY, hour), ticksPerYear: TPY,
                ctx: { mode: 'bootstrap', world },
                schoolOf,
            });
        }
        return harnessed;
    }

    test('a full school day completes at the end hour and commits exactly one credit', async () => {
        const schoolOf = () => SCHOOL;
        const { engine } = await runDay([8, 9, 10, 11, 12, 13, 14], schoolOf);
        const log = engine.getPersonLog('kid');
        expect(log.filter(e => e.kind === 'event' && e.defId === 'school_day_started')).toHaveLength(1);
        const credits = log.filter(e => e.kind === 'event' && e.defId === 'completed_school_day');
        expect(credits).toHaveLength(1);
        expect(credits[0]!.tick).toBe(at(MONDAY, 14)); // completeWhen hourOfDay >= 14
        // The action completed (not interrupted): its final lifecycle entry says so.
        const lifecycle = log.filter(e => e.kind === 'action' && e.defId === 'attend_school');
        expect(lifecycle.some(e => (e as { lifecycle?: string }).lifecycle === 'completed')).toBe(true);
    });

    test('interrupt + resume in one day still yields exactly one credit (perDay limit)', async () => {
        const schoolOf = () => SCHOOL;
        const fixture = harness(schoolOf);
        await runDay([8, 9], schoolOf, fixture);
        // Mid-morning interruption (whatever the cause — the engine's completion-request primitive).
        const active = fixture.actions.activeInstanceOf('kid')!;
        fixture.actions.interrupt(active.id, { source: 'system', causationId: null }, fixture.makeDeps(at(MONDAY, 10)), result());
        // Resume through the hook and finish the day, then run past the fallback window.
        await runDay([10, 11, 12, 13, 14, 15, 16, 17], schoolOf, fixture);

        const log = fixture.engine.getPersonLog('kid');
        expect(log.filter(e => e.kind === 'event' && e.defId === 'completed_school_day')).toHaveLength(1);
        expect(log.filter(e => e.kind === 'event' && e.defId === 'school_day_started')).toHaveLength(1); // perDay
    });

    test('an unresolved school day is closed once by the automated fallback', async () => {
        // The child starts school, then the assignment vanishes mid-day (school closed) and nothing resumes.
        let assigned = true;
        const schoolOf = () => (assigned ? SCHOOL : null);
        const fixture = harness(schoolOf);
        await runDay([8, 9], schoolOf, fixture);
        assigned = false;
        const active = fixture.actions.activeInstanceOf('kid')!;
        fixture.actions.interrupt(active.id, { source: 'system', causationId: null }, fixture.makeDeps(at(MONDAY, 10)), result());
        // The afterEvent(school_day_started, +8) rule fires at 16:00 and closes the day exactly once.
        await runDay([10, 11, 12, 13, 14, 15, 16, 17], schoolOf, fixture);

        const log = fixture.engine.getPersonLog('kid');
        const credits = log.filter(e => e.kind === 'event' && e.defId === 'completed_school_day');
        expect(credits).toHaveLength(1);
        expect(credits[0]!.tick).toBe(at(MONDAY, 16));
        expect(credits[0]!.triggerSource).toBe('schedule');
    });
});
