// The Skill Progression service (tasks 063 + 065): converts completed-day events into proficiency, and
// completed work days into career progression. The division of labour is deliberate (the vision doc's
// contract): Brain decides that a person attends school/work, the Action engine confirms the day completed
// (the lifecycle events `completed_school_day` / `stopped_working`, both `once: perDay`), and THIS service —
// running in the shared tick spine — awards the gains. Brain never mutates skills; the Job Orchestrator
// never grows a second state machine.
//
// School math (063): each completed school day awards `schoolDailyGain(person)` = 60 / the person's own
// eligible-weekday count between their 7th and 18th birthdays, to EVERY basic skill, clamped at
// SCHOOL_BASIC_CAP (60): perfect attendance lands exactly 60.0 at 18; missed days end lower; nothing
// normalizes anyone up.
//
// Work math (065): each completed work day awards WORK_DAILY_GAIN = 100/3650 × the rank's declared
// multiplier to each skill the rank `progresses` (primaries ×1.0 → 0→100 over ten years of daily work;
// off-day jobs simply take proportionally longer — 056 decision a). Progression is DECLARED BY DATA, never
// inferred from action names, and awards once per completed work day — never per child action, so a job
// with more flavor actions levels nothing faster. Counters on the assignment (workDaysInRank/totalWorkDays)
// drive the deterministic PROMOTION evaluation: every `promotion.evaluateEveryWorkDays` (default 30) days in
// rank, if the next rung's requirements are met (and any minWorkDaysInRank), the person is promoted — the
// rank id flips, counters reset, and the manual `got_promoted` event fires (emitting the `promoted` feed
// signal). RNG-free throughout.
//
// Double-credit protection is layered: each event's `once: perDay` limit is the primary gate, and this
// service keeps last-credited-day guards as belt-and-braces invariants.

import EventEngine from 'game/events/EventEngine';
import SkillBook from 'game/skills/SkillBook';
import jobsConfig from 'json/jobs.json';
import schoolsConfig from 'json/schools.json';
import { JobTable } from 'types/Business';
import { PersonId, PopulationState } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { SchoolConfig } from 'types/School';
import { JobPosition } from 'types/Work';
import { schoolDailyGain, SCHOOL_BASIC_CAP } from 'util/school';
import { dayOfTick } from 'util/time';


export const COMPLETED_SCHOOL_DAY_EVENT = 'completed_school_day';
export const COMPLETED_WORK_DAY_EVENT = 'stopped_working';
export const PROMOTION_EVENT = 'got_promoted';

// A primary working skill goes 0→100 over ten nominal years of full daily work (task 065).
export const WORK_DAILY_GAIN = 100 / 3650;
const DEFAULT_PROMOTION_CADENCE_WORK_DAYS = 30;

// What the work path needs from the host per tick (live: City closures over WorkLife; bootstrap: the
// logical world when 055 builds it). `assignmentOf` returns the person's MUTABLE job assignment so counters
// and promotions land on the serialized object.
export interface WorkProgressionDeps {
    engine: EventEngine;
    ticksPerYear: number;
    assignmentOf: (personId: PersonId) => JobPosition | null;
}

export default class SkillProgression {
    private schoolConfig: SchoolConfig;
    private jobs: JobTable;
    // Belt-and-braces per-day guards (see header). Session-local: across a save/load the events' own perDay
    // limits (persisted in the event history) remain the authoritative gates.
    private lastSchoolCreditDay: Map<PersonId, number>;
    private lastWorkCreditDay: Map<PersonId, number>;

    constructor(
        private skillBook: SkillBook,
        schoolConfig: SchoolConfig = schoolsConfig as unknown as SchoolConfig,
        jobs: JobTable = jobsConfig as unknown as JobTable
    ) {
        this.schoolConfig = schoolConfig;
        this.jobs = jobs;
        this.lastSchoolCreditDay = new Map();
        this.lastWorkCreditDay = new Map();
    }

