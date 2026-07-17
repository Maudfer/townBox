// The canonical registration list for every file-based data schema (docs/tasks/039). Adding a new data file?
// Register it here with a structural validator (and a semantic one if it references other files), and add
// invalid-fixture coverage in test/dataValidation.test.ts — this is a working agreement (CLAUDE.md §5.5).
//
// validateAllData() is the single entry point: game boot asserts it (GameManager), CI gates on it
// (test/dataValidation.test.ts), and `npm run validate-data` runs it standalone for content-authoring loops.

import { SchemaRegistration, ValidationIssue, assertValid, validateRegistrations } from 'game/data/registry';
import { validateActionsSemantics, validateActionsStructure } from 'game/data/validators/actions';
import {
    validateBusinessesSemantics,
    validateBusinessesStructure,
    validateDemandSemantics,
    validateDemandStructure,
    validateJobsSemantics,
    validateJobsStructure,
    validateMaterialsStructure,
} from 'game/data/validators/economyContent';
import { validateEventsSemantics, validateEventsStructure } from 'game/data/validators/events';
import { validateOarSemantics, validateOarStructure } from 'game/data/validators/oar';
import { validateObjectsSemantics, validateObjectsStructure } from 'game/data/validators/objects';
import {
    validateArbitrationStructure,
    validateInventoryTuningStructure,
    validateFireStructure,
    validatePetsStructure,
    validatePetsSemantics,
    validateHabitsStructure,
    validateMoodStructure,
    validateHistoryGeneratorStructure,
    validateEconomyStructure,
    validateHouseholdDrawStructure,
    validateLifeSimulationStructure,
    validatePopulationStructure,
} from 'game/data/validators/params';
import { validateObjectGenerationStructure, validatePlacementSemantics, validatePlacementStructure, validateResidencesStructure } from 'game/data/validators/placement';
import { validateNeedsSemantics, validateNeedsStructure } from 'game/data/validators/needs';
import { validateRelationshipsSemantics, validateRelationshipsStructure } from 'game/data/validators/relationships';
import { validateRetconsSemantics, validateRetconsStructure, validateServicesSemantics, validateServicesStructure, validateVenuesSemantics, validateVenuesStructure } from 'game/data/validators/services';
import { validateRoutinesSemantics, validateRoutinesStructure } from 'game/data/validators/routines';
import { validateSchoolsSemantics, validateSchoolsStructure } from 'game/data/validators/school';
import { validateTraitsSemantics, validateTraitsStructure } from 'game/data/validators/traits';
import {
    validateSkillInitSemantics,
    validateSkillInitStructure,
    validateSkillsSemantics,
    validateSkillsStructure,
} from 'game/data/validators/skills';
import actionsConfig from 'json/actions.json';
import arbitrationConfig from 'json/arbitration.json';
import assetsConfig from 'json/assets.json';
import historyGeneratorConfig from 'json/historyGenerator.json';
import businessesConfig from 'json/businesses.json';
import config from 'json/config.json';
import constructionConfig from 'json/construction.json';
import demandConfig from 'json/demand.json';
import economyConfig from 'json/economy.json';
import eventsConfig from 'json/events.json';
import householdDrawConfig from 'json/householdDraw.json';
import inputConfig from 'json/input.json';
import fireConfig from 'json/fire.json';
import habitsConfig from 'json/habits.json';
import inventoryConfig from 'json/inventory.json';
import jobsConfig from 'json/jobs.json';
import lifeSimulationConfig from 'json/lifeSimulation.json';
import materialsConfig from 'json/materials.json';
import moodConfig from 'json/mood.json';
import servicesConfig from 'json/services.json';
import needsConfig from 'json/needs.json';
import oarConfig from 'json/object-action-relationships.json';
import objectsConfig from 'json/objects.json';
import objectGenerationConfig from 'json/objectGeneration.json';
import petsConfig from 'json/pets.json';
import placementConfig from 'json/placement.json';
import populationConfig from 'json/population.json';
import relationshipsConfig from 'json/relationships.json';
import residencesConfig from 'json/residences.json';
import retconsConfig from 'json/retcons.json';
import routinesConfig from 'json/routines.json';
import schoolsConfig from 'json/schools.json';
import skillInitConfig from 'json/skillInit.json';
import skillsConfig from 'json/skills.json';
import toolAssetsConfig from 'json/toolAssets.json';
import traitsConfig from 'json/traits.json';
import venuesConfig from 'json/venues.json';

