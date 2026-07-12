import SkillBook, { sortedSkillEntries } from 'game/skills/SkillBook';
import { SchoolConfig } from 'types/School';
import { SkillInitParams, SkillManifest } from 'types/Skill';

// Direct unit tests for the central skill store (tasks 059-062) that the `acquireSkill` life event effect
// writes through (via SkillRegistry, see lifeEvents.test.ts). Those tests cover the EventEngine <-> registry
// wiring; this file covers SkillBook's own dependency-gated grant machinery, atomic multi-grants, and the
// one-time age-appropriate initialization the population draw relies on — all load-bearing for the
// `acquireSkill` effect's real behavior (a bad grant here silently blocks graduation/promotion events).

const SKILLS: SkillManifest = {
    reading: { label: 'Reading', basic: true },
    writing: { label: 'Writing', basic: true },
    biology: { label: 'Biology' },
    nursing: { label: 'Nursing', dependencies: [{ skill: 'biology', minProficiency: 20 }] },
    surgery: { label: 'Surgery', dependencies: [{ skill: 'nursing', minProficiency: 40 }] },
};

function initParams(overrides: Partial<SkillInitParams> = {}): SkillInitParams {
    return {
        adultBasicProficiency: 60,
        milestones: [
            { ageYears: 1, grants: [{ skill: 'reading', toAtLeast: 5 }] },
            { ageYears: 5, grants: [{ skill: 'reading', toAtLeast: 10 }, { skill: 'writing', toAtLeast: 8 }] },
        ],
        assortment: {
            bands: [{ minAgeYears: 18, minSkills: 1, maxSkills: 2 }],
            minProficiency: 20,
            maxProficiency: 50,
            jobCoreWeight: 3,
            flavorWeight: 1,
        },
        ...overrides,
    };
}

const SCHOOL: SchoolConfig = {
    dayStartMinutes: 480,
    dayEndMinutes: 840,
    daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    minAgeYears: 7,
    maxAgeYears: 17,
    capacity: { mode: 'const', value: 10 },
};

function book(overrides: Partial<SkillInitParams> = {}): SkillBook {
    return new SkillBook(SKILLS, initParams(overrides), SCHOOL);
}

describe('SkillBook — grant()', () => {
    test('rejects an unknown skill', () => {
        const b = book();
        expect(b.grant('a', 'not_real', { toAtLeast: 10 }, 0, 'test')).toEqual({ ok: false, reason: 'unknownSkill' });
        expect(b.proficiency('a', 'not_real')).toBe(0);
    });

    test('rejects a grant whose dependency is unmet', () => {
        const b = book();
        expect(b.grant('a', 'nursing', { toAtLeast: 30 }, 0, 'test')).toEqual({ ok: false, reason: 'dependenciesUnmet' });
        expect(b.has('a', 'nursing')).toBe(false);
    });

    test('succeeds once the dependency is satisfied, and toAtLeast never lowers an existing value', () => {
        const b = book();
        expect(b.grant('a', 'biology', { toAtLeast: 25 }, 0, 'school')).toEqual({ ok: true });
        expect(b.grant('a', 'nursing', { toAtLeast: 30 }, 10, 'training')).toEqual({ ok: true });
        expect(b.proficiency('a', 'nursing')).toBe(30);

        // A lower toAtLeast is a no-op on the value but still records provenance and never rewinds the tick.
        b.grant('a', 'nursing', { toAtLeast: 10 }, 20, 'retry');
        expect(b.proficiency('a', 'nursing')).toBe(30);
        expect(b.skillsOf('a')['nursing']!.provenance).toEqual(['training', 'retry']);
        expect(b.skillsOf('a')['nursing']!.lastProgressedTick).toBe(10); // untouched by the no-op grant
    });

    test('an "add" amount increments and clamps at 100', () => {
        const b = book();
        b.grant('a', 'biology', { toAtLeast: 90 }, 0, 'x');
        b.grant('a', 'biology', { add: 50 }, 1, 'y');
        expect(b.proficiency('a', 'biology')).toBe(100);
    });

    test('a grant that resolves to <= 0 proficiency is never stored', () => {
        const b = book();
        expect(b.grant('a', 'biology', { add: -5 }, 0, 'x')).toEqual({ ok: true });
        expect(b.hasAny('a')).toBe(false);
        expect(b.has('a', 'biology')).toBe(false);
    });

    test('has() with a minimum floor vs bare positivity', () => {
        const b = book();
        b.grant('a', 'biology', { toAtLeast: 15 }, 0, 'x');
        expect(b.has('a', 'biology')).toBe(true); // any positive proficiency
        expect(b.has('a', 'biology', 20)).toBe(false);
        expect(b.has('a', 'biology', 10)).toBe(true);
    });

    test('meets() checks a whole requirement list', () => {
        const b = book();
        b.grant('a', 'biology', { toAtLeast: 30 }, 0, 'x');
        b.grant('a', 'reading', { toAtLeast: 5 }, 0, 'x');
        expect(b.meets('a', [{ skill: 'biology', minProficiency: 20 }, { skill: 'reading', minProficiency: 5 }])).toBe(true);
        expect(b.meets('a', [{ skill: 'biology', minProficiency: 40 }])).toBe(false);
    });
});

