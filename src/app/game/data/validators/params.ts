// Validators for the tunable-parameter files: economy, population, lifeSimulation, householdDraw, historyGenerator.
// Mostly structural numeric sanity; the load-bearing cross-check is that every `ticksPerYear` mirrors the
// clock's tick constant — the genealogy tick contract (CLAUDE.md §4.12; hour ticks since task 040).

import { checkArray, checkBoolean, checkNumber, checkRecord, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
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
        if (!(DRAWABLE_ARRANGEMENTS as readonly HouseholdArrangements[]).includes(arrangement as HouseholdArrangements)) {
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

// The offline history-asset generator config (task 055, json/historyGenerator.json). Dev-tooling config
// consumed by the CLI (scripts/generateHistoryAsset.ts); registered here so it fails loudly like every other
// data file (CLAUDE.md §5.5).
export function validateHistoryGeneratorStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    const fields = ['seed', 'founderCount', 'recordThreshold', 'recordYears', 'ticksPerYear', 'daysPerStep', 'warmMarginYears', 'maxWarmupYears', 'keepActionLog', 'reducedEventManifest', 'profile', 'skillSnapshotYears', 'flushIntervalYears', 'populationControl', 'logicalWorld', 'safety'];
    checkUnknownKeys(issues, '', data, fields);
    checkNumber(issues, 'seed', data['seed'], { integer: true });
    checkNumber(issues, 'founderCount', data['founderCount'], { min: 2, integer: true });
    checkNumber(issues, 'recordThreshold', data['recordThreshold'], { min: 1, integer: true });
    checkNumber(issues, 'recordYears', data['recordYears'], { min: 1 });
    if (checkNumber(issues, 'ticksPerYear', data['ticksPerYear'], { min: 1, integer: true }) && data['ticksPerYear'] !== TICKS_PER_YEAR) {
        issues.add('ticksPerYear', `must equal the clock's TICKS_PER_YEAR (${TICKS_PER_YEAR}), got ${data['ticksPerYear']}`);
    }
    checkNumber(issues, 'daysPerStep', data['daysPerStep'], { min: 1, integer: true });
    checkNumber(issues, 'warmMarginYears', data['warmMarginYears'], { min: 0 });
    checkNumber(issues, 'maxWarmupYears', data['maxWarmupYears'], { min: 1 });
    checkBoolean(issues, 'keepActionLog', data['keepActionLog']);
    checkBoolean(issues, 'reducedEventManifest', data['reducedEventManifest']);
    checkBoolean(issues, 'profile', data['profile']);
    checkNumber(issues, 'skillSnapshotYears', data['skillSnapshotYears'], { min: 1, integer: true });
    checkNumber(issues, 'flushIntervalYears', data['flushIntervalYears'], { min: 1, integer: true });
    if (checkRecord(issues, 'populationControl', data['populationControl'])) {
        const control = data['populationControl'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'populationControl', control, ['enabled', 'target', 'band', 'suppressLevel', 'allowLevel']);
        checkBoolean(issues, 'populationControl.enabled', control['enabled']);
        checkNumber(issues, 'populationControl.target', control['target'], { min: 1, integer: true });
        checkNumber(issues, 'populationControl.band', control['band'], { min: 0, max: 1 });
        checkNumber(issues, 'populationControl.suppressLevel', control['suppressLevel'], { min: 0, max: 1 });
        checkNumber(issues, 'populationControl.allowLevel', control['allowLevel'], { min: 0, max: 1 });
    }
    if (checkRecord(issues, 'safety', data['safety'])) {
        const safety = data['safety'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'safety', safety, ['maxRuntimeMs', 'maxPeople']);
        checkNumber(issues, 'safety.maxRuntimeMs', safety['maxRuntimeMs'], { min: 0, integer: true });
        checkNumber(issues, 'safety.maxPeople', safety['maxPeople'], { min: 0, integer: true });
    }
    if (checkRecord(issues, 'logicalWorld', data['logicalWorld'])) {
        const logical = data['logicalWorld'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'logicalWorld', logical, ['enabled', 'homes', 'schools', 'jobs', 'objects']);
        for (const flag of ['enabled', 'homes', 'schools', 'jobs', 'objects']) {
            checkBoolean(issues, `logicalWorld.${flag}`, logical[flag]);
        }
    }
}

// json/arbitration.json (task 086): the interruption matrix thresholds.
export function validateArbitrationStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'arbitration', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'arbitration', config, ['sameBandUtilityDelta', 'decisionCooldownTicks', 'resumeWindowTicks']);
    checkNumber(issues, 'arbitration.sameBandUtilityDelta', config['sameBandUtilityDelta'], { min: 0 });
    checkNumber(issues, 'arbitration.decisionCooldownTicks', config['decisionCooldownTicks'], { min: 0, integer: true });
    checkNumber(issues, 'arbitration.resumeWindowTicks', config['resumeWindowTicks'], { min: 1, integer: true });
}

// json/inventory.json (task 088): carry budgets + the acquisitive hook's chances.
export function validateInventoryTuningStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'inventory', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'inventory', config, ['maxCarriedWeightGrams', 'maxBulkyItems', 'stowAboveFraction', 'curiosityChancePerTick', 'fiddleChancePerTick', 'pantryFetchBelowFood']);
    checkNumber(issues, 'inventory.maxCarriedWeightGrams', config['maxCarriedWeightGrams'], { min: 1 });
    checkNumber(issues, 'inventory.maxBulkyItems', config['maxBulkyItems'], { min: 1, integer: true });
    const fractions: [string, unknown][] = [['stowAboveFraction', config['stowAboveFraction']], ['curiosityChancePerTick', config['curiosityChancePerTick']], ['fiddleChancePerTick', config['fiddleChancePerTick']]];
    for (const [key, value] of fractions) {
        if (typeof value !== 'number' || value < 0 || value > 1) {
            issues.add(`inventory.${key}`, 'expected a fraction in [0, 1]');
        }
    }
    checkNumber(issues, 'inventory.pantryFetchBelowFood', config['pantryFetchBelowFood'], { min: 0 });
}
