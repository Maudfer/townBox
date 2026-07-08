// School assignments (task 058): the persistent student-side registry plus the deterministic enrollment
// sweep. Assignments are keyed by pool personId (the Inventory/LifeLog pattern) so they survive
// de/re-materialization and work off-map; validity is DERIVED at read time (school still open, person in the
// age band) rather than stored. Scene-free and RNG-free: the sweep is a pure function of its inputs —
// children sorted by id, schools scored nearest-first with anchor-key tie-breaks (the JobMarket pattern).

import { SchoolAssignment, SchoolConfig, SchoolRegistryState } from 'types/School';
import { PersonId } from 'types/Genealogy';
import { isSchoolAge } from 'util/school';

// A school the sweep can enroll into: the building's anchor key, its seat count (capacity curve evaluated
// over the business size by the caller), and its map position for distance scoring (null off-map).
export interface SchoolSeat {
    key: string;
    seats: number;
    position: { row: number; col: number } | null;
}

// A child the sweep considers: pool id, current age (years), and their home anchor position (null when
// homeless/off-map — they stay enrollable, scored at max distance, the JobMarket convention).
export interface SchoolCandidate {
    personId: PersonId;
    ageYears: number;
    homePosition: { row: number; col: number } | null;
}

export interface SweepOutcome {
    enrolled: SchoolAssignment[]; // fresh assignments made this sweep
    released: PersonId[]; // assignments dropped (aged out, died, school gone)
    agedOut: PersonId[]; // subset of released: left because they turned maxAge+1 (graduation candidates)
}

const NO_HOME_DISTANCE = 9999;

export default class SchoolRegistry {
    private assignments: Record<PersonId, SchoolAssignment>;

    constructor() {
        this.assignments = {};
    }

    assignmentOf(personId: PersonId): SchoolAssignment | null {
        return this.assignments[personId] ?? null;
    }

    assign(personId: PersonId, schoolKey: string, tick: number): SchoolAssignment {
        const assignment: SchoolAssignment = { personId, schoolKey, assignedAtTick: tick };
        this.assignments[personId] = assignment;
        return assignment;
    }

    release(personId: PersonId): void {
        delete this.assignments[personId];
    }

    // Drop every assignment pointing at a closed/demolished school (task 021 bankruptcy, 025 bulldoze).
    // The next daily sweep re-enrolls the affected children where seats exist.
    releaseSchool(schoolKey: string): PersonId[] {
        const released: PersonId[] = [];
        for (const [personId, assignment] of Object.entries(this.assignments)) {
            if (assignment.schoolKey === schoolKey) {
                delete this.assignments[personId];
                released.push(personId);
            }
        }
        return released.sort();
    }

    enrolledCount(schoolKey: string): number {
        let count = 0;
        for (const assignment of Object.values(this.assignments)) {
            if (assignment.schoolKey === schoolKey) {
                count++;
            }
        }
        return count;
    }

    // The daily enrollment sweep (deterministic, RNG-free). Order matters and is fixed:
    //  1. Release invalid assignments — person no longer among the candidates (died/despawned), aged out of
    //     the band, or their school no longer exists.
    //  2. Enroll unassigned school-age candidates (sorted by personId) into the nearest school with a free
    //     seat (Manhattan distance home→school; ties by anchor key).
    // A child with no reachable seat simply stays unenrolled — no silent auto-schooling (task 058).
    sweep(config: SchoolConfig, candidates: SchoolCandidate[], schools: SchoolSeat[], tick: number): SweepOutcome {
        const outcome: SweepOutcome = { enrolled: [], released: [], agedOut: [] };
        const candidateById = new Map(candidates.map(candidate => [candidate.personId, candidate]));
        const schoolByKey = new Map(schools.map(school => [school.key, school]));

        // 1. Validity pass.
        for (const [personId, assignment] of [...Object.entries(this.assignments)].sort((a, b) => a[0].localeCompare(b[0]))) {
            const candidate = candidateById.get(personId);
            if (candidate && isSchoolAge(config, candidate.ageYears) && schoolByKey.has(assignment.schoolKey)) {
                continue; // still valid
            }
            delete this.assignments[personId];
            outcome.released.push(personId);
            if (candidate && candidate.ageYears > config.maxAgeYears) {
                outcome.agedOut.push(personId);
            }
        }

        // 2. Enrollment pass. Seat occupancy counts live assignments plus this sweep's own enrollments.
        const occupancy = new Map<string, number>();
        for (const assignment of Object.values(this.assignments)) {
            occupancy.set(assignment.schoolKey, (occupancy.get(assignment.schoolKey) ?? 0) + 1);
        }
        const unassigned = candidates
            .filter(candidate => isSchoolAge(config, candidate.ageYears) && !this.assignments[candidate.personId])
            .sort((a, b) => a.personId.localeCompare(b.personId));
        for (const candidate of unassigned) {
            let best: SchoolSeat | null = null;
            let bestDistance = Infinity;
            for (const school of [...schools].sort((a, b) => a.key.localeCompare(b.key))) {
                if ((occupancy.get(school.key) ?? 0) >= school.seats) {
                    continue;
                }
                const distance = candidate.homePosition && school.position
                    ? Math.abs(candidate.homePosition.row - school.position.row) + Math.abs(candidate.homePosition.col - school.position.col)
                    : NO_HOME_DISTANCE;
                if (distance < bestDistance) {
                    best = school;
                    bestDistance = distance;
                }
            }
            if (best) {
                occupancy.set(best.key, (occupancy.get(best.key) ?? 0) + 1);
                outcome.enrolled.push(this.assign(candidate.personId, best.key, tick));
            }
        }
        return outcome;
    }

    getState(): SchoolRegistryState {
        return { assignments: { ...this.assignments } };
    }

    loadState(state: SchoolRegistryState): void {
        this.assignments = { ...state.assignments };
    }
}