import {
    validateAssetsStructure,
    validateConfigStructure,
    validateConstructionStructure,
    validateConstructionSemantics,
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
        { name: 'objects', version: 2, data: objectsConfig, validateStructure: validateObjectsStructure, validateSemantics: validateObjectsSemantics },
        { name: 'placement', version: 1, data: placementConfig, validateStructure: validatePlacementStructure, validateSemantics: validatePlacementSemantics },
        { name: 'residences', version: 1, data: residencesConfig, validateStructure: validateResidencesStructure },
        { name: 'objectGeneration', version: 1, data: objectGenerationConfig, validateStructure: validateObjectGenerationStructure },
        { name: 'skills', version: 2, data: skillsConfig, validateStructure: validateSkillsStructure, validateSemantics: validateSkillsSemantics },
        { name: 'skillInit', version: 1, data: skillInitConfig, validateStructure: validateSkillInitStructure, validateSemantics: validateSkillInitSemantics },
        { name: 'demand', version: 1, data: demandConfig, validateStructure: validateDemandStructure, validateSemantics: validateDemandSemantics },
        { name: 'economy', version: 1, data: economyConfig, validateStructure: validateEconomyStructure },
        { name: 'population', version: 1, data: populationConfig, validateStructure: validatePopulationStructure },
        { name: 'lifeSimulation', version: 1, data: lifeSimulationConfig, validateStructure: validateLifeSimulationStructure },
        { name: 'householdDraw', version: 1, data: householdDrawConfig, validateStructure: validateHouseholdDrawStructure },
        { name: 'historyGenerator', version: 1, data: historyGeneratorConfig, validateStructure: validateHistoryGeneratorStructure },
        { name: 'schools', version: 1, data: schoolsConfig, validateStructure: validateSchoolsStructure, validateSemantics: validateSchoolsSemantics },
        { name: 'relationships', version: 1, data: relationshipsConfig, validateStructure: validateRelationshipsStructure, validateSemantics: validateRelationshipsSemantics },
        { name: 'needs', version: 1, data: needsConfig, validateStructure: validateNeedsStructure, validateSemantics: validateNeedsSemantics },
        { name: 'arbitration', version: 1, data: arbitrationConfig, validateStructure: validateArbitrationStructure },
        { name: 'inventoryTuning', version: 1, data: inventoryConfig, validateStructure: validateInventoryTuningStructure },
        { name: 'mood', version: 1, data: moodConfig, validateStructure: validateMoodStructure },
        { name: 'habits', version: 1, data: habitsConfig, validateStructure: validateHabitsStructure },
        { name: 'fire', version: 1, data: fireConfig, validateStructure: validateFireStructure },
        { name: 'pets', version: 1, data: petsConfig, validateStructure: validatePetsStructure, validateSemantics: validatePetsSemantics },
        { name: 'services', version: 1, data: servicesConfig, validateStructure: validateServicesStructure, validateSemantics: validateServicesSemantics },
        { name: 'retcons', version: 1, data: retconsConfig, validateStructure: validateRetconsStructure, validateSemantics: validateRetconsSemantics },
        { name: 'venues', version: 1, data: venuesConfig, validateStructure: validateVenuesStructure, validateSemantics: validateVenuesSemantics },
        { name: 'construction', version: 1, data: constructionConfig, validateStructure: validateConstructionStructure, validateSemantics: validateConstructionSemantics },
        { name: 'traits', version: 1, data: traitsConfig, validateStructure: validateTraitsStructure, validateSemantics: validateTraitsSemantics },
        { name: 'routines', version: 1, data: routinesConfig, validateStructure: validateRoutinesStructure, validateSemantics: validateRoutinesSemantics },
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
