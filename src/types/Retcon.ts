// Career retcons at hydration (task 098 / proposal I4). Asset people arrive fully formed, so a town that
// needs a nurse can wait forever — the compromise: when the coverage ledger reports a critical gap, a
// BOUNDED fraction of household draws may gain a plausible injected chapter (nursing school at 24), applied
// through the normal event/skill machinery at a PAST tick. Lineage, family, possessions, and every existing
// log entry are untouched — the retcon only ADDS. Deterministic per (worldSeed, house anchor).

export interface RetconTemplate {
    event: string; // an education event with a manual trigger + acquireSkill effects (the grants ARE the event's)
    atAgeYears: number; // the plausible age the chapter happened at
}

export interface RetconConfig {
    coverageBelow: number; // a service under this ratio counts as a critical gap
    chancePerHousehold: number; // the bounded fraction of draws that may carry a retcon
    minAgeYears: number; // candidate band (must exceed every template's atAgeYears)
    maxAgeYears: number;
    templates: Record<string, RetconTemplate>; // keyed by services.json service id
}
