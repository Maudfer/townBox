// The city-incidents registry (task 099 / proposal G4). Crimes are reported here (City files them from the
// crime events' signals), the police day sweep resolves them (odds scale with witnesses and coverage), and
// the Brain's pursuit hook reads who is wanted. Serialized (save v16 family), deterministic, RNG-free —
// every roll happens in the callers, this is pure bookkeeping.

import { PersonId } from 'types/Genealogy';
import { IncidentKind, IncidentRecord, IncidentsReader, IncidentsState } from 'types/Incidents';

// Unwitnessed or long-unresolved cases go cold after this many ticks (30 days) — the trail is gone.
export const INCIDENT_COLD_AFTER_TICKS = 720;

export default class CityIncidents implements IncidentsReader {
    private state: IncidentsState;

    constructor() {
        this.state = { nextId: 1, incidents: [] };
    }

    report(kind: IncidentKind, tick: number, locationKey: string, suspectId: PersonId | null, witnesses: number): IncidentRecord {
        const record: IncidentRecord = { id: this.state.nextId, kind, tick, locationKey, suspectId, witnesses, status: 'open', resolvedTick: null };
        this.state.nextId += 1;
        this.state.incidents.push(record);
        return record;
    }

    open(): IncidentRecord[] {
        return this.state.incidents.filter(incident => incident.status === 'open');
    }

    all(): IncidentRecord[] {
        return [...this.state.incidents];
    }

    resolve(id: number, tick: number): void {
        const incident = this.state.incidents.find(candidate => candidate.id === id);
        if (incident && incident.status === 'open') {
            incident.status = 'resolved';
            incident.resolvedTick = tick;
        }
    }

    // Cold-case sweep: open incidents past the trail window go cold (a caller runs this on the day cadence).
    sweepCold(tick: number): void {
        for (const incident of this.state.incidents) {
            if (incident.status === 'open' && tick - incident.tick > INCIDENT_COLD_AFTER_TICKS) {
                incident.status = 'cold';
            }
        }
    }

    openFireAt(locationKey: string): boolean {
        return this.state.incidents.some(incident => incident.status === 'open' && incident.kind === 'fire' && incident.locationKey === locationKey);
    }

    anyOpenFire(): boolean {
        return this.state.incidents.some(incident => incident.status === 'open' && incident.kind === 'fire');
    }

    isWanted(personId: PersonId): boolean {
        return this.state.incidents.some(incident => incident.status === 'open' && incident.witnesses > 0 && incident.suspectId === personId);
    }

    // A death (or permanent departure) closes the person's open cases — nobody chases a ghost.
    removePerson(personId: PersonId): void {
        for (const incident of this.state.incidents) {
            if (incident.status === 'open' && incident.suspectId === personId) {
                incident.status = 'cold';
            }
        }
    }

    serialize(): IncidentsState {
        return { nextId: this.state.nextId, incidents: this.state.incidents.map(incident => ({ ...incident })) };
    }

    loadState(state: IncidentsState | undefined): void {
        this.state = state
            ? { nextId: state.nextId, incidents: state.incidents.map(incident => ({ ...incident })) }
            : { nextId: 1, incidents: [] };
    }
}
