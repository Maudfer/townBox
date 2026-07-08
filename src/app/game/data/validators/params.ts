// Validators for the tunable-parameter files: economy, population, lifeSimulation, householdDraw, bootstrap.
// Mostly structural numeric sanity; the load-bearing cross-check is that every `ticksPerYear` mirrors the
// clock's tick constant — the genealogy tick contract (CLAUDE.md §4.12; hour ticks since task 040).

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkBoolean, checkNumber, checkRecord, checkUnknownKeys } from 'game/data/checks';
import { HouseholdArrangements } from 'types/Household';
import { TICKS_PER_YEAR } from 'util/time';

export function validateEconomyStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    const fields = ['startingPersonFunds', 'startingBusinessCapital', 'housingCost', 'perCapitaCost', 'growthMonths', 'shrinkMonths', 'bankruptcyDebtFloor', 'bankruptcyMonths', 'reoccupancyMonths', 'evictionArrearsMonths', 'recoveryFunds'];
    checkUnknownKeys(issues, '', data, fields);
    for (const field of ['startingPersonFunds', 'startingBusinessCapital', 'housingCost', 'perCapitaCost', 'recoveryFunds']) {
        checkNumber(issues, field, data[field], { min: 0 });
    }
    for (const field of ['growthMonths', 'shrinkMonths', 'bankruptcyMonths', 'reoccupancyMonths', 'evictionArrearsMonths']) {
        checkNumber(issues, field, data[field], { min: 1, integer: true });
    }
    checkNumber(issues, 'bankruptcyDebtFloor', data['bankruptcyDebtFloor'], { max: 0 });
}

export function validatePopulationStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    const fields = ['ticksPerYear', 'founderCouples', 'generations', 'childDistribution', 'pairingProbability', 'immigrantSpouseProbability', 'spouseMaxAgeGapYears', 'parentMinAgeYears', 'parentMaxAgeYears', 'generationGapYears', 'lifespanMeanYears', 'lifespanSpreadYears', 'maxPopulation'];
    checkUnknownKeys(issues, '', data, fields);
    if (checkNumber(issues, 'ticksPerYear', data['ticksPerYear'], { min: 1, integer: true }) && data['ticksPerYear'] !== TICKS_PER_YEAR) {
        // The genealogy tick contract: birth/death ticks are day indexes against the live clock's calendar.
        issues.add('ticksPerYear', `must equal the clock's TICKS_PER_YEAR (${TICKS_PER_YEAR}), got ${data['ticksPerYear']}`);
    }
    checkNumber(issues, 'founderCouples', data['founderCouples'], { min: 1, integer: true });
    checkNumber(issues, 'generations', data['generations'], { min: 1, integer: true });
    if (checkArray(issues, 'childDistribution', data['childDistribution'])) {
        const distribution = data['childDistribution'] as unknown[];
        let sum = 0;
        let numeric = true;
        distribution.forEach((weight, index) => {
            if (checkNumber(issues, `childDistribution[${index}]`, weight, { min: 0, max: 1 })) {
                sum += weight as number;
            } else {
                numeric = false;
            }
        });
        if (numeric && Math.abs(sum - 1) > 0.001) {
            issues.add('childDistribution', `probabilities must sum to 1 (got ${sum.toFixed(4)})`);
        }
    }
    for (const field of ['pairingProbability', 'immigrantSpouseProbability']) {
        checkNumber(issues, field, data[field], { min: 0, max: 1 });
    }
    for (const field of ['spouseMaxAgeGapYears', 'parentMinAgeYears', 'parentMaxAgeYears', 'generationGapYears', 'lifespanMeanYears', 'lifespanSpreadYears']) {
        checkNumber(issues, field, data[field], { min: 0 });
    }
    if (typeof data['parentMinAgeYears'] === 'number' && typeof data['parentMaxAgeYears'] === 'number' && data['parentMinAgeYears'] > data['parentMaxAgeYears']) {
        issues.add('parentMinAgeYears', `must be <= parentMaxAgeYears`);
    }
    checkNumber(issues, 'maxPopulation', data['maxPopulation'], { min: 1, integer: true });
}

export function validateLifeSimulationStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    const fields = ['mortalityBase', 'mortalityGrowth', 'maxMortality', 'maxAgeYears', 'annualBirthProbability', 'fertileMinAgeYears', 'fertileMaxAgeYears', 'maxCatchUpYears'];
    checkUnknownKeys(issues, '', data, fields);
    checkNumber(issues, 'mortalityBase', data['mortalityBase'], { min: 0, max: 1 });
    checkNumber(issues, 'mortalityGrowth', data['mortalityGrowth'], { min: 0 });
    checkNumber(issues, 'maxMortality', data['maxMortality'], { min: 0, max: 1 });
    checkNumber(issues, 'maxAgeYears', data['maxAgeYears'], { min: 1 });
    checkNumber(issues, 'annualBirthProbability', data['annualBirthProbability'], { min: 0, max: 1 });
    const minOk = checkNumber(issues, 'fertileMinAgeYears', data['fertileMinAgeYears'], { min: 0 });
    const maxOk = checkNumber(issues, 'fertileMaxAgeYears', data['fertileMaxAgeYears'], { min: 0 });
    if (minOk && maxOk && (data['fertileMinAgeYears'] as number) > (data['fertileMaxAgeYears'] as number)) {
        issues.add('fertileMinAgeYears', 'must be <= fertileMaxAgeYears');
    }
    checkNumber(issues, 'maxCatchUpYears', data['maxCatchUpYears'], { min: 1 });
}

const DRAWABLE_ARRANGEMENTS = Object.values(HouseholdArrangements).filter(value => value !== HouseholdArrangements.Homeless);

export function validateHouseholdDrawStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, ['adultAgeYears', 'maxRoommates', 'arrangementWeights']);
    checkNumber(issues, 'adultAgeYears', data['adultAgeYears'], { min: 1, integer: true });
    checkNumber(issues, 'maxRoommates', data['maxRoommates'], { min: 1, integer: true });
    if (!checkRecord(issues, 'arrangementWeights', data['arrangementWeights'])) {
        return;
    }
    const weights = data['arrangementWeights'] as Record<string, unknown>;
    let sum = 0;
    for (const [arrangement, weight] of Object.entries(weights)) {
        if (!DRAWABLE_ARRANGEMENTS.includes(arrangement as HouseholdArrangements)) {
            // Homeless is reached only via eviction (task 022); it must never be drawable.
            issues.add(`arrangementWeights.${arrangement}`, `not a drawable arrangement (allowed: ${DRAWABLE_ARRANGEMENTS.join(', ')})`);
            continue;
        }
        if (checkNumber(issues, `arrangementWeights.${arrangement}`, weight, { min: 0 })) {
            sum += weight as number;
        }
    }
    if (sum <= 0) {
        issues.add('arrangementWeights', 'at least one arrangement needs a positive weight');
    }
}

export function validateBootstrapStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, ['enabled', 'years', 'ticksPerYear', 'stepDays']);
    checkBoolean(issues, 'enabled', data['enabled']);
    checkNumber(issues, 'years', data['years'], { min: 0 });
    if (checkNumber(issues, 'ticksPerYear', data['ticksPerYear'], { min: 1, integer: true }) && data['ticksPerYear'] !== TICKS_PER_YEAR) {
        issues.add('ticksPerYear', `must equal the clock's TICKS_PER_YEAR (${TICKS_PER_YEAR}), got ${data['ticksPerYear']}`);
    }
    checkNumber(issues, 'stepDays', data['stepDays'], { min: 1, integer: true });
}
