// The skill model (tasks 059–062). Skills are no longer a closed boolean enum: json/skills.json is a
// manifest of SkillDefinitions with an NPM-style dependency DAG (flat in the file, compiled into a graph —
// the EventCompiler pattern), and people hold PROFICIENCY-bearing records (0 < p <= 100) in a central,
// personId-keyed store (game/SkillBook.ts — the Inventory/LifeLog pattern, so records survive
// de/re-materialization and work off-map).
//
// Naming contract (validator-enforced): skill ids are snake_case SPECIFIC ABILITIES (`suture_wounds`), never
// fields of study and never `...Skill` — EXCEPT `basic: true` skills (what school teaches everyone), which
// may use field-of-study names (`biology`) and must have no dependencies.
//
// Proficiency vision (059): 60.0 is the "educated baseline" (perfect school attendance caps basics at 60,
// task 063); the band above is career/talent territory — a working musician needs ~80 music, a famous one
// ~95. Future systems differentiate within it; nothing may accidentally overflow 100.

import { PersonId } from 'types/Genealogy';

export interface SkillDependency {
    skill: string;
    minProficiency: number; // (0, 100]
}

export interface SkillDefinition {
    label: string;
    basic?: boolean; // a broadly-taught school foundation (fields-of-study names allowed, no dependencies)
    dependencies?: SkillDependency[]; // multiple prerequisites allowed — the graph is a DAG, not a tree
    tags?: string[]; // family + consumption tags ('flavor' marks initialization-pool-only skills, 061)
}

export type SkillManifest = Record<string, SkillDefinition>;

// Why a person has a skill (059): enough provenance to explain the record. Entries are compact typed
// strings — e.g. 'initialization', 'school', 'job:doctor', 'trainingGrant:doctor', 'event:trade_school'.
export type SkillProvenance = string;

export interface PersonSkillRecord {
    proficiency: number; // 0 < p <= 100 (zero-proficiency records are never stored)
    firstAcquiredTick: number;
    lastProgressedTick: number;
    provenance: SkillProvenance[]; // deduped, in first-contribution order
}

export type PersonSkills = Record<string, PersonSkillRecord>; // keyed by skill id

// Serialized store state (WorldSnapshot.skillBook, save v10). `initialized` marks people whose one-time
// age-appropriate seeding (task 062) already ran, so it never re-runs across save/load or rematerialization.
export interface SkillBookState {
    records: Record<PersonId, PersonSkills>;
    initialized: Record<PersonId, true>;
}

// A per-person point-in-time skill snapshot (task 077 per-window snapshotting). The offline history generator
// records a timeline of these so asset selection can install each drawn person's skills AS OF the chosen
// window `w` — instead of an end-of-generation snapshot that over-states the living cohort's job proficiency.
export interface SkillSnapshot {
    tick: number;       // generator-relative tick the snapshot was taken at
    skills: PersonSkills;
}

// Per person, ascending by tick. Selection binary-picks the latest snapshot with tick <= w.
export type SkillTimeline = Record<PersonId, SkillSnapshot[]>;

// A grant amount: raise to at least a floor, or add an increment. Both clamp at 100.
export type SkillGrantAmount = { toAtLeast: number } | { add: number };

export interface SkillGrant {
    skill: string;
    amount: SkillGrantAmount;
}

// A requirement row shared by consumers (job ranks in 064, action requirements later).
export interface SkillRequirement {
    skill: string;
    minProficiency: number;
}

// Early-childhood milestone ladder + initialization tunables (json/skillInit.json, task 062).
export interface SkillMilestone {
    ageYears: number; // granted when a simulated child reaches this birthday (and seeded for older entrants)
    grants: { skill: string; toAtLeast: number }[];
}

export interface SkillInitParams {
    adultBasicProficiency: number; // adults enter detailed simulation with every basic at this level (60)
    milestones: SkillMilestone[]; // ages 1–6: a deliberately partial foundational ladder
    assortment: {
        // Specific-skill variety for initialized adults, biased by age band. Deterministic per
        // (worldSeed ^ personId); levels stay below `maxProficiency` (no unexplained masters).
        bands: { minAgeYears: number; minSkills: number; maxSkills: number }[];
        minProficiency: number;
        maxProficiency: number;
        jobCoreWeight: number; // skills referenced by jobs.json draw this weight (employability bias)
        flavorWeight: number; // everything else
    };
}