    // Consume a tick's committed events (TickRunner phase 5.5 — after commits, before the world
    // reconciliation sees the result, so promotion events/signals ride the same tick's dispatch). Returns
    // follow-up commits/signals produced by promotions for the caller to merge into the tick result.
    processCommits(committed: TickResult['committed'], state: PopulationState, tick: number, workDeps?: WorkProgressionDeps): TickResult {
        const extra: TickResult = { died: [], born: [], signals: [], committed: [] };
        for (const commit of committed) {
            if (commit.eventId === COMPLETED_SCHOOL_DAY_EVENT) {
                this.awardSchoolDay(commit.personId, state, tick);
            } else if (commit.eventId === COMPLETED_WORK_DAY_EVENT && workDeps) {
                this.awardWorkDay(commit.personId, state, tick, workDeps, extra);
            }
        }
        return extra;
    }

    // --- School days (task 063) -----------------------------------------------------------------------------

    awardSchoolDay(personId: PersonId, state: PopulationState, tick: number): void {
        const day = dayOfTick(tick);
        if (this.lastSchoolCreditDay.get(personId) === day) {
            return; // duplicate commit in one calendar day — never double-award
        }
        const genPerson = state.people[personId];
        if (!genPerson) {
            return;
        }
        const gain = schoolDailyGain(this.schoolConfig, genPerson.birthTick);
        if (gain <= 0) {
            return;
        }
        this.lastSchoolCreditDay.set(personId, day);
        const manifest = this.skillBook.getManifest();
        for (const skillId of Object.keys(manifest).sort()) {
            if (!manifest[skillId]!.basic) {
                continue;
            }
            const current = this.skillBook.proficiency(personId, skillId);
            if (current >= SCHOOL_BASIC_CAP) {
                continue; // school progression tops out at the cap
            }
            const target = Math.min(SCHOOL_BASIC_CAP, current + gain);
            this.skillBook.grant(personId, skillId, { toAtLeast: target }, tick, 'school');
        }
    }

    // --- Work days & promotion (task 065) ------------------------------------------------------------------

    awardWorkDay(personId: PersonId, state: PopulationState, tick: number, deps: WorkProgressionDeps, extra: TickResult): void {
        const day = dayOfTick(tick);
        if (this.lastWorkCreditDay.get(personId) === day) {
            return; // one credit per calendar day, regardless of how the day closed
        }
        const assignment = deps.assignmentOf(personId);
        if (!assignment || !assignment.rankId) {
            return; // unemployed, or a rank-less legacy/fixture position — nothing declared to progress
        }
        const entry = Object.entries(this.jobs).find(([, definition]) => definition.title === assignment.title);
        if (!entry) {
            return;
        }
        const [defKey, definition] = entry;
        const rankIndex = definition.ranks.findIndex(rank => rank.rankId === assignment.rankId);
        if (rankIndex === -1) {
            return;
        }
        const rank = definition.ranks[rankIndex]!;
        this.lastWorkCreditDay.set(personId, day);

        // The declared per-work-day gains (primaries ×1.0, secondaries below — pure data, task 064 schema).
        for (const progress of rank.progresses) {
            this.skillBook.grant(personId, progress.skill, { add: WORK_DAILY_GAIN * progress.multiplier }, tick, `job:${defKey}`);
        }
        assignment.workDaysInRank = (assignment.workDaysInRank ?? 0) + 1;
        assignment.totalWorkDays = (assignment.totalWorkDays ?? 0) + 1;

        // Deterministic promotion evaluation at the rank's cadence.
        const cadence = rank.promotion?.evaluateEveryWorkDays ?? DEFAULT_PROMOTION_CADENCE_WORK_DAYS;
        if (assignment.workDaysInRank % cadence !== 0) {
            return;
        }
        if (assignment.workDaysInRank < (rank.promotion?.minWorkDaysInRank ?? 0)) {
            return;
        }
        const next = definition.ranks[rankIndex + 1];
        if (!next || !this.skillBook.meets(personId, next.requires)) {
            return;
        }
        assignment.rankId = next.rankId;
        assignment.workDaysInRank = 0;
        // The promotion is narrated through the normal event pipeline: the manual got_promoted event commits
        // (once per its limit) and emits the `promoted` feed signal.
        const { result } = deps.engine.invoke(state, PROMOTION_EVENT, personId, tick, deps.ticksPerYear, { source: 'system', causationId: null });
        extra.died.push(...result.died);
        extra.born.push(...result.born);
        extra.signals.push(...result.signals);
        extra.committed.push(...result.committed);
    }
}
