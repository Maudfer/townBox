// The Skill Progression service (task 063; extended by 065 for work days): converts completed-day events
// into proficiency. The division of labour is deliberate (the vision doc's contract): Brain decides that a
// person attends school, the Action engine confirms the day completed (the attend_school lifecycle fires
// `completed_school_day`, `once: perDay`), and THIS service — running in the shared tick spine, so both
// execution modes progress identically — awards the gain. Brain never mutates skills.
//
// School math: each completed school day awards `schoolDailyGain(person)` = 60 / totalEligibleSchoolDays
// (the person's own weekday calendar between their 7th and 18th birthdays — util/school.ts), to EVERY basic
// skill, clamped at SCHOOL_BASIC_CAP (60): perfect attendance lands exactly 60.0 at the 18th birthday;
// missed days simply end lower and nothing ever normalizes anyone back up.
//
// Double-credit protection is layered: the event's `once: perDay` limit is the primary gate (enforced by
// EventEngine.limitAllows on every trigger path), and this service keeps its own last-credited-day guard as
// a belt-and-braces invariant — a duplicate commit in one calendar day awards nothing. RNG-free.

import SkillBook from 'game/SkillBook';

import { schoolDailyGain, SCHOOL_BASIC_CAP } from 'util/school';
import { dayOfTick } from 'util/time';

import { PersonId, PopulationState } from 'types/Genealogy';
import { SchoolConfig } from 'types/School';
import { TickResult } from 'types/LifeEvent';

import schoolsConfig from 'json/schools.json';

export const COMPLETED_SCHOOL_DAY_EVENT = 'completed_school_day';

export default class SkillProgression {
    private schoolConfig: SchoolConfig;
    // Belt-and-braces per-day guard (see header). Session-local: across a save/load the event's own perDay
    // limit (persisted in the event history) remains the authoritative gate.
    private lastSchoolCreditDay: Map<PersonId, number>;

    constructor(private skillBook: SkillBook, schoolConfig: SchoolConfig = schoolsConfig as unknown as SchoolConfig) {
        this.schoolConfig = schoolConfig;
        this.lastSchoolCreditDay = new Map();
    }

    // Consume a tick's committed events (TickRunner phase 6.5 — after commits, before Brain intents).
    processCommits(committed: TickResult['committed'], state: PopulationState, tick: number): void {
        for (const commit of committed) {
            if (commit.eventId === COMPLETED_SCHOOL_DAY_EVENT) {
                this.awardSchoolDay(commit.personId, state, tick);
            }
        }
    }

    // One completed school day: every basic skill gains the person's calendar-exact daily rate, capped at
    // the school ceiling (other provenances may push basics past 60; school never does).
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
}
