// The central skill store (tasks 059–062): proficiency-bearing skill records keyed by pool personId — the
// Inventory/LifeLog pattern, so records survive de/re-materialization and work off-map (bootstrap/055).
// Scene-free and serializable. Every mutation goes through grant(), which clamps at 100, never stores
// zero-proficiency records, records provenance, and is DEPENDENCY-GATED against the compiled manifest graph
// (util/skillGraph): a skill cannot gain proficiency unless its declared prerequisites are met. The one
// sanctioned exception is grantClosure() — an atomic multi-grant that validates the WHOLE closure against
// pre-state + in-set grants before committing anything (the training-grant primitive, task 064).
//
// initialize() is the one-time, age-appropriate seeding (task 062): newborns nothing; ages 1–6 the partial
// early-childhood milestone ladder; ages 7–17 synthesized full-attendance school proficiency (people who
// actually live through simulation earn theirs through task 063 instead and are never topped up); adults all
// basics at 60 plus a deterministic contextual assortment. Idempotent via the serialized `initialized` set.
// Determinism: seeded from (worldSeed ^ hash(personId)) — the assignSkills convention it replaces.

import schoolsConfig from 'json/schools.json';
import skillInitConfig from 'json/skillInit.json';
import skillsConfig from 'json/skills.json';
import { PersonId } from 'types/Genealogy';
import { SchoolConfig } from 'types/School';
import {
    PersonSkillRecord,
    PersonSkills,
    SkillBookState,
    SkillGrant,
    SkillGrantAmount,
    SkillInitParams,
    SkillManifest,
    SkillRequirement,
} from 'types/Skill';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { schoolDailyGain, countSchoolDays, SCHOOL_BASIC_CAP } from 'util/school';
import { compileSkills, CompiledSkills } from 'util/skillGraph';
import { dayOfTick, TICKS_PER_YEAR } from 'util/time';


export const DEFAULT_SKILL_MANIFEST = skillsConfig as unknown as SkillManifest;
export const DEFAULT_SKILL_INIT_PARAMS = skillInitConfig as unknown as SkillInitParams;

const MAX_PROFICIENCY = 100;

export type GrantResult = { ok: true } | { ok: false; reason: 'unknownSkill' | 'dependenciesUnmet' };

export default class SkillBook {
    private manifest: SkillManifest;
    private graph: CompiledSkills;
    private initParams: SkillInitParams;
    private schoolConfig: SchoolConfig;
    private records: Record<PersonId, PersonSkills>;
    private initialized: Record<PersonId, true>;

    constructor(
        manifest: SkillManifest = DEFAULT_SKILL_MANIFEST,
        initParams: SkillInitParams = DEFAULT_SKILL_INIT_PARAMS,
        schoolConfig: SchoolConfig = schoolsConfig as unknown as SchoolConfig
    ) {
        this.manifest = manifest;
        this.graph = compileSkills(manifest);
        this.initParams = initParams;
        this.schoolConfig = schoolConfig;
        this.records = {};
        this.initialized = {};
    }

    getManifest(): SkillManifest {
        return this.manifest;
    }

    // --- Reads ------------------------------------------------------------------------------------------

    proficiency(personId: PersonId, skillId: string): number {
        return this.records[personId]?.[skillId]?.proficiency ?? 0;
    }

    has(personId: PersonId, skillId: string, min = 0): boolean {
        const value = this.proficiency(personId, skillId);
        return min > 0 ? value >= min : value > 0;
    }

    hasAny(personId: PersonId): boolean {
        return Object.keys(this.records[personId] ?? {}).length > 0;
    }

    meets(personId: PersonId, requirements: SkillRequirement[]): boolean {
        return requirements.every(requirement => this.proficiency(personId, requirement.skill) >= requirement.minProficiency);
    }

    // The person's full records (HUD/inspection). Do not mutate.
    skillsOf(personId: PersonId): PersonSkills {
        return this.records[personId] ?? {};
    }

    isInitialized(personId: PersonId): boolean {
        return this.initialized[personId] === true;
    }

    // --- Grants -----------------------------------------------------------------------------------------

    private dependenciesMet(personId: PersonId, skillId: string, alsoGranted?: Map<string, number>): boolean {
        for (const dependency of this.graph.dependenciesOf[skillId] ?? []) {
            const held = this.proficiency(personId, dependency.skill);
            const pending = alsoGranted?.get(dependency.skill) ?? 0;
            if (Math.max(held, pending) < dependency.minProficiency) {
                return false;
            }
        }
        return true;
    }

