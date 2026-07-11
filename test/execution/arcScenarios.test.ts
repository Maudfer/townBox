import SkillBook, { DEFAULT_SKILL_MANIFEST } from 'game/skills/SkillBook';
import SkillProgression from 'game/skills/SkillProgression';
import JobMarket from 'game/economy/JobMarket';
import Brain from 'game/actions/Brain';
import ActionEngine from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import LiveWorld from 'game/execution/LiveWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { generateBuildingObjects } from 'game/objects/ObjectGeneration';
import { runTick } from 'game/execution/TickRunner';
import Field from 'game/world/Field';
import GameManager from 'game/GameManager';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import Person from 'game/agents/Person';
import Building from 'game/world/Building';

import { isSchoolDay, schoolFactsFor, totalEligibleSchoolDays, SCHOOL_BASIC_CAP } from 'util/school';
import { dayOfTick, TICKS_PER_DAY, TICKS_PER_YEAR } from 'util/time';

import { SchoolConfig } from 'types/School';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';
import { JobPosition } from 'types/Work';
import { TickResult } from 'types/LifeEvent';
import { TilePosition, PixelPosition } from 'types/Position';

import schoolsConfig from 'json/schools.json';
import jobsConfig from 'json/jobs.json';
import residencesConfig from 'json/residences.json';

// The progression & context arc, end to end (task 075): the per-task suites prove each loop alone; THIS
// suite runs them together on one seeded fixture, catching cross-system interference — school → skills →
// grant-hire → work → promotion; tags → generation → requirements → possessions; consent; the negative
// paths; and the live ↔ bootstrap keystone equivalence 055's offline generator depends on.

const SCHOOL = schoolsConfig as unknown as SchoolConfig;
const BASICS = Object.keys(DEFAULT_SKILL_MANIFEST).filter(id => DEFAULT_SKILL_MANIFEST[id]!.basic);
const HOUSE_TAGS = (residencesConfig as { house: { tags: string[] } }).house.tags;

