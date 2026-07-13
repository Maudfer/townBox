// Validator for the city-services config (src/json/services.json, task 096). Structure: shapes and numeric
// sanity. Semantics: providerJobs must be jobs.json keys, facilityBlueprints must be businesses.json
// blueprint keys (a dangling reference means the ledger silently counts nothing), and the education service
// the coverage math special-cases must exist.

import { checkArray, checkNumber, checkRecord, checkString, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';

const CONFIG_KEYS = ['neutralCoverage', 'advisoryBelow', 'services'];
const SERVICE_KEYS = ['label', 'providerJobs', 'facilityBlueprints', 'residentsPerProvider'];

export function validateServicesStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'services', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'services', config, CONFIG_KEYS);
    checkNumber(issues, 'services.neutralCoverage', config['neutralCoverage'], { min: 0, max: 1 });
    checkNumber(issues, 'services.advisoryBelow', config['advisoryBelow'], { min: 0, max: 1 });
    if (!checkRecord(issues, 'services.services', config['services'])) {
        return;
    }
    const services = config['services'] as Record<string, unknown>;
    if (!('education' in services)) {
        issues.add('services.services', 'the education service must be declared (its coverage is seat-based, special-cased by the ledger)');
    }
    for (const [id, spec] of Object.entries(services)) {
        const path = `services.services.${id}`;
        if (!checkRecord(issues, path, spec)) {
            continue;
        }
        const service = spec as Record<string, unknown>;
        checkUnknownKeys(issues, path, service, SERVICE_KEYS);
        checkString(issues, `${path}.label`, service['label']);
        checkNumber(issues, `${path}.residentsPerProvider`, service['residentsPerProvider'], { min: 1 });
        for (const listKey of ['providerJobs', 'facilityBlueprints'] as const) {
            if (checkArray(issues, `${path}.${listKey}`, service[listKey])) {
                (service[listKey] as unknown[]).forEach((entry, index) => {
                    checkString(issues, `${path}.${listKey}[${index}]`, entry);
                });
            }
        }
    }
}

export function validateServicesSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const config = data as { services?: Record<string, { providerJobs?: unknown[]; facilityBlueprints?: unknown[] }> };
    const jobs = new Set(Object.keys((peers['jobs'] ?? {}) as Record<string, unknown>));
    const blueprints = new Set(Object.keys((peers['businesses'] ?? {}) as Record<string, unknown>));
    for (const [id, service] of Object.entries(config.services ?? {})) {
        for (const jobKey of (service.providerJobs ?? []) as string[]) {
            if (!jobs.has(jobKey)) {
                issues.add(`services.services.${id}.providerJobs`, `unknown job "${jobKey}" (not in jobs.json)`);
            }
        }
        for (const blueprintKey of (service.facilityBlueprints ?? []) as string[]) {
            if (!blueprints.has(blueprintKey)) {
                issues.add(`services.services.${id}.facilityBlueprints`, `unknown blueprint "${blueprintKey}" (not in businesses.json)`);
            }
        }
    }
}