    private resolveAmount(current: number, amount: SkillGrantAmount): number {
        const target = 'toAtLeast' in amount ? Math.max(current, amount.toAtLeast) : current + amount.add;
        return Math.min(MAX_PROFICIENCY, target);
    }

    private write(personId: PersonId, skillId: string, proficiency: number, tick: number, provenance: string): void {
        if (proficiency <= 0) {
            return; // zero-proficiency records are never stored
        }
        const personRecords = this.records[personId] ?? (this.records[personId] = {});
        const existing = personRecords[skillId];
        if (!existing) {
            personRecords[skillId] = { proficiency, firstAcquiredTick: tick, lastProgressedTick: tick, provenance: [provenance] };
            return;
        }
        if (proficiency > existing.proficiency) {
            existing.proficiency = proficiency;
            existing.lastProgressedTick = tick;
        }
        if (!existing.provenance.includes(provenance)) {
            existing.provenance.push(provenance);
        }
    }

    // Grant proficiency (dependency-gated, clamped). A no-op grant (already at/above `toAtLeast`) still
    // records provenance but does not touch ticks.
    grant(personId: PersonId, skillId: string, amount: SkillGrantAmount, tick: number, provenance: string): GrantResult {
        if (!(skillId in this.manifest)) {
            return { ok: false, reason: 'unknownSkill' };
        }
        if (!this.dependenciesMet(personId, skillId)) {
            return { ok: false, reason: 'dependenciesUnmet' };
        }
        this.write(personId, skillId, this.resolveAmount(this.proficiency(personId, skillId), amount), tick, provenance);
        return { ok: true };
    }

    // Atomic multi-grant (the onboarding/training primitive, tasks 059/064): validates that every granted
    // skill's dependencies are satisfied by pre-state OR by other grants in the set, then applies the whole
    // set in dependency (topo) order. One unsatisfiable grant ⇒ zero mutations, typed failure.
    grantClosure(personId: PersonId, grants: SkillGrant[], tick: number, provenance: string): GrantResult {
        const pending = new Map<string, number>();
        for (const entry of grants) {
            if (!(entry.skill in this.manifest)) {
                return { ok: false, reason: 'unknownSkill' };
            }
            pending.set(entry.skill, this.resolveAmount(Math.max(this.proficiency(personId, entry.skill), pending.get(entry.skill) ?? 0), entry.amount));
        }
        for (const entry of grants) {
            if (!this.dependenciesMet(personId, entry.skill, pending)) {
                return { ok: false, reason: 'dependenciesUnmet' };
            }
        }
        // Apply in topo order so intra-set prerequisites land before their dependents.
        const order = new Map(this.graph.topoOrder.map((id, index) => [id, index]));
        for (const entry of [...grants].sort((a, b) => (order.get(a.skill) ?? 0) - (order.get(b.skill) ?? 0))) {
            this.write(personId, entry.skill, pending.get(entry.skill)!, tick, provenance);
        }
        return { ok: true };
    }

    // Grant a skill together with whatever prerequisite top-ups it needs (recursively): education and
    // legacy-save migration teach the prerequisites too. Deterministic, RNG-free.
    grantWithPrerequisites(personId: PersonId, skillId: string, toAtLeast: number, tick: number, provenance: string): GrantResult {
        if (!(skillId in this.manifest)) {
            return { ok: false, reason: 'unknownSkill' };
        }
        const grants: SkillGrant[] = [];
        const visit = (id: string, floor: number): void => {
            for (const dependency of this.graph.dependenciesOf[id] ?? []) {
                if (this.proficiency(personId, dependency.skill) < dependency.minProficiency) {
                    visit(dependency.skill, dependency.minProficiency);
                }
            }
            grants.push({ skill: id, amount: { toAtLeast: floor } });
        };
        visit(skillId, toAtLeast);
        return this.grantClosure(personId, grants, tick, provenance);
    }

    // --- Initialization (task 062) ------------------------------------------------------------------------