function gen(id: string, birthTick: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(people: GenPerson[], worldSeed = 21): PopulationState {
    return { worldSeed, people: Object.fromEntries(people.map(p => [p.id, p])), drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

// The jobRanks fixture field: a real Field without a Phaser scene.
function makeField(rows: number, cols: number): Field {
    const game = {
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return field;
}

function doctorPosition(): JobPosition {
    const doctor = (jobsConfig as Record<string, { title: string; salary: number; requiredSkills: string[]; shiftStart: number; shiftEnd: number }>)['doctor']!;
    return { title: doctor.title, salary: doctor.salary, requirements: doctor.requiredSkills, shiftStart: doctor.shiftStart, shiftEnd: doctor.shiftEnd };
}

describe('a life, fast-forwarded (school → grant-hire → work → promotion)', () => {
    test('one person carries one SkillBook through the whole arc', () => {
        // Born 18 years before tick 0 — school runs over the (negative-tick-safe) bootstrap past.
        const birthTick = -18 * TICKS_PER_YEAR;
        const skillBook = new SkillBook();
        const engine = new EventEngine();
        const service = new SkillProgression(skillBook);
        const world = pool([gen('p1', birthTick)]);

        // 1. School, 7 → 18, perfect attendance: exactly 60 in every basic (the calendar-exact contract).
        const startDay = dayOfTick(birthTick + SCHOOL.minAgeYears * TICKS_PER_YEAR);
        const endDay = dayOfTick(birthTick + (SCHOOL.maxAgeYears + 1) * TICKS_PER_YEAR);
        let seq = 0;
        for (let day = startDay; day < endDay; day++) {
            if (isSchoolDay(SCHOOL, day)) {
                service.processCommits([{ personId: 'p1', eventId: 'completed_school_day', seq: seq++ }], world, day * TICKS_PER_DAY + 14);
            }
        }
        expect(seq).toBe(totalEligibleSchoolDays(SCHOOL, birthTick));
        for (const basic of BASICS) {
            expect(skillBook.proficiency('p1', basic)).toBeCloseTo(SCHOOL_BASIC_CAP, 6);
        }

        // 2. Hired as a doctor at 18 via the entry training grant — the SAME skill book, no reseeding.
        const field = makeField(40, 40);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const clinic = field.loadStructure('work', 7, 7, 'w') as Workplace;
        clinic.setBusiness({ blueprintKey: 'clinic', name: 'Clinic', lineOfWork: 'Clinic', size: 1, positions: [doctorPosition()] });
        const person = field.loadPerson(72, 72);
        person.social.setPersonId('p1');
        person.social.setHome(home);
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 0);

        expect(market.canHire('p1')).toBe(true); // the CI reachability rule, honored at runtime
        expect(market.hire('p1')).toBe(true);
        const assignment = person.work.getJob()!;
        expect(assignment.rankId).toBe('entry');
        expect(skillBook.skillsOf('p1')['suture_wounds']!.provenance).toContain('trainingGrant:doctor');

        // 3. Work days accrue proficiency; the promotion fires at a rank-evaluation boundary.
        const deps = { engine, ticksPerYear: TICKS_PER_YEAR, assignmentOf: () => assignment };
        const signals: string[] = [];
        let promotedOnDay: number | null = null;
        for (let day = 1; day <= 2000 && promotedOnDay === null; day++) {
            const tickResult = service.processCommits([{ personId: 'p1', eventId: 'stopped_working', seq: 10000 + day }], world, day * TICKS_PER_DAY + 17, deps);
            signals.push(...tickResult.signals.map(signal => signal.signal));
            if (assignment.rankId !== 'entry') {
                promotedOnDay = day;
            }
        }
        expect(promotedOnDay).not.toBeNull();
        // The flip happened exactly on an evaluation boundary (every evaluateEveryWorkDays work days).
        const cadence = (jobsConfig as Record<string, { ranks: { entry?: boolean; promotion?: { evaluateEveryWorkDays?: number } }[] }>)['doctor']!
            .ranks.find(rank => rank.entry)!.promotion?.evaluateEveryWorkDays ?? 30;
        expect(promotedOnDay! % cadence).toBe(0);
        expect(assignment.workDaysInRank).toBe(0); // counters reset on the flip
        expect(assignment.totalWorkDays).toBe(promotedOnDay);

        // 4. The narration: got_promoted committed to the person log with the 'promoted' feed signal.
        expect(signals).toContain('promoted');
        const promotion = engine.getPersonLog('p1').find(entry => entry.kind === 'event' && entry.defId === 'got_promoted');
        expect(promotion).toBeDefined();
        expect(promotion!.tick).toBe(promotedOnDay! * TICKS_PER_DAY + 17);
    });
});

describe('objects live (tags → generation → requirements → possessions)', () => {
    function generatedHouse() {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const state = pool([gen('a', -30 * TICKS_PER_YEAR), gen('b', -28 * TICKS_PER_YEAR)]);
        const created = generateBuildingObjects({ anchorKey: '4-4', tags: HOUSE_TAGS, host: 'house', worldSeed: state.worldSeed, tick: 0 }, inventory);
        for (const id of ['a', 'b']) {
            world.register(id);
            world.requestTransition(id, { kind: 'building', key: '4-4' }, 0, null);
        }
        const deps = { state, tick: 100, ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap' as const, world }, eventEngine: engine, inventory };
        return { inventory, world, engine, actions, state, deps, created };
    }

    test('the generated house satisfies real activity requirements and grab moves real instances', () => {
        const { inventory, actions, engine, deps, created } = generatedHouse();
        expect(created).toBeGreaterThan(0);

        // The 070 essentials answer the 071 requirement queries at this location.
        const context = actions.contextFor('a', deps);
        for (const essential of ['stove', 'bed', 'bathtub']) {
            expect(context.objectAtLocation?.({ archetype: essential })).toBe(true);
        }

        // Grab a generated carryable: possession + ownership move, nothing is created or destroyed.
        const carryable = inventory.instancesAtLocation('building:4-4')
            .find(instance => (inventory.getArchetype(instance.archetypeId)!.flags as unknown as Record<string, boolean>)['carryable']);
        expect(carryable).toBeDefined();
        const totalBefore = Object.keys(inventory.getState().instances).length;
        expect(actions.startAction('a', 'grab', { object: carryable!.archetypeId }, cause, deps, result()).ok).toBe(true);
        expect(Object.keys(inventory.getState().instances).length).toBe(totalBefore); // conservation
        expect(inventory.carriesArchetype('a', carryable!.archetypeId)).toBe(true);
        // The parameterized generic event carries the payload into the log (067/068).
        const acquired = engine.getPersonLog('a').find(entry => entry.kind === 'event' && entry.defId === 'object_acquired');
        expect(acquired).toMatchObject({ params: { object: carryable!.archetypeId } });
    });

    test('a lend → return loop closes between residents; a consent decline mutates nothing', () => {
        const { inventory, actions, engine, deps } = generatedHouse();
        const watch = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });

        // Lend on a consenting tick (deterministic scan), then return.
        let lendTick = 100;
        while (!actions.startAction('a', 'lent_an_object', { target: 'b' }, cause, { ...deps, tick: lendTick }, result()).ok) {
            lendTick += 1; // consent declines simply retry next tick (cooldown is Brain-side, not engine-side)
        }
        expect(inventory.getInstance(watch.id)!.container).toEqual({ kind: 'possessions', personId: 'b' });
        expect(inventory.getInstance(watch.id)!.owner).toEqual({ kind: 'person', personId: 'a' });
        let returnTick = lendTick + 1;
        while (!actions.startAction('b', 'returned_borrowed_object', { target: 'a', object: watch.id }, cause, { ...deps, tick: returnTick }, result()).ok) {
            returnTick += 1;
        }
        expect(inventory.getInstance(watch.id)!.container).toEqual({ kind: 'possessions', personId: 'a' });

        // A declined give changes NOTHING: full inventory fingerprint identical, and the attempt is on record.
        let declineTick = returnTick + 1;
        const { evaluateConsent } = jest.requireActual<typeof import('game/actions/Consent')>('game/actions/Consent');
        while (evaluateConsent({ actionId: 'gave_object_to_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: declineTick, worldSeed: deps.state.worldSeed })) {
            declineTick += 1;
        }
        const before = JSON.stringify(inventory.getState());
        expect(actions.startAction('a', 'gave_object_to_person', { target: 'b' }, cause, { ...deps, tick: declineTick }, result()))
            .toEqual({ ok: false, reason: 'consentDeclined' });
        expect(JSON.stringify(inventory.getState())).toBe(before);
        expect(actions.hasAction('a', 'gave_object_to_person', declineTick, { withinTicks: 0 })).toBe(true); // no instant retry
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'action_declined')).toBe(true);
    });
});

describe('negative paths', () => {
    test('an unassigned child gets no school progression and no attend_school', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const state = pool([gen('kid', -10 * TICKS_PER_YEAR)]);
        world.register('kid');

        for (const hour of [8, 9, 10, 11, 12, 13, 14]) {
            await runTick({
                engine, actionEngine: actions, brain,
                state, agentIds: ['kid'], tick: hour, ticksPerYear: TICKS_PER_YEAR,
                ctx: { mode: 'bootstrap', world },
                schoolOf: () => null, // no valid assignment — no silent auto-schooling
                skillProgression: service,
            });
        }
        expect(skillBook.hasAny('kid')).toBe(false);
        expect(engine.getPersonLog('kid').some(entry => entry.kind === 'action' && entry.defId === 'attend_school')).toBe(false);
    });

    test('an unqualified candidate is not hireable into a skilled profession, then is after school', () => {
        const field = makeField(40, 40);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const clinic = field.loadStructure('work', 7, 7, 'w') as Workplace;
        clinic.setBusiness({ blueprintKey: 'clinic', name: 'Clinic', lineOfWork: 'Clinic', size: 1, positions: [doctorPosition()] });
        const person = field.loadPerson(72, 72);
        person.social.setPersonId('p1');
        person.social.setHome(home);
        const skillBook = new SkillBook();
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 0);

        // No basics at all: the entry grant assumes the school baseline; the candidate is skipped, unharmed.
        expect(market.canHire('p1')).toBe(false);
        expect(skillBook.hasAny('p1')).toBe(false); // evaluation farmed nothing

        // The school baseline makes every entry rank reachable (the CI-enforced contract, at runtime).
        for (const basic of BASICS) {
            skillBook.grant('p1', basic, { toAtLeast: 60 }, 0, 'school');
        }
        expect(market.canHire('p1')).toBe(true);
    });
});

