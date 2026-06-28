import { SeededRandom, hashStringToSeed } from 'util/random';
import { JobRequirements, SkillAssignmentParams } from 'types/Work';

import skillsConfig from 'json/skills.json';

export const DEFAULT_SKILL_PARAMS: SkillAssignmentParams = skillsConfig as SkillAssignmentParams;

// Deterministically assigns a small, varied skill set to a person (task 014). Pure: the same pool personId +
// world seed + age always yield the same skills, so a person's skills are stable across save/load and
// re-materialization without storing them on the genealogy record. Seeded from the world seed mixed with the
// personId (mirroring the business-seed pattern in City.setupBusiness), independent of placement order.
//
// Count depends on life stage: minors (below the working age) carry few/none; adults carry a small specialised
// set. Skills are drawn distinct, weighted by `params.weights`. Skill acquisition over time (education) is a
// later task (032) via WorkLife.addSkill.
export function assignSkills(
    personId: string,
    ageYears: number,
    worldSeed: number,
    params: SkillAssignmentParams = DEFAULT_SKILL_PARAMS
): JobRequirements[] {
    const rng = new SeededRandom((worldSeed ^ hashStringToSeed(personId)) >>> 0);

    const range = ageYears < params.workingAgeYears ? params.minor : params.adult;
    const count = rng.nextInt(range.minSkills, range.maxSkills);

    // Weighted draw without replacement: pick `count` distinct skills, each chosen with probability
    // proportional to its remaining weight.
    const pool = Object.entries(params.weights).map(([skill, weight]) => ({ skill, weight }));
    const chosen: JobRequirements[] = [];

    for (let i = 0; i < count && pool.length > 0; i++) {
        const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
        if (total <= 0) {
            break;
        }
        let roll = rng.next() * total;
        let index = 0;
        for (; index < pool.length - 1; index++) {
            roll -= pool[index]!.weight;
            if (roll < 0) {
                break;
            }
        }
        const [picked] = pool.splice(index, 1);
        if (picked) {
            chosen.push(picked.skill as JobRequirements);
        }
    }

    return chosen;
}