    // Early-childhood milestone grants for every milestone at or below the age. Idempotent (toAtLeast).
    applyMilestones(personId: PersonId, ageYears: number, tick: number): void {
        for (const milestone of this.initParams.milestones) {
            if (milestone.ageYears > ageYears) {
                continue;
            }
            for (const grant of milestone.grants) {
                this.grant(personId, grant.skill, { toAtLeast: grant.toAtLeast }, tick, 'initialization');
            }
        }
    }

    private basicSkillIds(): string[] {
        return Object.keys(this.manifest).filter(id => this.manifest[id]!.basic).sort();
    }

    // One-time age-appropriate seeding for a person entering detailed simulation (task 062). `jobCoreSkills`
    // biases the adult assortment toward employable abilities (the ids referenced by jobs.json, supplied by
    // the host so this store stays decoupled from the jobs table).
    initialize(personId: PersonId, ageYears: number, birthTick: number, tick: number, worldSeed: number, jobCoreSkills: ReadonlySet<string>): void {
        if (this.initialized[personId]) {
            return;
        }
        this.initialized[personId] = true;
        if (ageYears <= 0) {
            return; // newborns start skill-less
        }

        // Ages 1+: the partial foundational ladder (never all basics prematurely).
        this.applyMilestones(personId, ageYears, tick);

        if (ageYears < this.schoolConfig.minAgeYears) {
            return;
        }

        if (ageYears <= this.schoolConfig.maxAgeYears) {
            // School-age, initialized without a lived history: SYNTHESIZED full attendance since the 7th
            // birthday (task 062). Children who grow up simulated earn this through task 063 instead.
            const gain = schoolDailyGain(this.schoolConfig, birthTick);
            const startDay = dayOfTick(birthTick + this.schoolConfig.minAgeYears * TICKS_PER_YEAR);
            const attended = countSchoolDays(this.schoolConfig, startDay, dayOfTick(tick));
            const value = Math.min(SCHOOL_BASIC_CAP, gain * attended);
            for (const basic of this.basicSkillIds()) {
                this.grant(personId, basic, { toAtLeast: value }, tick, 'initialization');
            }
            return;
        }

        // Adults: every basic at the educated baseline…
        for (const basic of this.basicSkillIds()) {
            this.grant(personId, basic, { toAtLeast: this.initParams.adultBasicProficiency }, tick, 'initialization');
        }
        // …plus a deterministic contextual assortment of specifics — biased toward employable (job-core)
        // abilities, levels bounded (no unexplained masters), dependencies respected via prerequisite grants.
        const rng = new SeededRandom((worldSeed ^ hashStringToSeed(personId)) >>> 0);
        const { assortment } = this.initParams;
        const band = [...assortment.bands].sort((a, b) => b.minAgeYears - a.minAgeYears).find(candidate => ageYears >= candidate.minAgeYears);
        if (!band) {
            return;
        }
        const count = rng.nextInt(band.minSkills, band.maxSkills);
        const pool = Object.keys(this.manifest).filter(id => !this.manifest[id]!.basic).sort()
            .map(id => ({ id, weight: jobCoreSkills.has(id) ? assortment.jobCoreWeight : assortment.flavorWeight }));
        for (let draw = 0; draw < count && pool.length > 0; draw++) {
            const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
            let roll = rng.next() * total;
            let index = pool.length - 1;
            for (let i = 0; i < pool.length; i++) {
                roll -= pool[i]!.weight;
                if (roll <= 0) {
                    index = i;
                    break;
                }
            }
            const picked = pool.splice(index, 1)[0]!;
            const level = assortment.minProficiency + rng.next() * (assortment.maxProficiency - assortment.minProficiency);
            this.grantWithPrerequisites(personId, picked.id, Math.round(level * 10) / 10, tick, 'initialization');
        }
    }

    // --- Serialization ------------------------------------------------------------------------------------

    getState(): SkillBookState {
        return {
            records: JSON.parse(JSON.stringify(this.records)) as Record<PersonId, PersonSkills>,
            initialized: { ...this.initialized },
        };
    }

    loadState(state: SkillBookState): void {
        this.records = JSON.parse(JSON.stringify(state.records)) as Record<PersonId, PersonSkills>;
        this.initialized = { ...state.initialized };
    }
}

// Convenience for record display order (HUD): highest proficiency first, then id.
export function sortedSkillEntries(skills: PersonSkills): [string, PersonSkillRecord][] {
    return Object.entries(skills).sort((a, b) => b[1].proficiency - a[1].proficiency || a[0].localeCompare(b[0]));
}