describe('live ↔ bootstrap equivalence (the keystone for 055)', () => {
    // The same 5-school-day scenario under both adapters. Live materialization: the fake commute delivers
    // the kid to school one pump later, so live 'started' entries lag bootstrap's — the ACCEPTED divergence.
    // What must be identical after materialization differences resolve: completed school days, skill records.
    const BIRTH = -10 * TICKS_PER_YEAR;

    async function runMode(mode: 'bootstrap' | 'live') {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const state = pool([gen('kid', BIRTH)], 33);

        let world: BootstrapWorld | LiveWorld;
        let pump: (tick: number) => void = () => {};
        if (mode === 'bootstrap') {
            const bootstrap = new BootstrapWorld(inventory);
            bootstrap.register('kid');
            world = bootstrap;
        } else {
            const fakeBuilding = (key: string): Building => ({ getIdentifier: () => key } as unknown as Building);
            const homeBuilding = fakeBuilding('1-1');
            const schoolBuilding = fakeBuilding('5-5');
            const current = { value: homeBuilding as Building | null };
            const kid = {
                social: { getPersonId: () => 'kid', getHome: () => homeBuilding },
                getCurrentBuilding: () => current.value,
            } as unknown as Person;
            const live = new LiveWorld({
                getPeople: () => [kid],
                buildingByKey: key => (key === '5-5' ? schoolBuilding : key === '1-1' ? homeBuilding : null),
                startCommute: (_who, destination) => { current.value = destination; }, // arrival on the NEXT pump
                getInventory: () => inventory,
            });
            world = live;
            pump = tick => live.pump(tick);
        }

        for (let tick = 0; tick < 5 * 24; tick++) {
            pump(tick);
            await runTick({
                engine, actionEngine: actions, brain,
                state, agentIds: ['kid'], tick, ticksPerYear: TICKS_PER_YEAR,
                ctx: { mode, world },
                schoolOf: () => schoolFactsFor(SCHOOL, '5-5'),
                skillProgression: service,
            });
        }
        const log = engine.getPersonLog('kid');
        return {
            skills: skillBook.skillsOf('kid'),
            completedDays: log.filter(entry => entry.kind === 'event' && entry.defId === 'completed_school_day').length,
            startTicks: log.filter(entry => entry.kind === 'action' && entry.defId === 'attend_school' && entry.lifecycle === 'started').map(entry => entry.tick),
        };
    }

    test('skill outcomes are identical; the only divergence is the documented arrival-tick offset', async () => {
        const bootstrap = await runMode('bootstrap');
        const live = await runMode('live');

        // Five weekdays attended in both modes, same proficiency records to the last bit.
        expect(bootstrap.completedDays).toBe(5);
        expect(live.completedDays).toBe(5);
        expect(live.skills).toEqual(bootstrap.skills);

        // The accepted divergence: live starts each school day >= the bootstrap tick (commute latency),
        // never earlier, and both attend every school day.
        expect(live.startTicks.length).toBe(bootstrap.startTicks.length);
        for (let i = 0; i < live.startTicks.length; i++) {
            expect(live.startTicks[i]!).toBeGreaterThanOrEqual(bootstrap.startTicks[i]!);
            expect(dayOfTick(live.startTicks[i]!)).toBe(dayOfTick(bootstrap.startTicks[i]!)); // same school day
        }
    });
});

