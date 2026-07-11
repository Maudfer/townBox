import Person from 'game/agents/Person';
import SkillBook from 'game/skills/SkillBook';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import jobsConfig from 'json/jobs.json';
import { JobDefinition, JobRank, JobTable } from 'types/Business';
import { PersonId } from 'types/Genealogy';
import { JobMarket as IJobMarket } from 'types/LifeEvent';
import { SkillGrant } from 'types/Skill';
import { JobPosition } from 'types/Work';

// Concrete employment adapter (task 015; rank-aware since 064): the bridge between the pure event engine
// and the materialized Workplace/Field layer. The engine consults it to derive `employed`/`canBeHired` and
// to perform hiring/firing via the `acquireSlot`/`releaseSlot` effects. Built fresh each tick by
// City.handleTick; skills read from the central SkillBook (059).
//
// Hiring evaluates a position's job LADDER in two paths, in order (task 064):
//  1. STRICT — the highest rank whose proficiency requirements the candidate already meets.
//  2. TRAINING SHORTCUT — failing that, the ENTRY rank via its explicit `entryTrainingGrant` (the temporary
//     College stand-in): allowed only when the grant covers every unmet requirement and its dependency
//     closure is satisfiable from the candidate's current skills. The grant is applied ONLY inside a
//     successful hire (atomically, with revalidation) — never on evaluation — so repeated failed matching
//     attempts can farm nothing.
// Positions whose title has no jobs.json ladder (test fixtures, legacy saves) fall back to boolean
// possession of `position.requirements`.
//
// Deterministic: score = SKILL_WEIGHT × fit − DISTANCE_WEIGHT × (home↔workplace Manhattan distance), fit =
// matched-rank index × RANK_FIT_WEIGHT + requirement count; ties break by workplace anchor key. No RNG.

const SKILL_WEIGHT = 8;
const DISTANCE_WEIGHT = 1;
const NO_HOME_DISTANCE = 9999;
const RANK_FIT_WEIGHT = 10;

const JOBS = jobsConfig as unknown as JobTable;

interface RankMatch {
    defKey: string | null;
    rank: JobRank | null; // null = legacy boolean fallback matched
    viaGrant: boolean;
    fit: number;
}

interface Match {
    person: Person;
    workplace: Workplace;
    position: JobPosition;
    rankMatch: RankMatch;
}

export default class JobMarket implements IJobMarket {
    private workplaces: Workplace[];
    private defByTitle: Map<string, { key: string; def: JobDefinition }>;

    constructor(private byGenId: Map<PersonId, Person>, field: Field, private skillBook: SkillBook, private tick: number = 0) {
        this.workplaces = field.getStructures().filter((tile): tile is Workplace => tile instanceof Workplace);
        this.defByTitle = new Map(Object.entries(JOBS).map(([key, def]) => [def.title, { key, def }]));
    }

    isEmployed(personId: PersonId): boolean {
        const person = this.byGenId.get(personId);
        return !!person && person.work.getJob() !== null;
    }

    canHire(personId: PersonId): boolean {
        return this.bestMatch(personId) !== null;
    }

    hire(personId: PersonId): boolean {
        const match = this.bestMatch(personId);
        if (!match) {
            return false;
        }
        const { person, workplace, rankMatch } = match;

        // Training shortcut (064): the grant applies only now — inside the successful hire — atomically and
        // with revalidation. A closure failure aborts the hire with zero mutations (the event's acquireSlot
        // then aborts the whole get_job commit, as with any failed acquisition).
        if (rankMatch.viaGrant && rankMatch.rank?.entryTrainingGrant) {
            const grants: SkillGrant[] = rankMatch.rank.entryTrainingGrant.grants.map(grant => ({
                skill: grant.skill,
                amount: { toAtLeast: grant.toProficiency },
            }));
            const granted = this.skillBook.grantClosure(personId, grants, this.tick, `trainingGrant:${rankMatch.defKey}`);
            if (!granted.ok) {
                return false;
            }
            // Revalidate the full requirement set post-grant (the task 064 contract).
            if (rankMatch.rank && !this.skillBook.meets(personId, rankMatch.rank.requires)) {
                return false;
            }
        }

        const job = workplace.hire(person, requirements => this.positionFillable(personId, requirements, rankMatch));
        if (!job) {
            return false;
        }
        // The assignment records the rank (entry via the shortcut; the matched rank via the strict path).
        if (rankMatch.rank) {
            job.rankId = rankMatch.rank.rankId;
            job.workDaysInRank = 0;
            job.totalWorkDays = 0;
        }
        person.work.setJob(job);
        person.work.setWorkplace(workplace); // employer reference for the commute (task 006)
        return true;
    }

