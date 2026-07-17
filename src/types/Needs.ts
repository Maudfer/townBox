// The needs substrate (task 084 / proposal A): six per-person meters whose urgency continuously reshapes
// action selection. Levels are 0–100 (100 = fully satisfied) and decay CLOSED-FORM from `updatedAtTick`
// (linear per-day rates — no per-tick mutation, the K2 stride-tolerance rule), so live hourly play and the
// generator's day strides integrate identically. The need SET is closed (code); rates, criticals and the
// urgency gradient are authored in json/needs.json.

import { Curve } from 'util/curve';

export const NEED_IDS = ['food', 'rest', 'social', 'fun', 'hygiene', 'purpose'] as const;
export type NeedId = (typeof NEED_IDS)[number];

export interface NeedRecord {
    level: number;         // 0–100 as of updatedAtTick
    updatedAtTick: number;
}

export type PersonNeeds = Record<NeedId, NeedRecord>;

export interface NeedsState {
    people: Record<string, PersonNeeds>;
}

export interface NeedConfig {
    decayPerDay: number; // linear level loss per in-game day
    critical: number;    // at/below this level the needsHook proposes a required intent
}

export interface NeedsConfig {
    needs: Record<NeedId, NeedConfig>;
    // Maps a need LEVEL (0–100) to a selection-weight multiplier for actions that satisfy it: starving ≈ ×6,
    // sated ≈ ×0.4. One shared gradient (the substrate Curve grammar) so data keeps the last word.
    urgencyCurve: Curve;
    // Initial levels for a person entering detailed simulation: seeded uniformly in [initMin, initMax].
    initMin: number;
    initMax: number;
}

// The ledger surface engines consult through SimulationMarkets (mirrors RelationshipGraph's pattern).
export interface NeedsReader {
    levelOf(personId: string, need: NeedId, tick: number, worldSeed: number): number;
    satisfy(personId: string, satisfies: Partial<Record<NeedId, number>>, tick: number, worldSeed: number): void;
    selectionMultiplier(personId: string, satisfies: Partial<Record<NeedId, number>> | undefined, tick: number, worldSeed: number): number;
    // One-pass per-need urgency (task 118): selection loops take the max over an action's satisfied needs
    // against this table instead of re-deriving the same decayed levels per candidate. Optional — minimal
    // test doubles fall back to selectionMultiplier.
    urgencyByNeed?(personId: string, tick: number, worldSeed: number): Record<NeedId, number>;
    criticalNeedsOf(personId: string, tick: number, worldSeed: number): NeedId[];
}
