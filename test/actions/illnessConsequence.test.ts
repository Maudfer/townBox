import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import { SICK_HEALTH_THRESHOLD } from 'game/actions/JobOrchestrator';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import eventsConfig from 'json/events.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { SchoolFacts } from 'types/School';
import { Genders } from 'types/Social';

// Illness with teeth (task 092 / proposal G2): the sick don't work (called_in_sick replaces the shift as a
// real logged absence), sick children skip school, prolonged sickness raises layoff exposure, and serious
// cases recover slower — measured through the same factor machinery as everything else.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const JOB: JobFacts = {
    shiftStart: 9 * 60, shiftEnd: 17 * 60, workplaceKey: '7-7',
    continuousActions: [{ action: 'attend_school' }], // any continuous 'work-ish' shell; use a real one below
    discreteActions: [],
};

function harness(ageYears = 30) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const state: PopulationState = { worldSeed: 13, people: { a: person('a', ageYears) }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.register('a');
    // Tick 100009? shift math: use a tick whose hour is 10 (on shift): day*24+10.
    const tick = 100 * 24 + 10;
    const deps: BrainDeps & ActionDeps = {
        state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory,
        jobOf: () => ({ ...JOB, continuousActions: [{ action: 'cooking_meal' }] }), // stand-in continuous work pick
    };
    return { engine, actions, brain, state, deps, tick };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('the fitness gate (work)', () => {
    test('a sick employee stays home: resting_at_home_sick starts and called_in_sick is logged once per day', () => {
        const { engine, actions, brain, state, deps, tick } = harness();
        // Make them sick through the real event (fell_ill sets health 0.5 < 0.6).
        engine.invoke(state, 'fell_ill', 'a', tick - 1, TPY, { source: 'system', causationId: null });

        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('resting_at_home_sick');
        const sickCalls = engine.getPersonLog('a').filter(entry => entry.kind === 'event' && entry.defId === 'called_in_sick');
        expect(sickCalls).toHaveLength(1);

        // The next on-shift tick doesn't duplicate the call (already resting; and the event is once perDay).
        brain.processTick(['a'], { ...deps, tick: tick + 1 }, [], result());
        expect(engine.getPersonLog('a').filter(entry => entry.kind === 'event' && entry.defId === 'called_in_sick')).toHaveLength(1);
    });

    test('a healthy employee starts the shift normally', () => {
        const { actions, brain, deps } = harness();
        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).not.toBe('resting_at_home_sick');
    });

    test('the threshold is the exported constant (data and code agree)', () => {
        expect(SICK_HEALTH_THRESHOLD).toBe(0.6);
    });
});

describe('the fitness gate (school)', () => {
    const school: SchoolFacts = { shiftStart: 8 * 60, shiftEnd: 14 * 60, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], schoolKey: '3-3' } as unknown as SchoolFacts;
    // A Monday during school hours (absolute day 0 is a Monday; day 700 % 7 = 0).
    const schoolTick = 700 * 24 + 9;

    test('a sick child gets no attendance intent; a healthy one attends', () => {
        const sick = harness(10);
        sick.engine.invoke(sick.state, 'fell_ill', 'a', schoolTick - 1, TPY, { source: 'system', causationId: null });
        sick.brain.processTick(['a'], { ...sick.deps, tick: schoolTick, jobOf: () => null, schoolOf: () => school }, [], result());
        expect(sick.actions.activeInstanceOf('a')?.defId).not.toBe('attend_school');

        const healthy = harness(10);
        healthy.brain.processTick(['a'], { ...healthy.deps, tick: schoolTick, jobOf: () => null, schoolOf: () => school }, [], result());
        expect(healthy.actions.activeInstanceOf('a')?.defId).toBe('attend_school');
    });
});

describe('the authored factors (data)', () => {
    test('layoff exposure doubles while unwell; serious cases recover slower; the sick day reshapes selection', () => {
        const layoffFactors = EVENTS['layoff']!.triggers.probabilistic!.factors ?? [];
        expect(layoffFactors.some(factor => factor.driver === 'subject.health')).toBe(true);
        const recoveryFactors = EVENTS['recovered']!.triggers.probabilistic!.factors ?? [];
        expect(recoveryFactors.some(factor => factor.driver === 'subject.health')).toBe(true);
        expect(EVENTS['fell_seriously_ill']!.effects.some(effect => effect.type === 'setAttr' && effect.value === 0.25)).toBe(true);
        // Sick modifiers landed: the bar collapses, resting rises.
        const bar = ACTIONS['at_the_bar']!.selection!.modifiers!;
        expect(bar.some(modifier => modifier.multiply === 0.25)).toBe(true);
        const rest = ACTIONS['rest']!.selection!.modifiers!;
        expect(rest.some(modifier => modifier.multiply === 2.5)).toBe(true);
    });
});