describe('SkillBook — grantClosure() atomicity', () => {
    test('a whole set validates against pre-state + in-set grants and applies in dependency order', () => {
        const b = book();
        const result = b.grantClosure('a', [
            { skill: 'surgery', amount: { toAtLeast: 50 } },
            { skill: 'nursing', amount: { toAtLeast: 40 } },
            { skill: 'biology', amount: { toAtLeast: 25 } },
        ], 5, 'trainingGrant:doctor');
        expect(result).toEqual({ ok: true });
        expect(b.proficiency('a', 'biology')).toBe(25);
        expect(b.proficiency('a', 'nursing')).toBe(40);
        expect(b.proficiency('a', 'surgery')).toBe(50);
    });

    test('one unsatisfiable grant aborts the WHOLE set with zero mutations', () => {
        const b = book();
        // surgery needs nursing>=40, but the set only grants nursing to 30 — dependenciesUnmet across the set.
        const result = b.grantClosure('a', [
            { skill: 'surgery', amount: { toAtLeast: 50 } },
            { skill: 'nursing', amount: { toAtLeast: 30 } },
            { skill: 'biology', amount: { toAtLeast: 25 } },
        ], 5, 'trainingGrant:doctor');
        expect(result).toEqual({ ok: false, reason: 'dependenciesUnmet' });
        expect(b.hasAny('a')).toBe(false); // nothing committed, not even biology
    });

    test('an unknown skill in the set aborts before any mutation', () => {
        const b = book();
        const result = b.grantClosure('a', [
            { skill: 'biology', amount: { toAtLeast: 25 } },
            { skill: 'ghost_skill', amount: { toAtLeast: 1 } },
        ], 5, 'x');
        expect(result).toEqual({ ok: false, reason: 'unknownSkill' });
        expect(b.hasAny('a')).toBe(false);
    });
});

describe('SkillBook — grantWithPrerequisites()', () => {
    test('recursively tops up the whole prerequisite chain', () => {
        const b = book();
        expect(b.grantWithPrerequisites('a', 'surgery', 50, 3, 'event:med_school')).toEqual({ ok: true });
        expect(b.proficiency('a', 'surgery')).toBe(50);
        expect(b.proficiency('a', 'nursing')).toBeGreaterThanOrEqual(40); // surgery's own dependency floor
        expect(b.proficiency('a', 'biology')).toBeGreaterThanOrEqual(20); // nursing's own dependency floor
    });

    test('rejects an unknown target skill', () => {
        const b = book();
        expect(b.grantWithPrerequisites('a', 'not_real', 50, 0, 'x')).toEqual({ ok: false, reason: 'unknownSkill' });
    });

    test('does not re-top-up a prerequisite already above its floor', () => {
        const b = book();
        b.grant('a', 'biology', { toAtLeast: 90 }, 0, 'x');
        b.grantWithPrerequisites('a', 'nursing', 40, 5, 'y');
        expect(b.proficiency('a', 'biology')).toBe(90); // untouched — already well above the 20 floor
    });
});

describe('SkillBook — applyMilestones()', () => {
    test('grants every milestone at or below the age, idempotently', () => {
        const b = book();
        b.applyMilestones('a', 4, 0); // only the age-1 milestone applies
        expect(b.proficiency('a', 'reading')).toBe(5);
        expect(b.has('a', 'writing')).toBe(false);

        b.applyMilestones('a', 6, 10); // now age-5 too, toAtLeast raises reading, adds writing
        expect(b.proficiency('a', 'reading')).toBe(10);
        expect(b.proficiency('a', 'writing')).toBe(8);
    });
});

