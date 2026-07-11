// Legacy skill migration mapping (task 061): pre-v10 saves stored boolean skills from the retired
// 16-member `JobRequirements` enum on each person. On load, people are re-initialized deterministically
// (SkillBook.initialize) and then each legacy skill is applied through this mapping — a small representative
// set of the family's specific abilities, granted WITH prerequisites (grantWithPrerequisites) so a person
// whose basics are below the dependency thresholds (e.g. a school-age child) still ends up dependency-valid.
// So a `MedicalSkill` person stays plausibly medical after the migration.

import SkillBook from 'game/skills/SkillBook';
import { PersonId } from 'types/Genealogy';

// Legacy enum value -> the specific skills it becomes, at this proficiency floor.
export const LEGACY_SKILL_GRANT_PROFICIENCY = 35;

export const LEGACY_SKILL_MAP: Record<string, string[]> = {
    RetailSkill: ['operate_cash_register', 'assist_customers'],
    LogisticsSkill: ['stock_shelves', 'track_inventory'],
    CleaningSkill: ['mop_and_sweep_floors', 'sanitize_surfaces'],
    ManagementSkill: ['coordinate_staff_schedules', 'delegate_tasks'],
    MedicalSkill: ['measure_vital_signs', 'take_patient_history'],
    TeachingSkill: ['plan_lessons', 'explain_concepts_clearly'],
    CookingSkill: ['chop_and_prep_ingredients', 'follow_recipes'],
    ConstructionSkill: ['carry_building_materials', 'mix_and_pour_concrete'],
    HospitalitySkill: ['greet_and_check_in_guests', 'serve_tables'],
    FinanceSkill: ['count_cash_accurately', 'process_transactions'],
    EngineeringSkill: ['read_technical_drawings', 'use_measuring_tools'],
    SecuritySkill: ['patrol_premises', 'monitor_security_cameras'],
    DrivingSkill: ['drive_delivery_van', 'plan_delivery_routes'],
    BeautySkill: ['cut_and_style_hair', 'do_manicures_and_pedicures'],
    MechanicalSkill: ['diagnose_mechanical_failure', 'replace_worn_parts'],
    FitnessSkill: ['demonstrate_exercises', 'design_workout_plans'],
};

// Applies one person's legacy skill list on top of their (already initialized) records. Unknown legacy ids
// are skipped silently — the mapping is exhaustive for shipped enum values, and anything else predates them.
export function applyLegacySkills(skillBook: SkillBook, personId: PersonId, legacySkills: string[], tick: number): void {
    for (const legacy of legacySkills) {
        for (const skill of LEGACY_SKILL_MAP[legacy] ?? []) {
            skillBook.grantWithPrerequisites(personId, skill, LEGACY_SKILL_GRANT_PROFICIENCY, tick, 'initialization');
        }
    }
}