    fire(personId: PersonId): void {
        const person = this.byGenId.get(personId);
        if (!person || person.work.getJob() === null) {
            return;
        }
        const employer = this.workplaces.find(workplace => workplace.getEmployees().includes(person));
        employer?.layoff(person);
        // Rank is not retained across employers (064): skills persist, the title does not — a re-hire
        // re-qualifies through the normal paths (a seasoned worker typically strict-qualifies higher).
        person.work.clearJob();
    }

    // --- Rank matching (task 064) ---------------------------------------------------------------------------

    // How the candidate can fill a position, or null. Strict path first (highest rank wins), then the
    // entry training shortcut.
    private matchPosition(personId: PersonId, position: JobPosition): RankMatch | null {
        const entry = this.defByTitle.get(position.title);
        if (!entry || entry.def.ranks.length === 0) {
            // Legacy/fixture fallback: boolean possession of the position's own requirement list.
            if (position.requirements.every(requirement => this.skillBook.has(personId, requirement))) {
                return { defKey: null, rank: null, viaGrant: false, fit: position.requirements.length };
            }
            return null;
        }
        const ranks = entry.def.ranks;
        // Strict: the highest rung the candidate already meets (declaration order = progression order).
        for (let index = ranks.length - 1; index >= 0; index--) {
            const rank = ranks[index]!;
            if (this.skillBook.meets(personId, rank.requires)) {
                return { defKey: entry.key, rank, viaGrant: false, fit: index * RANK_FIT_WEIGHT + rank.requires.length };
            }
        }
        // Shortcut: the entry rank via its explicit grant, only.
        const entryRank = ranks.find(rank => rank.entry);
        if (entryRank?.entryTrainingGrant && this.shortcutFeasible(personId, entryRank)) {
            return { defKey: entry.key, rank: entryRank, viaGrant: true, fit: entryRank.requires.length };
        }
        return null;
    }

    // The grant covers every unmet requirement AND its dependency closure is satisfiable from the
    // candidate's current skills — checked WITHOUT mutating anything (evaluation must be farm-proof).
    private shortcutFeasible(personId: PersonId, rank: JobRank): boolean {
        const grant = rank.entryTrainingGrant!;
        const floorOf = new Map(grant.grants.map(entry => [entry.skill, entry.toProficiency]));
        for (const requirement of rank.requires) {
            const covered = this.skillBook.proficiency(personId, requirement.skill) >= requirement.minProficiency
                || (floorOf.get(requirement.skill) ?? 0) >= requirement.minProficiency;
            if (!covered) {
                return false;
            }
        }
        const manifest = this.skillBook.getManifest();
        for (const entry of grant.grants) {
            for (const dependency of manifest[entry.skill]?.dependencies ?? []) {
                const reachable = Math.max(this.skillBook.proficiency(personId, dependency.skill), floorOf.get(dependency.skill) ?? 0);
                if (reachable < dependency.minProficiency) {
                    return false; // e.g. weak basics from poor attendance — this profession stays out of reach
                }
            }
        }
        return true;
    }

    private positionFillable(personId: PersonId, requirements: string[], rankMatch: RankMatch): boolean {
        if (rankMatch.rank) {
            return this.skillBook.meets(personId, rankMatch.rank.requires);
        }
        return requirements.every(requirement => this.skillBook.has(personId, requirement));
    }

    // The best (highest-scoring) workplace the person can be hired into right now, or null if none is fillable.
    private bestMatch(personId: PersonId): Match | null {
        const person = this.byGenId.get(personId);
        if (!person || person.work.getJob() !== null) {
            return null;
        }
        if (!this.skillBook.hasAny(personId)) {
            return null; // skill-less people (newborns) are not hireable
        }

        const home = person.social.getHome();
        const homePos = home ? home.getPosition() : null;

        let best: Match | null = null;
        let bestScore = -Infinity;
        let bestKey = '';

        for (const workplace of this.workplaces) {
            let workplaceBest: { position: JobPosition; rankMatch: RankMatch } | null = null;
            for (const position of workplace.getOpenPositions()) {
                const rankMatch = this.matchPosition(personId, position);
                if (rankMatch && (!workplaceBest || rankMatch.fit > workplaceBest.rankMatch.fit)) {
                    workplaceBest = { position, rankMatch };
                }
            }
            if (!workplaceBest) {
                continue;
            }
            const position = workplace.getPosition();
            const distance = homePos && position
                ? Math.abs(homePos.row - position.row) + Math.abs(homePos.col - position.col)
                : NO_HOME_DISTANCE;
            const score = SKILL_WEIGHT * workplaceBest.rankMatch.fit - DISTANCE_WEIGHT * distance;
            const key = workplace.getIdentifier();
            if (score > bestScore || (score === bestScore && key < bestKey)) {
                bestScore = score;
                bestKey = key;
                best = { person, workplace, position: workplaceBest.position, rankMatch: workplaceBest.rankMatch };
            }
        }

        return best;
    }
}
