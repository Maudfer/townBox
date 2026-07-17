import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Hospitals, end to end (task 111): the sick travel to a placed hospital and run receiving_treatment (no
// hospital → the 092 resting behavior, untouched); on-duty doctors treat co-located patients-in-treatment
// (counterparts treated_a_patient / was_treated_by_doctor, same causation); treatment doubles the recovery
// hazard through the recentlyTreated attribute; and prolonged untreated severe illness kills more people —
// emergent arithmetic (slower recovery → longer at low health → more death-hazard exposure), never a script.

const TPY = 8640;
const TICK_NOW = 40 * TPY; // year-aligned → tick N-of-day on a weekday

function gen(id: string, opts: Partial<GenPerson> = {}): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [], ...opts };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

const DOCTOR: JobFacts = {
    jobKey: 'doctor',
    shiftStart: 8 * 60, shiftEnd: 17 * 60,
    daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workplaceKey: '9-9',
    continuousActions: [{ action: 'treating_patients' }],
    discreteActions: [],
};

function harness(people: Record<string, GenPerson>, jobOf: (id: string) => JobFacts | null = () => null) {
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    for (const id of Object.keys(people)) {
        world.register(id);
    }
    const state: PopulationState = { worldSeed: 7, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
    const deps = (tick: number): BrainDeps => ({
        state, tick, ticksPerYear: TPY,
        ctx: { mode: 'bootstrap', world, markets: {} },
        eventEngine: engine, inventory, jobOf,
    });
    return { engine, actions, brain, world, state, deps };
}

describe('the treatment trip', () => {
    test('a sick person travels to the hospital when the town has one; without one the 092 behavior stands', () => {
        const { engine, actions, brain, world, state, deps } = harness({ sick: gen('sick') });
        engine.invoke(state, 'fell_ill', 'sick', TICK_NOW - 5, TPY, { source: 'system', causationId: null });
        brain.processTick(['sick'], deps(TICK_NOW + 10), [], result());
        expect(actions.activeInstanceOf('sick')?.defId).toBe('receiving_treatment');
        expect(world.locationOf('sick')).toEqual({ kind: 'venue', venue: 'hospital' });

        // The same sick person in a town with NO hospital: the hook proposes nothing.
        const town = harness({ sick: gen('sick') });
        town.engine.invoke(town.state, 'fell_ill', 'sick', TICK_NOW - 5, TPY, { source: 'system', causationId: null });
        (town.world as unknown as { hasVenue: () => boolean }).hasVenue = () => false;
        town.brain.processTick(['sick'], town.deps(TICK_NOW + 10), [], result());
        expect(town.actions.activeInstanceOf('sick')?.defId).not.toBe('receiving_treatment');
    });

    test('a healthy person never seeks treatment', () => {
        const { actions, brain, deps } = harness({ fine: gen('fine') });
        brain.processTick(['fine'], deps(TICK_NOW + 10), [], result());
        expect(actions.activeInstanceOf('fine')?.defId).not.toBe('receiving_treatment');
    });
});

describe('the doctor\'s rounds', () => {
    test('an on-duty doctor treats a co-located patient-in-treatment: both halves log, same causation, no re-treat same day', () => {
        const { engine, actions, brain, world, state, deps } = harness(
            { doc: gen('doc'), sick: gen('sick') },
            id => (id === 'doc' ? DOCTOR : null),
        );
        engine.invoke(state, 'fell_ill', 'sick', TICK_NOW - 5, TPY, { source: 'system', causationId: null });
        // The patient checks in; the doctor is at the ward (the venue is the bootstrap hospital).
        brain.processTick(['sick'], deps(TICK_NOW + 10), [], result());
        expect(actions.activeInstanceOf('sick')?.defId).toBe('receiving_treatment');
        world.requestTransition('doc', { kind: 'venue', venue: 'hospital' }, TICK_NOW + 10, null);

        brain.processTick(['doc'], deps(TICK_NOW + 10), [], result());
        const rounds = actions.activeInstanceOf('doc');
        expect(rounds?.defId).toBe('treating_patient');
        expect(rounds?.params['target']).toBe('sick');
        // Run the visit to completion → the counterparts land with one causation.
        for (let tick = TICK_NOW + 11; tick <= TICK_NOW + 14 && actions.activeInstanceOf('doc'); tick++) {
            actions.advance(deps(tick));
        }
        const treated = engine.getPersonLog('doc').find(e => e.kind === 'event' && e.defId === 'treated_a_patient');
        const wasTreated = engine.getPersonLog('sick').find(e => e.kind === 'event' && e.defId === 'was_treated_by_doctor');
        expect(treated).toBeTruthy();
        expect(wasTreated).toBeTruthy();
        expect(wasTreated!.causationId).toBe(treated!.causationId); // both halves chain to the completion entry

        // The recentlyTreated attribute now reads the treatment (the recovered factor's driver).
        expect(engine.contextFor(state, 'sick', TICK_NOW + 15, TPY).getAttr('recentlyTreated')).toBe(1);

        // The rounds move on: the same patient is not re-treated within the day.
        brain.processTick(['doc'], deps(TICK_NOW + 15), [], result());
        expect(actions.activeInstanceOf('doc')?.defId).not.toBe('treating_patient');
    });
});

describe('treatment → recovery speed (the cohort pin)', () => {
    // The serviceRecovery pattern (096): cohort frequencies, not a single pair — per-seed draws are
    // correlated and one person's recovery can tie. No services reader is bound, so healthcareCoverage
    // reads neutral (×1) and the ONLY difference between the arms is the recentlyTreated factor (×2).
    test('a treated cohort recovers decisively more people within the window', () => {
        const recoveredCount = (treatWeekly: boolean): number => {
            const engine = new EventEngine();
            const ids = Array.from({ length: 30 }, (_, index) => `p${String(index).padStart(2, '0')}`);
            const people: Record<string, GenPerson> = {};
            for (const id of ids) {
                people[id] = gen(id);
            }
            const state: PopulationState = { worldSeed: 55, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
            for (const id of ids) {
                engine.invoke(state, 'fell_ill', id, TICK_NOW, TPY, { source: 'system', causationId: null });
            }
            for (let tick = TICK_NOW + 1; tick <= TICK_NOW + 300; tick++) {
                if (treatWeekly && (tick - TICK_NOW) % 168 === 1) {
                    for (const id of ids) {
                        const context = engine.contextFor(state, id, tick, TPY);
                        if (context.getAttr('alive') === true && (context.getAttr('health') as number) < 1) {
                            engine.invoke(state, 'was_treated_by_doctor', id, tick, TPY, { source: 'system', causationId: null });
                        }
                    }
                }
                engine.simulateTick(state, ids, tick, TPY, {});
            }
            return ids.filter(id => engine.getPersonLog(id).some(entry => entry.kind === 'event' && entry.defId === 'recovered')).length;
        };
        const treated = recoveredCount(true);
        const untreated = recoveredCount(false);
        expect(treated).toBeGreaterThan(untreated);
    });
});

describe('the untreated-mortality chain (emergent arithmetic)', () => {
    // Slower recovery → longer at low health → more death-hazard exposure. Same seed, same injuries; the
    // only lever is the weekly treatment. Old severe cohort so the year shows the difference decisively.
    test('a severely ill cohort loses strictly more people over a seeded year WITHOUT treatment', () => {
        const deathsOver = (treatWeekly: boolean): number => {
            const engine = new EventEngine();
            const ids = Array.from({ length: 40 }, (_, index) => `p${String(index).padStart(2, '0')}`);
            const people: Record<string, GenPerson> = {};
            for (const id of ids) {
                people[id] = gen(id, { birthTick: TICK_NOW - 85 * TPY });
            }
            const state: PopulationState = { worldSeed: 91, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
            for (const id of ids) {
                engine.invoke(state, 'injury', id, TICK_NOW, TPY, { source: 'system', causationId: null }); // health 0.3
            }
            for (let tick = TICK_NOW + 1; tick <= TICK_NOW + TPY; tick++) {
                if (treatWeekly && (tick - TICK_NOW) % 168 === 1) {
                    for (const id of ids) {
                        const context = engine.contextFor(state, id, tick, TPY);
                        if (context.getAttr('alive') === true && (context.getAttr('health') as number) < 1) {
                            engine.invoke(state, 'was_treated_by_doctor', id, tick, TPY, { source: 'system', causationId: null });
                        }
                    }
                }
                engine.simulateTick(state, ids, tick, TPY, {});
            }
            return ids.filter(id => state.people[id]!.deathTick !== null).length;
        };
        const withTreatment = deathsOver(true);
        const withoutTreatment = deathsOver(false);
        expect(withoutTreatment).toBeGreaterThan(withTreatment);
    });
});

describe('the sick visit (the planner producer)', () => {
    test('a sick spouse gets a planned bedside visit that follows the person, target threaded for the counterpart', async () => {
        const AgendaModule = await import('game/actions/Agenda');
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('visitor');
        world.register('patient');
        const agenda = new AgendaModule.default();
        const people = {
            visitor: gen('visitor', { partnerships: [{ partnerId: 'patient', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
            patient: gen('patient', { partnerships: [{ partnerId: 'visitor', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
        };
        const state: PopulationState = { worldSeed: 3, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        engine.invoke(state, 'fell_ill', 'patient', TICK_NOW - 5, TPY, { source: 'system', causationId: null });
        const deps = (tick: number): BrainDeps => ({
            state, tick, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { agenda } },
            eventEngine: engine, inventory,
        });
        // The 08:00 sweep enqueues; the due entry proposes at the patient's side with the target threaded.
        const dayStart = TICK_NOW - (TICK_NOW % 24);
        brain.processTick(['visitor'], deps(dayStart + 8), [], result());
        let visiting = false;
        for (let hour = 9; hour <= 18 && !visiting; hour++) {
            actions.advance(deps(dayStart + hour));
            brain.processTick(['visitor'], deps(dayStart + hour), [], result());
            const active = actions.activeInstanceOf('visitor');
            visiting = active?.defId === 'visiting_the_sick'
                && active.locationOverride === 'person:patient'
                && active.params['target'] === 'patient';
        }
        expect(visiting).toBe(true);
    });
});
