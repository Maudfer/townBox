// City incidents (task 099 / proposal G4): the registry crimes (and later fires, 102) are reported into and
// police work resolves out of. Deliberately the JobMarket/HousingMarket adapter pattern — engine-agnostic,
// scene-free, serialized (save v16 family). The suspect id is GROUND TRUTH (the sim always knows who did
// it); whether justice ever learns is what `witnesses` and police coverage decide.

import { PersonId } from 'types/Genealogy';

export type IncidentKind = 'shoplifting' | 'pickpocketing' | 'fire';

export type IncidentStatus = 'open' | 'resolved' | 'cold';

export interface IncidentRecord {
    id: number;
    kind: IncidentKind;
    tick: number;
    locationKey: string; // canonical location key at commit time
    suspectId: PersonId | null; // null for suspectless emergencies (fire, task 102)
    witnesses: number; // co-located others at commit time — resolution odds scale with it
    status: IncidentStatus;
    resolvedTick: number | null;
}

export interface IncidentsState {
    nextId: number;
    incidents: IncidentRecord[];
}

// The surface the Brain's pursuit hook consults through SimulationMarkets.incidents.
export interface IncidentsReader {
    // Dispatch (task 109): the oldest open, WITNESSED incident — where the responding officers drive to.
    oldestOpenCase(): IncidentRecord | null;
    // Fire queries (task 102): the evacuation hook asks about HERE; the firefighter rush about anywhere.
    openFireAt(locationKey: string): boolean;
    anyOpenFire(): boolean;
    // Fire dispatch (task 110): the oldest burning building — the crew's destination.
    oldestOpenFire(): IncidentRecord | null;
    // Wanted = named suspect of an open, WITNESSED incident (unwitnessed crimes are unknowable to police).
    isWanted(personId: PersonId): boolean;
}
