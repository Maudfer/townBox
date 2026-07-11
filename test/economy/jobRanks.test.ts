import Field from 'game/world/Field';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import Person from 'game/agents/Person';
import JobMarket from 'game/economy/JobMarket';
import SkillBook from 'game/skills/SkillBook';
import GameManager from 'game/GameManager';
import { migrateSnapshot } from 'game/save/migrations';

import { validateJobsSemantics, validateJobsStructure } from 'game/data/validators/economyContent';
import { IssueCollector, SchemaRegistration, ValidationIssue } from 'game/data/registry';

import { PersonId } from 'types/Genealogy';
import { JobPosition } from 'types/Work';
import { WorldSnapshot } from 'types/Save';
import { PixelPosition, TilePosition } from 'types/Position';

import SkillProgression from 'game/skills/SkillProgression';
import EventEngine from 'game/events/EventEngine';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from 'util/time';
import { PopulationState } from 'types/Genealogy';
import { Genders } from 'types/Social';
import { JobTable } from 'types/Business';

import jobsConfig from 'json/jobs.json';
import skillsConfig from 'json/skills.json';

function structure(validate: SchemaRegistration['validateStructure'], data: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    validate(data, new IssueCollector('fixture', issues));
    return issues;
}

function semantics(validate: NonNullable<SchemaRegistration['validateSemantics']>, data: unknown, peers: Record<string, unknown>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    validate(data, peers, new IssueCollector('fixture', issues));
    return issues;
}

// Job ranks & entry-level training grants (task 064): the two-path hiring (strict rank match, then the
// explicit College-shortcut entry grant), farm-proofing, the abort path, the save migration, and the
// validator's keystone reachability rule — over the REAL jobs/skills manifests.

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

// A real doctor position (jobs.json shape): entry rank requires suture_wounds/take_patient_history/
// perform_basic_examination at 10, with a dependency-complete training grant.
function doctorPosition(): JobPosition {
    const doctor = (jobsConfig as Record<string, { title: string; salary: number; requiredSkills: string[]; shiftStart: number; shiftEnd: number }>)['doctor']!;
    return { title: doctor.title, salary: doctor.salary, requirements: doctor.requiredSkills, shiftStart: doctor.shiftStart, shiftEnd: doctor.shiftEnd };
}

function world(): { field: Field; home: House; clinic: Workplace; person: Person } {
    const field = makeField(40, 40);
    const home = field.loadStructure('house', 4, 4, 'h') as House;
    const clinic = field.loadStructure('work', 7, 7, 'w') as Workplace;
    clinic.setBusiness({ blueprintKey: 'clinic', name: 'Clinic', lineOfWork: 'Clinic', size: 1, positions: [doctorPosition()] });
    const person = field.loadPerson(72, 72);
    person.social.setPersonId('p1');
    person.social.setHome(home);
    return { field, home, clinic, person };
}

// A fresh graduate: every basic at the school baseline (60), no specifics.
function freshGraduate(skillBook: SkillBook, personId: PersonId): void {
    for (const [skillId, definition] of Object.entries(skillsConfig as Record<string, { basic?: boolean }>)) {
        if (definition.basic) {
            skillBook.grant(personId, skillId, { toAtLeast: 60 }, 0, 'school');
        }
    }
}

