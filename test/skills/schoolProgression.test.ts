import SkillBook, { DEFAULT_SKILL_MANIFEST } from 'game/skills/SkillBook';
import SkillProgression from 'game/skills/SkillProgression';
import Brain from 'game/actions/Brain';
import ActionEngine from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { runTick } from 'game/execution/TickRunner';

import { countSchoolDays, isSchoolDay, schoolDailyGain, schoolFactsFor, totalEligibleSchoolDays, SCHOOL_BASIC_CAP } from 'util/school';
import { dayOfTick, TICKS_PER_DAY, TICKS_PER_YEAR } from 'util/time';

import { SchoolConfig } from 'types/School';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';

import schoolsConfig from 'json/schools.json';

// School-day skill progression (task 063): the calendar-exact 60-at-18 contract, the once-per-day credit,
// the school cap, and the shared-spine integration (attend_school completing → basics gaining, both modes).

const SCHOOL = schoolsConfig as unknown as SchoolConfig;
const BASICS = Object.keys(DEFAULT_SKILL_MANIFEST).filter(id => DEFAULT_SKILL_MANIFEST[id]!.basic);

function person(id: string, birthTick: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function state(people: GenPerson[]): PopulationState {
    return { worldSeed: 7, people: Object.fromEntries(people.map(p => [p.id, p])), drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

// Feed the service one synthetic completed-school-day commit per school day in [fromDay, toDay).
function attendEveryday(service: SkillProgression, pool: PopulationState, personId: string, fromDay: number, toDay: number): number {
    let credited = 0;
    for (let day = fromDay; day < toDay; day++) {
        if (!isSchoolDay(SCHOOL, day)) {
            continue;
        }
        service.processCommits([{ personId, eventId: 'completed_school_day', seq: credited }], pool, day * TICKS_PER_DAY + 14);
        credited++;
    }
    return credited;
}

describe('the exact-60-at-18 contract', () => {
    // Different birth weekdays give slightly different eligible-day counts (360/7 drift); the contract must
    // hold exactly for all of them.
    test.each([0, 1 * TICKS_PER_DAY, 3 * TICKS_PER_DAY, 6 * TICKS_PER_DAY])('perfect attendance from 7 to 18 lands every basic at exactly 60 (birthTick %i)', birthTick => {
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const pool = state([person('kid', birthTick)]);

        const startDay = dayOfTick(birthTick + SCHOOL.minAgeYears * TICKS_PER_YEAR);
        const endDay = dayOfTick(birthTick + (SCHOOL.maxAgeYears + 1) * TICKS_PER_YEAR);
        const credited = attendEveryday(service, pool, 'kid', startDay, endDay);

        expect(credited).toBe(totalEligibleSchoolDays(SCHOOL, birthTick));
        for (const basic of BASICS) {
            expect(skillBook.proficiency('kid', basic)).toBeCloseTo(SCHOOL_BASIC_CAP, 6);
        }
    });

    test('missed days end lower; late starters are never normalized up', () => {
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const pool = state([person('kid', 0)]);
        const startDay = dayOfTick(SCHOOL.minAgeYears * TICKS_PER_YEAR);
        const endDay = dayOfTick((SCHOOL.maxAgeYears + 1) * TICKS_PER_YEAR);

        // Attends only the first half of their school career, then never again.
        const midDay = Math.floor((startDay + endDay) / 2);
        attendEveryday(service, pool, 'kid', startDay, midDay);
        const half = skillBook.proficiency('kid', 'math');
        expect(half).toBeGreaterThan(25);
        expect(half).toBeLessThan(35); // ≈ half the cap, not 60

        // Time passing without attendance changes nothing.
        service.processCommits([], pool, endDay * TICKS_PER_DAY);
        expect(skillBook.proficiency('kid', 'math')).toBe(half);
    });

    test('the gain is person-specific and calendar-exact', () => {
        const gainA = schoolDailyGain(SCHOOL, 0);
        expect(gainA * totalEligibleSchoolDays(SCHOOL, 0)).toBeCloseTo(SCHOOL_BASIC_CAP, 9);
        // The 52-weeks anchor: the real rate is in the same ballpark as 60/2860 ≈ 0.020979.
        expect(gainA).toBeGreaterThan(0.018);
        expect(gainA).toBeLessThan(0.024);
    });
});

describe('credit guards and the cap', () => {
    test('a duplicate commit in one calendar day awards exactly one credit', () => {
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const pool = state([person('kid', 0)]);
        const tick = dayOfTick(10 * TICKS_PER_YEAR) * TICKS_PER_DAY + 14;

        service.processCommits([
            { personId: 'kid', eventId: 'completed_school_day', seq: 1 },
            { personId: 'kid', eventId: 'completed_school_day', seq: 2 },
        ], pool, tick);
        const once = skillBook.proficiency('kid', 'math');
        expect(once).toBeCloseTo(schoolDailyGain(SCHOOL, 0), 9);

        // Same day, later tick (interrupt/resume shape) — still one credit.
        service.processCommits([{ personId: 'kid', eventId: 'completed_school_day', seq: 3 }], pool, tick + 2);
        expect(skillBook.proficiency('kid', 'math')).toBe(once);
    });

    test('school progression never pushes a basic past the cap', () => {
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const pool = state([person('kid', 0)]);
        skillBook.grant('kid', 'math', { toAtLeast: SCHOOL_BASIC_CAP - 0.001 }, 0, 'test');
        skillBook.grant('kid', 'music', { toAtLeast: 80 }, 0, 'test'); // beyond the cap by another source

        service.processCommits([{ personId: 'kid', eventId: 'completed_school_day', seq: 1 }], pool, 100 * TICKS_PER_DAY);
        expect(skillBook.proficiency('kid', 'math')).toBe(SCHOOL_BASIC_CAP); // clamped to exactly 60
        expect(skillBook.proficiency('kid', 'music')).toBe(80); // untouched — school never lowers/limits others
    });

    test('unrelated events award nothing', () => {
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const pool = state([person('kid', 0)]);
        service.processCommits([{ personId: 'kid', eventId: 'woke_up', seq: 1 }], pool, 10);
        expect(skillBook.hasAny('kid')).toBe(false);
    });
});

describe('shared-spine integration (mode-identical by construction)', () => {
    test('a full attend_school day through runTick converts into basic-skill proficiency with school provenance', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook);
        const birthTick = -10 * TICKS_PER_YEAR; // a 10-year-old at tick 0
        const pool = state([person('kid', birthTick)]);
        const schoolOf = () => schoolFactsFor(SCHOOL, '5-5');

        for (const hour of [8, 9, 10, 11, 12, 13, 14]) {
            await runTick({
                engine, actionEngine: actions, brain,
                state: pool, agentIds: ['kid'], tick: hour, ticksPerYear: TICKS_PER_YEAR, // tick 8.. = Monday 08:00..
                ctx: { mode: 'bootstrap', world },
                schoolOf, skillProgression: service,
            });
        }

        const gain = schoolDailyGain(SCHOOL, birthTick);
        for (const basic of BASICS) {
            expect(skillBook.proficiency('kid', basic)).toBeCloseTo(gain, 9);
            expect(skillBook.skillsOf('kid')[basic]!.provenance).toContain('school');
        }
        // countSchoolDays sanity: exactly one school day covered.
        expect(countSchoolDays(SCHOOL, 0, 1)).toBe(1);
    });
});
