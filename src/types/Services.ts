// City services & the coverage ledger (task 096 / proposal H1–H2). A pure DERIVATION over data that already
// exists — businesses, jobs, school seats, the population — recomputed on the day cadence and serialized
// nowhere. Each service's coverage is a ratio (0..1), never a boolean, and publishes as a factor the engines
// consume: recovery hazards read healthcare coverage (092's arc), the crime gate will read police coverage
// (099), fire outcomes fire coverage (102). "The town has no doctor" becomes a measured number with teeth.

// One service line in json/services.json. `providerJobs` are jobs.json KEYS; a provider only counts while
// employed at one of the service's facilities (a doctor at the hospital practices; one flipping burgers
// doesn't). `facilityBlueprints` are businesses.json keys. A service may declare no facilities yet (garbage
// until 101, jail until 100) — its coverage honestly reads 0 and the dashboard says so.
export interface ServiceDefinition {
    label: string;
    providerJobs: string[];
    facilityBlueprints: string[];
    residentsPerProvider: number; // one practicing provider covers this many residents
    // The nagbar copy (task 114): what the player reads when this line sits below the advisory threshold.
    warning: string;
}

export interface ServicesConfig {
    // What an UNMEASURED town reads (off-map generation, pure tests, pre-first-sweep): the coverage level at
    // which every published factor curve passes through 1 — no ledger, no effect.
    neutralCoverage: number;
    advisoryBelow: number; // monthly feed advisory threshold for the worst uncovered service
    services: Record<string, ServiceDefinition>;
}

// A computed coverage line (the ledger's output, shown on the city dashboard).
export interface ServiceCoverage {
    service: string;
    label: string;
    providers: number;
    facilities: number;
    needed: number; // providers the current population warrants
    ratio: number; // 0..1
}

// The inputs the pure computation runs over — built by City from the real map (and by future off-map
// callers from their logical worlds), so the math itself stays scene-free and unit-testable.
export interface ServiceInputs {
    population: number;
    providersByService: Record<string, number>;
    facilitiesByService: Record<string, number>;
    schoolSeats: number; // education numerator (capacity curve over school sizes)
    schoolAgeChildren: number; // education denominator (enrollable band)
}

// The surface the engines consult through SimulationMarkets.services.
export interface ServiceCoverageReader {
    coverageOf(service: string): number;
}
