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

// json/retcons.json (task 098): the career-retcon templates. Structure: numeric sanity + the age-band
// contract (a candidate must already have been atAgeYears at draw time, so minAgeYears must exceed every
// template's atAgeYears). Semantics: each template's service must exist in services.json, and its event
// must exist in events.json with a manual trigger (the retcon invokes it) and acquireSkill effects (a
// chapter that grants nothing staffs nothing).
const RETCON_KEYS = ['coverageBelow', 'chancePerHousehold', 'minAgeYears', 'maxAgeYears', 'templates'];

export function validateRetconsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'retcons', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'retcons', config, RETCON_KEYS);
    checkNumber(issues, 'retcons.coverageBelow', config['coverageBelow'], { min: 0, max: 1 });
    checkNumber(issues, 'retcons.chancePerHousehold', config['chancePerHousehold'], { min: 0, max: 1 });
    const minOk = checkNumber(issues, 'retcons.minAgeYears', config['minAgeYears'], { min: 18 });
    checkNumber(issues, 'retcons.maxAgeYears', config['maxAgeYears'], { min: 18 });
    if (!checkRecord(issues, 'retcons.templates', config['templates'])) {
        return;
    }
    for (const [service, spec] of Object.entries(config['templates'] as Record<string, unknown>)) {
        const path = `retcons.templates.${service}`;
        if (!checkRecord(issues, path, spec)) {
            continue;
        }
        const template = spec as Record<string, unknown>;
        checkUnknownKeys(issues, path, template, ['event', 'atAgeYears']);
        checkString(issues, `${path}.event`, template['event']);
        const ageOk = checkNumber(issues, `${path}.atAgeYears`, template['atAgeYears'], { min: 18 });
        if (minOk && ageOk && (template['atAgeYears'] as number) >= (config['minAgeYears'] as number)) {
            issues.add(`${path}.atAgeYears`, 'must be below retcons.minAgeYears (the chapter must fit in the candidate\'s past)');
        }
    }
}

export function validateRetconsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const config = data as { templates?: Record<string, { event?: string }> };
    const services = Object.keys(((peers['services'] ?? {}) as { services?: Record<string, unknown> }).services ?? {});
    const events = (peers['events'] ?? {}) as Record<string, { triggers?: { manual?: unknown }; effects?: { type?: string }[] }>;
    for (const [service, template] of Object.entries(config.templates ?? {})) {
        const path = `retcons.templates.${service}`;
        if (!services.includes(service)) {
            issues.add(path, `unknown service "${service}" (not in services.json)`);
        }
        const event = template.event !== undefined ? events[template.event] : undefined;
        if (!event) {
            issues.add(`${path}.event`, `unknown event "${template.event}" (not in events.json)`);
            continue;
        }
        if (!event.triggers?.manual) {
            issues.add(`${path}.event`, `event "${template.event}" declares no manual trigger — the retcon cannot invoke it`);
        }
        if (!(event.effects ?? []).some(effect => effect.type === 'acquireSkill')) {
            issues.add(`${path}.event`, `event "${template.event}" grants no skills — a retcon chapter must make the person employable`);
        }
    }
}

// json/venues.json (task 107): venue kind -> hosting blueprint keys. Semantics both ways: every
// venue:<kind> any action targets must be mapped (an unmapped kind can never resolve in live mode), and
// every mapped blueprint must exist.
export function validateVenuesStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'venues', data)) {
        return;
    }
    for (const [venue, hosts] of Object.entries(data as Record<string, unknown>)) {
        if (checkArray(issues, 'venues.' + venue, hosts)) {
            (hosts as unknown[]).forEach((host, index) => checkString(issues, 'venues.' + venue + '[' + index + ']', host));
            if ((hosts as unknown[]).length === 0) {
                issues.add('venues.' + venue, 'a venue must name at least one hosting blueprint');
            }
        }
    }
}

export function validateVenuesSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const venues = data as Record<string, string[]>;
    const blueprints = new Set(Object.keys((peers['businesses'] ?? {}) as Record<string, unknown>));
    for (const [venue, hosts] of Object.entries(venues)) {
        for (const host of hosts) {
            if (!blueprints.has(host)) {
                issues.add('venues.' + venue, 'unknown blueprint "' + host + '" (not in businesses.json)');
            }
        }
    }
    const actions = (peers['actions'] ?? {}) as Record<string, { location?: string }>;
    for (const [actionId, def] of Object.entries(actions)) {
        if (typeof def.location === 'string' && def.location.startsWith('venue:')) {
            const kind = def.location.slice('venue:'.length);
            if (!(kind in venues)) {
                issues.add('venues', actionId + ' targets venue:' + kind + ' but no hosting blueprints are mapped — it could never resolve in live play');
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
