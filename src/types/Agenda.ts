// The agenda substrate (task 085 / proposal D): persisted per-person planned intents — the intentionality
// layer between hourly needs and rare milestones. Entries are enqueued by producers (routines, social-visit
// planning, joint-activity invitations — later: restocking, milestones), proposed by the plannerHook inside
// their window, and consumed lazily: fulfillment and expiry are detected on read (no sweeps), the same
// closed-form discipline as needs/edges.

import { Value } from 'types/Simulation';
import { Predicate } from 'util/predicate';

export interface AgendaEntry {
    id: string;             // "g<seq>"
    personId: string;
    actionId: string;
    params?: Record<string, Value>;
    // Optional execution location: any action-location key, incl. 'person:<id>' (follow the person).
    locationOverride?: string;
    enqueuedAtTick: number; // fulfillment = the action occurred since this point
    earliestTick: number;
    latestTick: number;     // past this, the entry expires (a plan quietly falls through)
    // Deferred while false (evaluated against the person's context at propose time).
    prerequisites?: Predicate;
    // The routine template that produced this entry (dedup: one pending entry per routine per person).
    routineId?: string;
    causationId: number | null;
    source: string;         // which producer enqueued it (diagnostics)
}

export interface AgendaState {
    entries: Record<string, AgendaEntry>;
    nextSeq: number;
}

// The agenda surface consequence ops consult through SimulationMarkets (the joint-activity op).
export interface AgendaWriter {
    enqueue(entry: Omit<AgendaEntry, 'id'>): AgendaEntry;
}

// The full agenda surface the planner hook consults (implemented by game/actions/Agenda).
export interface AgendaAccess extends AgendaWriter {
    dueEntriesOf(personId: string, tick: number, hasAction: (actionId: string, query?: { withinTicks?: number; minCount?: number }) => boolean): AgendaEntry[];
    hasPendingRoutine(personId: string, routineId: string, tick: number): boolean;
    removeEntry(id: string): void;
    removePerson(personId: string): void;
}

// --- json/routines.json -------------------------------------------------------------------------------------

export interface RoutineTemplate {
    action: string;         // the action the routine plans (continuous or discrete)
    cadenceDays: number;    // re-plan when the action hasn't happened within this many days
    // Daily hour window [start, end] the entry is due within.
    window: [number, number];
    // Fraction of people who carry this routine (deterministic per worldSeed+personId).
    adoption: number;
    // Optional eligibility gate evaluated when assigning (age bands etc.).
    requires?: Predicate;
}

export type RoutinesConfig = Record<string, RoutineTemplate>;