describe('performance & snapshot budgets (recorded re-pins)', () => {
    test('the full arc spine stays inside the hourly tick budget', async () => {
        const AGENTS = 60;
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const people: GenPerson[] = [];
        for (let i = 0; i < AGENTS; i++) {
            people.push(gen(`p${i}`, -(20 + (i % 40)) * TICKS_PER_YEAR));
            world.register(`p${i}`);
        }
        const state = pool(people, 55);
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const agentIds = people.map(p => p.id);

        // Warm-up (compilation paths), then the measured window.
        await runTick({ engine, actionEngine: actions, brain, inventory, state, agentIds, tick: 0, ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap', world }, skillProgression: service });
        const TICKS = 48;
        const began = performance.now();
        for (let tick = 1; tick <= TICKS; tick++) {
            await runTick({ engine, actionEngine: actions, brain, inventory, state, agentIds, tick, ticksPerYear: TICKS_PER_YEAR, ctx: { mode: 'bootstrap', world }, skillProgression: service });
        }
        const perTick = (performance.now() - began) / TICKS;
        console.info(`[arc bench] ${perTick.toFixed(2)}ms per tick (${AGENTS} agents, full spine: events+actions+brain+social+progression)`);
        // Coarse regression guard in the eventEligibility style: generous for noisy runners, loud if the
        // arc's added hooks (social scan, progression) regress an order of magnitude.
        expect(perTick).toBeLessThan(150);
    });

    test('generated-object snapshot growth stays inside the 070 cap', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const houses = 10;
        for (let i = 0; i < houses; i++) {
            const created = generateBuildingObjects({ anchorKey: `${i}-${i}`, tags: HOUSE_TAGS, host: 'house', worldSeed: 21, tick: 0 }, inventory);
            expect(created).toBeLessThanOrEqual(40); // json/objectGeneration.json perBuildingCap
        }
        const snapshot = JSON.stringify(inventory.getState());
        const perHouse = snapshot.length / houses;
        console.info(`[arc bench] generated objects: ~${Math.round(perHouse)} bytes/house snapshot share (${houses} houses, ${Object.keys(inventory.getState().instances).length} instances)`);
        expect(perHouse).toBeLessThan(25_000); // a house's object fill costs kilobytes, not megabytes
    });
});
