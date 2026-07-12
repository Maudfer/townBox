// Traits & temperament (task 087 / proposal M): six per-person axes (0–100) that explain why THIS person
// acts THIS way — the other half of "too much looks random" (needs explain why anyone acts NOW). Traits are
// NEVER serialized: they are a pure function of (worldSeed, personId, parents), derived on demand with mild
// heritability, so asset people, newborns and cold-start pools all get them with zero migration.

export const TRAIT_IDS = ['sociability', 'industriousness', 'temper', 'riskAppetite', 'orderliness', 'hedonism'] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

export type PersonTraits = Record<TraitId, number>;

// The reader surface engines consult through SimulationMarkets.
export interface TraitsReader {
    traitsOf(personId: string): PersonTraits;
    // The selection-weight multiplier for an action's affinity tags (json/traits.json maps tag → axis).
    affinityMultiplier(personId: string, affinity: string[] | undefined): number;
}

// --- json/traits.json ---------------------------------------------------------------------------------------

export interface TraitsConfig {
    // How much of a child's axis comes from the parents' average (the rest is their own seeded roll).
    heritability: number;
    // Affinity tag → the axis it reads and how strongly (multiplier range scales with weight).
    affinities: Record<string, { axis: TraitId; weight: number }>;
    // Inspector prose: per-axis phrases for the low/high ends (shown when the axis is past the band).
    phrases: Record<TraitId, { low: string; high: string; band: number }>;
    // Consent shifts (task 087 M2): the target's temperament nudges the accept probability.
    consent: { sociabilityWeight: number; temperWeight: number };
}
