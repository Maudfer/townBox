// The canonical registration list for every file-based data schema (docs/tasks/039). Adding a new data file?
// Register it here with a structural validator (and a semantic one if it references other files), and add
// invalid-fixture coverage in test/dataValidation.test.ts — this is a working agreement (CLAUDE.md §5.5).
//
// validateAllData() is the single entry point: game boot asserts it (GameManager), CI gates on it
// (test/dataValidation.test.ts), and `npm run validate-data` runs it standalone for content-authoring loops.

import actionsConfig from 'json/actions.json';
import assetsConfig from 'json/assets.json';
import bootstrapConfig from 'json/bootstrap.json';
import businessesConfig from 'json/businesses.json';
import config from 'json/config.json';
import demandConfig from 'json/demand.json';
import economyConfig from 'json/economy.json';
import eventsConfig from 'json/events.json';
import householdDrawConfig from 'json/householdDraw.json';
import inputConfig from 'json/input.json';
import jobsConfig from 'json/jobs.json';
import lifeSimulationConfig from 'json/lifeSimulation.json';
import materialsConfig from 'json/materials.json';
import oarConfig from 'json/object-action-relationships.json';
import objectsConfig from 'json/objects.json';
import populationConfig from 'json/population.json';
import schoolsConfig from 'json/schools.json';
import skillsConfig from 'json/skills.json';
import toolAssetsConfig from 'json/toolAssets.json';

import { SchemaRegistration, ValidationIssue, assertValid, validateRegistrations } from 'game/data/registry';
import { validateEventsSemantics, validateEventsStructure } from 'game/data/validators/events';
import {
    validateBusinessesSemantics,
    validateBusinessesStructure,
    validateDemandSemantics,
    validateDemandStructure,
    validateJobsSemantics,
    validateJobsStructure,
    validateMaterialsStructure,
    validateSkillsSemantics,
    validateSkillsStructure,
} from 'game/data/validators/economyContent';
import {
    validateBootstrapStructure,
    validateEconomyStructure,
    validateHouseholdDrawStructure,
    validateLifeSimulationStructure,
    validatePopulationStructure,
} from 'game/data/validators/params';
import { validateActionsSemantics, validateActionsStructure } from 'game/data/validators/actions';
import { validateSchoolsSemantics, validateSchoolsStructure } from 'game/data/validators/school';
import { validateOarSemantics, validateOarStructure } from 'game/data/validators/oar';
import { validateObjectsStructure } from 'game/data/validators/objects';
import {
    validateAssetsStructure,
    validateConfigStructure,
    validateInputStructure,
    validateToolAssetsStructure,
    validateToolAssetsSemantics,
} from 'game/data/validators/ui';

export function allRegistrations(): SchemaRegistration[] {
    return [
        { name: 'events', version: 1, data: eventsConfig, validateStructure: validateEventsStructure, validateSemantics: validateEventsSemantics },
        { name: 'actions', version: 1, data: actionsConfig, validateStructure: validateActionsStructure, validateSemantics: validateActionsSemantics },
        { name: 'objectActionRelationships', version: 1, data: oarConfig, validateStructure: validateOarStructure, validateSemantics: validateOarSemantics },
        { name: 'jobs', version: 1, data: jobsConfig, validateStructure: validateJobsStructure, validateSemantics: validateJobsSemantics },
        { name: 'businesses', version: 1, data: businessesConfig, validateStructure: validateBusinessesStructure, validateSemantics: validateBusinessesSemantics },
        { name: 'materials', version: 1, data: materialsConfig, validateStructure: validateMaterialsStructure },
        { name: 'objects', version: 1, data: objectsConfig, validateStructure: validateObjectsStructure },
        { name: 'skills', version: 1, data: skillsConfig, validateStructure: validateSkillsStructure, validateSemantics: validateSkillsSemantics },
        { name: 'demand', version: 1, data: demandConfig, validateStructure: validateDemandStructure, validateSemantics: validateDemandSemantics },
        { name: 'economy', version: 1, data: economyConfig, validateStructure: validateEconomyStructure },
        { name: 'population', version: 1, data: populationConfig, validateStructure: validatePopulationStructure },
        { name: 'lifeSimulation', version: 1, data: lifeSimulationConfig, validateStructure: validateLifeSimulationStructure },
        { name: 'householdDraw', version: 1, data: householdDrawConfig, validateStructure: validateHouseholdDrawStructure },
        { name: 'bootstrap', version: 1, data: bootstrapConfig, validateStructure: validateBootstrapStructure },
        { name: 'schools', version: 1, data: schoolsConfig, validateStructure: validateSchoolsStructure, validateSemantics: validateSchoolsSemantics },
        { name: 'assets', version: 1, data: assetsConfig, validateStructure: validateAssetsStructure },
        { name: 'config', version: 1, data: config, validateStructure: validateConfigStructure },
        { name: 'input', version: 1, data: inputConfig, validateStructure: validateInputStructure },
        { name: 'toolAssets', version: 1, data: toolAssetsConfig, validateStructure: validateToolAssetsStructure, validateSemantics: validateToolAssetsSemantics },
    ];
}

export function validateAllData(): ValidationIssue[] {
    return validateRegistrations(allRegistrations());
}

// Loud failure at boot: a data file that would silently misbehave at runtime stops the game from starting.
export function assertValidData(): void {
    assertValid(allRegistrations());
}