describe('SkillBook — initialize() age bands', () => {
    test('is idempotent (a second call is a no-op even with different args)', () => {
        const b = book();
        b.initialize('a', 30, -30 * 8640, 0, 1, new Set());
        const before = JSON.stringify(b.skillsOf('a'));
        b.initialize('a', 5, -30 * 8640, 0, 1, new Set()); // would behave very differently if it ran
        expect(JSON.stringify(b.skillsOf('a'))).toBe(before);
        expect(b.isInitialized('a')).toBe(true);
    });

    test('newborns (age 0) start skill-less but ARE marked initialized', () => {
        const b = book();
        b.initialize('newborn', 0, 0, 0, 1, new Set());
        expect(b.hasAny('newborn')).toBe(false);
        expect(b.isInitialized('newborn')).toBe(true);
    });

    test('a toddler below school age gets only the milestone ladder', () => {
        const b = book();
        b.initialize('toddler', 4, -4 * 8640, 0, 1, new Set());
        expect(b.proficiency('toddler', 'reading')).toBe(5); // age-1 milestone only
        expect(b.has('toddler', 'biology')).toBe(false); // never in the milestone ladder
    });

    test('a school-age child gets synthesized attendance-based basics, capped at the school cap', () => {
        const b = book();
        // Birth far enough in the past that this 12-year-old has had years of (synthesized) schooling.
        const birthTick = -12 * 8640;
        b.initialize('kid', 12, birthTick, 0, 1, new Set());
        expect(b.proficiency('kid', 'reading')).toBeGreaterThan(0);
        expect(b.proficiency('kid', 'reading')).toBeLessThanOrEqual(60);
        // Both basics receive the same synthesized-attendance gain (toAtLeast never lowers a milestone floor).
        expect(b.proficiency('kid', 'writing')).toBeGreaterThanOrEqual(8); // the age-5 milestone floor
        expect(b.proficiency('kid', 'writing')).toBeLessThanOrEqual(60);
    });

    test('an adult gets every basic at the baseline plus a job-biased assortment of specifics', () => {
        const b = book();
        b.initialize('adult', 40, -40 * 8640, 0, 42, new Set(['surgery']));
        expect(b.proficiency('adult', 'reading')).toBe(60);
        expect(b.proficiency('adult', 'writing')).toBe(60);
        // The assortment draws 1-2 non-basic specifics (biology/nursing/surgery) within [20,50].
        const specifics = ['biology', 'nursing', 'surgery'].filter(id => b.has('adult', id));
        expect(specifics.length).toBeGreaterThanOrEqual(1);
        for (const id of specifics) {
            expect(b.proficiency('adult', id)).toBeGreaterThan(0);
            expect(b.proficiency('adult', id)).toBeLessThanOrEqual(50 + 0.1);
        }
    });

    test('an age band gap (no matching band) leaves the adult with basics only', () => {
        // minAgeYears 25 leaves ages 18-24 (past school, past the milestone ladder) with no assortment band.
        const b = book({ assortment: { bands: [{ minAgeYears: 25, minSkills: 1, maxSkills: 2 }], minProficiency: 20, maxProficiency: 50, jobCoreWeight: 3, flavorWeight: 1 } });
        b.initialize('young_adult', 20, -20 * 8640, 0, 1, new Set());
        expect(b.proficiency('young_adult', 'reading')).toBe(60); // basics still granted
        expect(b.has('young_adult', 'biology')).toBe(false); // no assortment band matched → no specifics
    });

    test('is deterministic for the same (worldSeed, personId)', () => {
        const a = book();
        const b = book();
        a.initialize('p1', 35, -35 * 8640, 0, 99, new Set());
        b.initialize('p1', 35, -35 * 8640, 0, 99, new Set());
        expect(a.skillsOf('p1')).toEqual(b.skillsOf('p1'));
    });
});

describe('SkillBook — serialization', () => {
    test('getState/loadState round-trips records and the initialized set', () => {
        const b = book();
        b.grant('a', 'biology', { toAtLeast: 33 }, 5, 'x');
        b.initialize('a', 40, -40 * 8640, 5, 1, new Set());

        const restored = book();
        restored.loadState(JSON.parse(JSON.stringify(b.getState())));
        expect(restored.skillsOf('a')).toEqual(b.skillsOf('a'));
        expect(restored.isInitialized('a')).toBe(true);
        // loadState deep-clones — mutating the restored copy must not affect the source's records.
        restored.grant('a', 'biology', { add: 1 }, 6, 'y');
        expect(restored.proficiency('a', 'biology')).not.toBe(b.proficiency('a', 'biology'));
    });

    test('getManifest exposes the compiled-against manifest', () => {
        const b = book();
        expect(b.getManifest()).toBe(SKILLS);
    });
});

describe('sortedSkillEntries()', () => {
    test('orders by descending proficiency, then id for ties', () => {
        const b = book();
        b.grant('a', 'reading', { toAtLeast: 10 }, 0, 'x');
        b.grant('a', 'writing', { toAtLeast: 10 }, 0, 'x');
        b.grant('a', 'biology', { toAtLeast: 40 }, 0, 'x');
        const sorted = sortedSkillEntries(b.skillsOf('a'));
        expect(sorted.map(([id]) => id)).toEqual(['biology', 'reading', 'writing']);
    });
});
