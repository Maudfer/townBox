import SkillBook from 'game/skills/SkillBook';
import SkillRegistry from 'game/skills/SkillRegistry';

// The education-event skill adapter (task 032/059): lets `acquireSkill` effects grant real proficiency
// without EventEngine importing SkillBook directly. Grant-to-at-least semantics: a no-op re-grant returns
// false (mirrors the old dedupe behavior); a genuine gain also tops up unmet prerequisites.

describe('SkillRegistry (game/skills/SkillRegistry)', () => {
    test('grants a skill up to the given floor and reports success', () => {
        const skillBook = new SkillBook();
        const registry = new SkillRegistry(skillBook, 5);

        const changed = registry.acquireSkill('p', 'biology', 30);
        expect(changed).toBe(true);
        expect(skillBook.proficiency('p', 'biology')).toBe(30);
        expect(skillBook.skillsOf('p')['biology']!.firstAcquiredTick).toBe(5);
    });

    test('defaults the floor to 25 when none is supplied', () => {
        const skillBook = new SkillBook();
        const registry = new SkillRegistry(skillBook, 0);

        expect(registry.acquireSkill('p', 'reading')).toBe(true);
        expect(skillBook.proficiency('p', 'reading')).toBe(25);
    });

    test('already-there is a harmless no-op: returns false and does not lower/touch the record', () => {
        const skillBook = new SkillBook();
        skillBook.grant('p', 'biology', { toAtLeast: 50 }, 0, 'test');
        const registry = new SkillRegistry(skillBook, 10);

        expect(registry.acquireSkill('p', 'biology', 30)).toBe(false); // 50 already >= 30
        expect(skillBook.proficiency('p', 'biology')).toBe(50); // untouched
    });

    test('teaches unmet prerequisites too (grantWithPrerequisites path)', () => {
        const skillBook = new SkillBook();
        const registry = new SkillRegistry(skillBook, 12);

        expect(registry.acquireSkill('p', 'suture_wounds', 10)).toBe(true);
        expect(skillBook.proficiency('p', 'suture_wounds')).toBe(10);
        // Prerequisites (physical_coordination 25, biology 20, use_sterile_equipment 15) got topped up too.
        expect(skillBook.proficiency('p', 'physical_coordination')).toBeGreaterThanOrEqual(25);
        expect(skillBook.proficiency('p', 'biology')).toBeGreaterThanOrEqual(20);
        expect(skillBook.proficiency('p', 'use_sterile_equipment')).toBeGreaterThanOrEqual(15);
    });

    test('an unknown skill fails the grant and returns false', () => {
        const skillBook = new SkillBook();
        const registry = new SkillRegistry(skillBook, 0);
        expect(registry.acquireSkill('p', 'not_a_real_skill', 10)).toBe(false);
        expect(skillBook.hasAny('p')).toBe(false);
    });

    test('stamps records with the shared tick and the "event" provenance', () => {
        const skillBook = new SkillBook();
        const registry = new SkillRegistry(skillBook, 42);
        registry.acquireSkill('p', 'math', 15);
        const record = skillBook.skillsOf('p')['math']!;
        expect(record.lastProgressedTick).toBe(42);
        expect(record.provenance).toContain('event');
    });
});