describe('the training shortcut (the temporary College stand-in)', () => {
    test('a fresh 18-year-old is hired into a skilled profession via the entry grant, applied atomically on hire', () => {
        const { field, person } = world();
        const skillBook = new SkillBook();
        freshGraduate(skillBook, 'p1');
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 500);

        expect(skillBook.has('p1', 'suture_wounds')).toBe(false);
        expect(market.canHire('p1')).toBe(true); // canBeHired reflects the shortcut path
        expect(market.hire('p1')).toBe(true);

        // The grant landed exactly the declared closure, with trainingGrant provenance, at hire time.
        expect(skillBook.proficiency('p1', 'suture_wounds')).toBeGreaterThanOrEqual(10);
        expect(skillBook.proficiency('p1', 'use_sterile_equipment')).toBeGreaterThanOrEqual(15);
        expect(skillBook.skillsOf('p1')['suture_wounds']!.provenance).toContain('trainingGrant:doctor');
        // The assignment records the ENTRY rank with zeroed counters.
        const job = person.work.getJob()!;
        expect(job.rankId).toBe('entry');
        expect(job.workDaysInRank).toBe(0);
        expect(job.totalWorkDays).toBe(0);
    });

    test('evaluation grants nothing: repeated canHire calls cannot farm skills', () => {
        const { field, person } = world();
        const skillBook = new SkillBook();
        freshGraduate(skillBook, 'p1');
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 500);

        for (let attempt = 0; attempt < 25; attempt++) {
            expect(market.canHire('p1')).toBe(true);
        }
        expect(skillBook.has('p1', 'suture_wounds')).toBe(false);
        expect(skillBook.has('p1', 'take_patient_history')).toBe(false);
    });

    test('weak basics make the closure unsatisfiable: the profession stays out of reach, without mutations', () => {
        const { field, person } = world();
        const skillBook = new SkillBook();
        // A dropout: basics far below the dependency thresholds (e.g. biology 20 needed by suture_wounds).
        for (const basic of ['math', 'reading', 'writing', 'speaking', 'biology', 'physical_coordination', 'chemistry']) {
            skillBook.grant('p1', basic, { toAtLeast: 8 }, 0, 'school');
        }
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 500);

        expect(market.canHire('p1')).toBe(false);
        expect(market.hire('p1')).toBe(false);
        expect(skillBook.has('p1', 'suture_wounds')).toBe(false); // zero mutations
    });
});

describe('the strict path', () => {
    test('an already-qualified candidate is hired without any grant', () => {
        const { field, person } = world();
        const skillBook = new SkillBook();
        freshGraduate(skillBook, 'p1');
        for (const skill of ['suture_wounds', 'take_patient_history', 'perform_basic_examination', 'use_sterile_equipment']) {
            skillBook.grantWithPrerequisites('p1', skill, 40, 0, 'test');
        }
        const before = JSON.stringify(skillBook.skillsOf('p1'));
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 500);

        expect(market.hire('p1')).toBe(true);
        expect(person.work.getJob()!.rankId).toBe('entry'); // only one rank exists pre-066
        expect(JSON.stringify(skillBook.skillsOf('p1'))).toBe(before); // strict path grants nothing
    });

    test('rank is not retained across employers: fire clears the assignment, skills persist', () => {
        const { field, person } = world();
        const skillBook = new SkillBook();
        freshGraduate(skillBook, 'p1');
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 500);
        expect(market.hire('p1')).toBe(true);

        market.fire('p1');
        expect(person.work.getJob()).toBeNull();
        expect(skillBook.proficiency('p1', 'suture_wounds')).toBeGreaterThanOrEqual(10); // experience carries
    });
});

describe('save migration (v10 → v11)', () => {
    test('existing employees default to their job\'s entry rank with zeroed counters', () => {
        const snapshot = {
            version: 10,
            city: { name: 'X', population: 1 },
            structures: [], vehicles: [], households: [],
            people: [{
                id: 'p_0', x: 0, y: 0, direction: 0, indoors: true,
                personId: 'p1', firstName: 'A', familyName: 'B', age: 30, birthTick: 0, gender: 'female',
                homeId: null, relationships: {}, vehicleId: null,
                job: doctorPosition(),
            }],
        } as unknown as WorldSnapshot;

        const migrated = migrateSnapshot(snapshot);
        expect(migrated.version).toBeGreaterThanOrEqual(11);
        expect(migrated.people[0]!.job!.rankId).toBe('entry');
        expect(migrated.people[0]!.job!.workDaysInRank).toBe(0);

        // Unknown titles (fixtures/legacy) stay rank-less and keep working via the boolean fallback.
        const custom = { ...snapshot, version: 10, people: [{ ...snapshot.people[0]!, job: { ...doctorPosition(), title: 'Mystery Job', rankId: undefined } }] } as unknown as WorldSnapshot;
        expect(migrateSnapshot(custom).people[0]!.job!.rankId).toBeUndefined();
    });
});

