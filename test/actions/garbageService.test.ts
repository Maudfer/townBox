import ActionEngine from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import jobsConfig from 'json/jobs.json';
import servicesConfig from 'json/services.json';
import { ActionManifest } from 'types/Action';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import businessesConfig from 'json/businesses.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { ServicesConfig } from 'types/Services';
import { Genders } from 'types/Social';

// The garbage service (task 101 / proposal H3): litter enters the world from careless street behavior
// (dropped_a_wrapper creates a real, unowned instance at the location), and leaves it through collection —
// the depot's collectors on ambulatory rounds AND residents sweeping their own sidewalk consume the same
// litter through the same discretes. Neglect visibly compounds; care visibly clears.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const JOBS = jobsConfig as unknown as JobTable;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const SERVICES = servicesConfig as unknown as ServicesConfig;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('the litter loop', () => {
    test('a dropped wrapper is a real unowned instance at the location; collection consumes it back out', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('slob');
        world.register('collector');
        const state: PopulationState = { worldSeed: 9, people: { slob: person('slob'), collector: person('collector') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        const deps = (tick: number) => ({ state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world }, eventEngine: engine, inventory });

        // No litter → the pickup is typed-unavailable, zero mutations.
        const early = actions.startAction('collector', 'picked_up_litter', {}, { source: 'brain', causationId: null }, deps(1), result());
        expect(early.ok).toBe(false);

        // The slob drops a wrapper: unowned, AT the location (both live at the shared bootstrap 'home').
        expect(actions.startAction('slob', 'dropped_a_wrapper', {}, { source: 'brain', causationId: null }, deps(2), result()).ok).toBe(true);
        const litter = Object.values(inventory.getState().instances).filter(i => i.archetypeId === 'gum_wrapper');
        expect(litter).toHaveLength(1);
        expect(litter[0]!.owner).toEqual({ kind: 'none' });
        expect(litter[0]!.container.kind).toBe('location');

        // The collector picks it up — consumed, gone.
        expect(actions.startAction('collector', 'picked_up_litter', {}, { source: 'brain', causationId: null }, deps(3), result()).ok).toBe(true);
        expect(Object.values(inventory.getState().instances).filter(i => i.archetypeId === 'gum_wrapper')).toHaveLength(0);
    });
});

describe('the service wiring (data)', () => {
    test('the depot exists, the collector job is reachable field work, and the coverage line is live', () => {
        expect(BLUEPRINTS['sanitation_depot']!.jobs['garbage_collector']).toBeDefined();
        const job = JOBS['garbage_collector']!;
        expect(job.ranks.find(rank => rank.entry)!.entryTrainingGrant).toBeDefined();
        expect(job.workActions.continuous.some(entry => entry.action === 'collection_rounds')).toBe(true);
        // Collection rounds are ambulatory field work — the 099 orchestrator seam keeps them on the street.
        expect(ACTIONS['collection_rounds']!.ambulatory).toBe('stroll');
        expect(ACTIONS['collection_rounds']!.location).toBe('outside');
        // The coverage ledger's garbage line now counts real collectors at a real depot.
        expect(SERVICES.services['garbage']!.providerJobs).toEqual(['garbage_collector']);
        expect(SERVICES.services['garbage']!.facilityBlueprints).toEqual(['sanitation_depot']);
    });

    test('street repertoires shed litter; the resident sidewalk sweep clears it and itches when dirty', () => {
        for (const id of ['evening_stroll', 'window_shopping', 'street_games', 'taking_a_walk']) {
            const entries = (ACTIONS[id]!.children as { entries: { action: string }[] }).entries;
            expect(entries.some(entry => entry.action === 'dropped_a_wrapper')).toBe(true);
        }
        const sidewalk = ACTIONS['cleaning_the_sidewalk']!;
        expect((sidewalk.children as { entries: { action: string }[] }).entries.some(entry => entry.action === 'picked_up_litter')).toBe(true);
        expect((sidewalk.selection!.modifiers ?? []).some(m => JSON.stringify(m.when).includes('gum_wrapper') && m.multiply > 1)).toBe(true);
    });
});
