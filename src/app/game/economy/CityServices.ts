// The city-services coverage ledger (task 096 / proposal H1–H2). Pure derivation, serialized nowhere:
// computeCoverage turns a ServiceInputs snapshot into per-service ratios, and the CityServices reader holds
// the latest sweep for the engines (SimulationMarkets.services) and the dashboard. Deterministic and
// RNG-free. An unmeasured reader (no sweep yet — pure tests, off-map generation) reads the configured
// NEUTRAL coverage for every service, at which all published factor curves pass through 1: no ledger,
// no behavioral effect — the live↔bootstrap seam holds without a single mode branch.

import servicesConfig from 'json/services.json';
import { ServiceCoverage, ServiceCoverageReader, ServiceInputs, ServicesConfig } from 'types/Services';

export const SERVICES_CONFIG = servicesConfig as unknown as ServicesConfig;

// One coverage sweep. Education is seat-based (the SchoolRegistry capacity model): seats vs the enrollable
// band. Every other service is provider-based: a facility must exist (no hospital → 0 regardless of
// credentials walking around) and coverage is practicing providers over what the population warrants.
export function computeCoverage(inputs: ServiceInputs, config: ServicesConfig = SERVICES_CONFIG): ServiceCoverage[] {
    const lines: ServiceCoverage[] = [];
    for (const [service, def] of Object.entries(config.services)) {
        const providers = inputs.providersByService[service] ?? 0;
        const facilities = inputs.facilitiesByService[service] ?? 0;
        let needed: number;
        let ratio: number;
        if (service === 'education') {
            needed = inputs.schoolAgeChildren;
            ratio = needed === 0 ? 1 : Math.min(1, inputs.schoolSeats / needed);
            if (facilities === 0 && needed > 0) {
                ratio = 0;
            }
        } else {
            needed = Math.max(1, Math.ceil(inputs.population / def.residentsPerProvider));
            ratio = facilities === 0 ? 0 : Math.min(1, providers / needed);
        }
        lines.push({ service, label: def.label, providers, facilities, needed, ratio });
    }
    return lines.sort((a, b) => a.service.localeCompare(b.service));
}

// Squalor saturation (LP-8): this many uncollected curb bags PER RESIDENT reads as full squalor (1.0).
// Below it the reading scales linearly — a working collection loop keeps the town near 0.
export const BAGS_PER_RESIDENT_FULL_SQUALOR = 3;

// Pure derivation (LP-8): uncollected curb bags per resident, clamped to [0, 1].
export function computeSqualor(curbBags: number, population: number): number {
    if (population <= 0 || curbBags <= 0) {
        return 0;
    }
    return Math.min(1, curbBags / (population * BAGS_PER_RESIDENT_FULL_SQUALOR));
}

export default class CityServices implements ServiceCoverageReader {
    private coverages: Map<string, ServiceCoverage> | null; // null until the first sweep = unmeasured
    private config: ServicesConfig;
    private squalor = 0; // outcome reading (LP-8): 0 until a sweep measures curb bags

    constructor(config: ServicesConfig = SERVICES_CONFIG) {
        this.coverages = null;
        this.config = config;
    }

    update(inputs: ServiceInputs): ServiceCoverage[] {
        const lines = computeCoverage(inputs, this.config);
        this.coverages = new Map(lines.map(line => [line.service, line]));
        this.squalor = computeSqualor(inputs.curbBags ?? 0, inputs.population);
        return lines;
    }

    coverageOf(service: string): number {
        if (!this.coverages) {
            return this.config.neutralCoverage;
        }
        return this.coverages.get(service)?.ratio ?? 0;
    }

    // Town squalor 0..1 (LP-8): garbage that actually sits uncollected — the coverage ledger's OUTCOME
    // sibling. The proposal's founding example: piled trash must cause disease, not just render bags.
    squalorOf(): number {
        return this.squalor;
    }

    latest(): ServiceCoverage[] {
        return this.coverages ? [...this.coverages.values()].sort((a, b) => a.service.localeCompare(b.service)) : [];
    }
}