describe('rank validation (the keystone rules)', () => {
    const skills = skillsConfig as Record<string, unknown>;
    const baseJob = {
        title: 'T', salary: 100, shiftStart: 540, shiftEnd: 1020, daysOfWeek: ['mon'],
        workActions: { continuous: [{ action: 'doing_paperwork' }], discrete: [{ action: 'jotted_a_note' }] },
    };
    const actionsPeer = { doing_paperwork: { type: 'continuous' }, jotted_a_note: { type: 'discrete' } };

    test('exactly one entry rank is required', () => {
        const fixture = { t: { ...baseJob, requiredSkills: ['patrol_premises'], ranks: [
            { rankId: 'a', label: 'A', requires: [], progresses: [] },
            { rankId: 'b', label: 'B', requires: [], progresses: [] },
        ] } };
        expect(structure(validateJobsStructure, fixture).map(issue => issue.message).join('\n')).toMatch(/exactly one rank/);
    });

    test('grants outside the entry rank are rejected', () => {
        const fixture = { t: { ...baseJob, requiredSkills: ['patrol_premises'], ranks: [
            { rankId: 'entry', label: 'A', entry: true, requires: [], progresses: [] },
            { rankId: 'senior', label: 'B', requires: [], progresses: [], entryTrainingGrant: { grants: [] } },
        ] } };
        expect(structure(validateJobsStructure, fixture).map(issue => issue.message).join('\n')).toMatch(/ENTRY rank only/);
    });

    test('the fresh-graduate reachability rule catches an uncovered non-basic entry requirement', () => {
        const fixture = { t: { ...baseJob, requiredSkills: ['suture_wounds'], ranks: [
            { rankId: 'entry', label: 'A', entry: true, requires: [{ skill: 'suture_wounds', minProficiency: 10 }], progresses: [] },
        ] } };
        const output = semantics(validateJobsSemantics, fixture, { skills, actions: actionsPeer }).map(issue => issue.message).join('\n');
        expect(output).toMatch(/unreachable for a fresh graduate/);
    });

    test('an incomplete grant closure is caught', () => {
        const fixture = { t: { ...baseJob, requiredSkills: ['suture_wounds'], ranks: [
            { rankId: 'entry', label: 'A', entry: true,
              requires: [{ skill: 'suture_wounds', minProficiency: 10 }], progresses: [],
              // Grants suture_wounds but not its non-basic dependency use_sterile_equipment.
              entryTrainingGrant: { grants: [{ skill: 'suture_wounds', toProficiency: 10 }] } },
        ] } };
        const output = semantics(validateJobsSemantics, fixture, { skills, actions: actionsPeer }).map(issue => issue.message).join('\n');
        expect(output).toMatch(/closure must be complete/);
    });

    test('the shipped roster passes: every job has a reachable entry rank', () => {
        expect(structure(validateJobsStructure, jobsConfig)).toEqual([]);
        expect(semantics(validateJobsSemantics, jobsConfig, { skills, actions: undefined }).filter(issue => !issue.message.includes('unknown action'))).toEqual([]);
    });
});

