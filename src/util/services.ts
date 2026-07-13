// The services nagbar's pure logic (task 114): which coverage lines warrant the banner, and the dismissal
// key. Kept out of React so the threshold-crossing behavior is unit-testable — the HUD component only
// renders what these functions decide.

import { ServiceCoverage, ServicesConfig } from 'types/Services';

export interface ServiceWarning {
    service: string;
    label: string;
    warning: string;
    ratio: number;
}

// Lines below the advisory threshold, worst first — each carrying its authored warning copy.
export function computeServiceWarnings(lines: ServiceCoverage[], config: ServicesConfig): ServiceWarning[] {
    return lines
        .filter(line => line.ratio < config.advisoryBelow)
        .map(line => ({
            service: line.service,
            label: line.label,
            warning: config.services[line.service]?.warning ?? `${line.label} coverage is critically low`,
            ratio: line.ratio,
        }))
        .sort((a, b) => a.ratio - b.ratio || a.service.localeCompare(b.service));
}

// Dismissal is per-service-SET (the ratified behavior): dismissing today's warnings holds until the set
// itself changes — a NEW service degrading (or one recovering) re-arms the banner.
export function warningsKey(warnings: ServiceWarning[]): string {
    return warnings.map(warning => warning.service).sort().join('|');
}
