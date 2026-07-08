// School scheduling & assignments (task 058). Schools reuse the existing building/business substrate (the
// `school` blueprint in businesses.json employs its staff); what this adds is the STUDENT side — a formal
// assignment contract and a weekday schedule. School is deliberately NOT modeled as a Job (056 decision):
// it shares the shift-window shape but differs in progression, compensation, and skill awarding (task 063).

import { Curve } from 'util/curve';
import { PersonId } from 'types/Genealogy';

// The city-wide school schedule & enrollment parameters (json/schools.json). One schedule for all schools
// for now; per-school schedules would slot in here later without changing consumers (they read through
// SchoolFacts). `capacity` is a Curve over the school BUSINESS size (the Engine A substrate), so a bigger
// school seats more students.
export interface SchoolConfig {
    dayStartMinutes: number; // minutes since midnight, e.g. 480 = 08:00
    dayEndMinutes: number; // exclusive, e.g. 840 = 14:00
    daysOfWeek: string[]; // weekday names (util/time WEEKDAY_NAMES); weekend days rejected by the validator
    minAgeYears: number; // enrollment band (inclusive), e.g. 7
    maxAgeYears: number; // inclusive, e.g. 17 — people age OUT on their (max+1)th birthday
    capacity: Curve; // seats as a function of the school business size
}

// A person's school assignment. Deliberately minimal: validity and the schedule are DERIVED at read time
// (the school still exists with an active school business; the person is in the age band) — no stale flags
// to maintain. Keyed by pool personId so it survives de/re-materialization (the Inventory/LifeLog pattern).
export interface SchoolAssignment {
    personId: PersonId;
    schoolKey: string; // the school building's anchor key ("row-col")
    assignedAtTick: number;
}

// What the Brain's school-obligation hook consumes (mirrors JobFacts): the assigned school plus the
// schedule window, shaped like a ShiftWindow so util/shifts math applies verbatim.
export interface SchoolFacts {
    schoolKey: string;
    shiftStart: number; // = SchoolConfig.dayStartMinutes
    shiftEnd: number; // = SchoolConfig.dayEndMinutes
    daysOfWeek: readonly string[];
}

// Serialized registry state (WorldSnapshot.schools, save v9).
export interface SchoolRegistryState {
    assignments: Record<PersonId, SchoolAssignment>;
}