describe('the full ladders (task 066)', () => {
    const JOBS = jobsConfig as unknown as JobTable;

    test('every job has 3-4 ranks, one entry, ascending primary thresholds, and a promotion cadence', () => {
        for (const [jobId, definition] of Object.entries(JOBS)) {
            expect(definition.ranks.length).toBeGreaterThanOrEqual(3);
            expect(definition.ranks.filter(rank => rank.entry).length).toBe(1);
            expect(definition.ranks[0]!.entry).toBe(true);
            expect(definition.ranks[0]!.promotion?.evaluateEveryWorkDays).toBe(30);
            // Primary requirements strictly ascend rung to rung.
            const primaries = definition.requiredSkills;
            let previousFloor = 0;
            for (const rank of definition.ranks) {
                const floors = rank.requires.filter(requirement => primaries.includes(requirement.skill)).map(requirement => requirement.minProficiency);
                const floor = Math.min(...floors);
                expect(floor).toBeGreaterThan(previousFloor - 1);
                previousFloor = Math.max(previousFloor, floor);
                void jobId;
            }
        }
    });

    test('the self-climbing validator rule trips on a rung nothing progresses toward', () => {
        const skills = skillsConfig as Record<string, unknown>;
        const fixture = { t: {
            title: 'T', salary: 100, shiftStart: 540, shiftEnd: 1020, daysOfWeek: ['mon'],
            workActions: { continuous: [{ action: 'doing_paperwork' }], discrete: [{ action: 'jotted_a_note' }] },
            requiredSkills: ['patrol_premises'],
            ranks: [
                { rankId: 'entry', label: 'A', entry: true,
                  requires: [{ skill: 'patrol_premises', minProficiency: 10 }],
                  progresses: [{ skill: 'patrol_premises', multiplier: 1 }],
                  entryTrainingGrant: { grants: [{ skill: 'patrol_premises', toProficiency: 10 }] } },
                { rankId: 'senior', label: 'B',
                  requires: [{ skill: 'patrol_premises', minProficiency: 25 }, { skill: 'weld_metal', minProficiency: 10 }],
                  progresses: [{ skill: 'patrol_premises', multiplier: 1 }] },
            ],
        } };
        const output = semantics(validateJobsSemantics, fixture, { skills, actions: { doing_paperwork: { type: 'continuous' }, jotted_a_note: { type: 'discrete' } } }).map(issue => issue.message).join(' | ');
        expect(output).toMatch(/self-climbing ladder rule/);
    });

    test('end-to-end on real data: grant hire -> daily work -> promotion up the doctor ladder', () => {
        const { field, person } = world();
        const skillBook = new SkillBook();
        freshGraduate(skillBook, 'p1');
        const market = new JobMarket(new Map([['p1', person]]), field, skillBook, 0);
        expect(market.hire('p1')).toBe(true); // via the entry grant

        const engine = new EventEngine();
        const service = new SkillProgression(skillBook);
        const pool: PopulationState = {
            worldSeed: 7, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0,
            people: { p1: { id: 'p1', firstName: 'A', familyName: 'B', gender: Genders.Female, birthTick: -30 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [] } },
        };
        const assignment = person.work.getJob()!;
        const deps = { engine, ticksPerYear: TICKS_PER_YEAR, assignmentOf: () => assignment };

        // Work daily; the entry->Resident rung needs primaries@25 (from 10: ~548 days) + read_lab_results@10
        // (x0.5 from 0: ~730 days) -> promotion lands at the first 30-day evaluation past both.
        let promotedOnDay = 0;
        for (let day = 1; day <= 900 && !promotedOnDay; day++) {
            service.processCommits([{ personId: 'p1', eventId: 'stopped_working', seq: day }], pool, day * TICKS_PER_DAY + 17, deps);
            if (assignment.rankId === 'rank2') {
                promotedOnDay = day;
            }
        }
        expect(promotedOnDay).toBeGreaterThan(500);
        expect(promotedOnDay).toBeLessThanOrEqual(780);
        expect(promotedOnDay % 30).toBe(0); // the deterministic cadence
        expect(assignment.workDaysInRank).toBe(0);
        expect(skillBook.proficiency('p1', 'suture_wounds')).toBeGreaterThanOrEqual(25);
        expect(engine.getPersonLog('p1').some(entry => entry.kind === 'event' && entry.defId === 'got_promoted')).toBe(true);
    });
});
