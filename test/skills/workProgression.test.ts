import SkillBook from 'game/skills/SkillBook';
import SkillProgression, { WORK_DAILY_GAIN } from 'game/skills/SkillProgression';
import EventEngine from 'game/events/EventEngine';

import { TICKS_PER_DAY, TICKS_PER_YEAR } from 'util/time';

import { GenPerson, PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';
import { JobPosition } from 'types/Work';
import { JobTable } from 'types/Business';
import { TickResult } from 'types/LifeEvent';

import schoolsConfig from 'json/schools.json';
import { SchoolConfig } from 'types/School';

// Job skill progression & rank promotion (task 065): the 100/3650 per-work-day rate, secondary multipliers,
// once-per-day credit (never per child action), the deterministic promotion cadence, and rank consumption.

const SCHOOL = schoolsConfig as unknown as SchoolConfig;

// A fixture ladder: welder -> senior welder. Primary weld_metal x1.0, secondary keep_service_records x0.25
// (basics-only dependency, so its prerequisite top-up never touches the primary).
const FIXTURE_JOBS = {
    welder: {
        title: 'Welder', salary: 1500,
        requiredSkills: ['weld_metal'],
        ranks: [
            {
                rankId: 'entry', label: 'Apprentice Welder', entry: true,
                requires: [{ skill: 'weld_metal', minProficiency: 10 }],
                progresses: [
                    { skill: 'weld_metal', multiplier: 1 },
                    { skill: 'keep_service_records', multiplier: 0.25 },
                ],
                promotion: { evaluateEveryWorkDays: 30 },
            },
            {
                rankId: 'senior', label: 'Senior Welder',
                requires: [{ skill: 'weld_metal', minProficiency: 12 }],
                progresses: [{ skill: 'weld_metal', multiplier: 1 }],
            },
        ],
        shiftStart: 540, shiftEnd: 1020, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
        workActions: { continuous: [{ action: 'doing_paperwork' }], discrete: [] },
    },
} as unknown as JobTable;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Male, birthTick: -30 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function state(): PopulationState {
    return { worldSeed: 7, people: { w: person('w') }, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

function harness() {
    const skillBook = new SkillBook();
    // A hired apprentice: prerequisites + the entry requirement (the 064 grant path would have done this).
    skillBook.grantWithPrerequisites('w', 'weld_metal', 10, 0, 'trainingGrant:welder');
    skillBook.grantWithPrerequisites('w', 'keep_service_records', 1, 0, 'trainingGrant:welder');
    const assignment: JobPosition = { title: 'Welder', salary: 1500, requirements: ['weld_metal'], shiftStart: 540, shiftEnd: 1020, rankId: 'entry', workDaysInRank: 0, totalWorkDays: 0 };
    const engine = new EventEngine(); // real manifest: got_promoted is manual with the promoted signal
    const service = new SkillProgression(skillBook, SCHOOL, FIXTURE_JOBS);
    const pool = state();
    const deps = { engine, ticksPerYear: TICKS_PER_YEAR, assignmentOf: () => assignment };
    const workDay = (day: number): TickResult =>
        service.processCommits([{ personId: 'w', eventId: 'stopped_working', seq: day }], pool, day * TICKS_PER_DAY + 17, deps);
    return { skillBook, assignment, service, pool, deps, workDay, engine };
}

describe('work-day skill progression (task 065)', () => {
    test('each completed work day awards 100/3650 to primaries and ×0.25 to secondaries', () => {
        const { skillBook, assignment, workDay } = harness();
        const basePrimary = skillBook.proficiency('w', 'weld_metal');
        const baseSecondary = skillBook.proficiency('w', 'keep_service_records');

        for (let day = 1; day <= 10; day++) {
            workDay(day);
        }
        expect(skillBook.proficiency('w', 'weld_metal')).toBeCloseTo(basePrimary + 10 * WORK_DAILY_GAIN, 9);
        expect(skillBook.proficiency('w', 'keep_service_records')).toBeCloseTo(baseSecondary + 10 * WORK_DAILY_GAIN * 0.25, 9);
        expect(assignment.totalWorkDays).toBe(10);
        expect(skillBook.skillsOf('w')['weld_metal']!.provenance).toContain('job:welder');
    });

    test('one credit per calendar day — extra child actions or duplicate closes award nothing more', () => {
        const { skillBook, service, pool, deps, workDay } = harness();
        const base = skillBook.proficiency('w', 'weld_metal');
        workDay(1);
        // Same day: a second stopped_working (fallback + manual double) and assorted flavor commits.
        service.processCommits([
            { personId: 'w', eventId: 'stopped_working', seq: 90 },
            { personId: 'w', eventId: 'jotted_a_note', seq: 91 },
        ], pool, 1 * TICKS_PER_DAY + 19, deps);
        expect(skillBook.proficiency('w', 'weld_metal')).toBeCloseTo(base + WORK_DAILY_GAIN, 9);
    });

    test('the ten-year contract: 3650 credited days take a primary from 0-ish to ~100 (clamped)', () => {
        const { skillBook, workDay } = harness();
        for (let day = 1; day <= 3650; day++) {
            workDay(day);
        }
        expect(skillBook.proficiency('w', 'weld_metal')).toBe(100); // 10 + 3650×(100/3650) clamps at 100
    });

    test('unemployed / rank-less assignments progress nothing', () => {
        const skillBook = new SkillBook();
        const service = new SkillProgression(skillBook, SCHOOL, FIXTURE_JOBS);
        const engine = new EventEngine();
        const rankless: JobPosition = { title: 'Welder', salary: 1, requirements: [], shiftStart: 0, shiftEnd: 1 };
        service.processCommits([{ personId: 'w', eventId: 'stopped_working', seq: 1 }], state(), TICKS_PER_DAY, { engine, ticksPerYear: TICKS_PER_YEAR, assignmentOf: () => rankless });
        service.processCommits([{ personId: 'w', eventId: 'stopped_working', seq: 2 }], state(), 2 * TICKS_PER_DAY, { engine, ticksPerYear: TICKS_PER_YEAR, assignmentOf: () => null });
        expect(skillBook.hasAny('w')).toBe(false);
    });
});

describe('promotion (task 065)', () => {
    test('at the 30-work-day evaluation, a qualified person is promoted: rank flips, counters reset, got_promoted + promoted signal', () => {
        const { skillBook, assignment, workDay, engine } = harness();
        // 10 + 30×WORK_DAILY_GAIN ≈ 10.82 < 12 — top up so the senior requirement is met by evaluation day.
        skillBook.grant('w', 'weld_metal', { toAtLeast: 12 }, 0, 'test');

        let promotedSignal = false;
        for (let day = 1; day <= 30; day++) {
            const extra = workDay(day);
            promotedSignal ||= extra.signals.some(signal => signal.signal === 'promoted');
        }
        expect(assignment.rankId).toBe('senior');
        expect(assignment.workDaysInRank).toBe(0);
        expect(assignment.totalWorkDays).toBe(30);
        expect(promotedSignal).toBe(true);
        expect(engine.getPersonLog('w').some(entry => entry.kind === 'event' && entry.defId === 'got_promoted')).toBe(true);
    });

    test('an unqualified person is evaluated and passed over; a later evaluation promotes once qualified', () => {
        const { skillBook, assignment, workDay } = harness();
        for (let day = 1; day <= 30; day++) {
            workDay(day);
        }
        // 10 + 30×0.0274 ≈ 10.8 < 12 → not promoted at day 30.
        expect(assignment.rankId).toBe('entry');
        expect(assignment.workDaysInRank).toBe(30);

        // Keep working: by day 90 the primary passed 12 → the day-90 evaluation promotes.
        for (let day = 31; day <= 90; day++) {
            workDay(day);
        }
        expect(skillBook.proficiency('w', 'weld_metal')).toBeGreaterThan(12);
        expect(assignment.rankId).toBe('senior');
    });

    test('the top rank has nowhere to go: evaluations are no-ops', () => {
        const { assignment, workDay } = harness();
        assignment.rankId = 'senior';
        for (let day = 1; day <= 60; day++) {
            workDay(day);
        }
        expect(assignment.rankId).toBe('senior');
        expect(assignment.workDaysInRank).toBe(60);
    });
});
