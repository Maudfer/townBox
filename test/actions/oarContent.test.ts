import ActionEngine, { ActionDeps, DEFAULT_ACTION_MANIFEST } from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import { runTick } from 'game/execution/TickRunner';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import Needs from 'game/population/Needs';
import jobsConfig from 'json/jobs.json';
import oarConfig from 'json/object-action-relationships.json';
import { OARTable } from 'types/Action';
import { JobTable } from 'types/Business';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult, ActionLogEntry } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// The object-action-relationships backfill (task 053): catalog floors, reachability, and the real chains —
// cooking alternatives, consumption depletion, tool-mediated repair, and per-job production into the
// business inventory (047 routing).

const TPY = 8640;
const OAR = oarConfig as unknown as OARTable;
const JOBS = jobsConfig as unknown as JobTable;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness(employerKeyOf?: (id: string) => string | null) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const engine = new EventEngine();
    const world = new BootstrapWorld(inventory);
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const state: PopulationState = { worldSeed: 53, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
    const deps: ActionDeps = {
        state, tick: 1000, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory, ...(employerKeyOf ? { employerKeyOf } : {}),
    };
    return { engine, world, actions, deps, inventory };
}

function carry(inventory: Inventory, archetypeId: string, quantity = 1, state?: Record<string, string>) {
    return inventory.createInstance({
        archetypeId, owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' },
        tick: 0, quantity, ...(state ? { state } : {}),
    });
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('catalog floors (task 053)', () => {
    test('the table covers every required transformation family at scale', () => {
        const entries = Object.values(OAR);
        expect(entries.length).toBeGreaterThanOrEqual(25);
        // Multi-input transformations (two or more inputs combining).
        expect(entries.filter(e => e.inputs.length >= 2).length).toBeGreaterThanOrEqual(8);
        // Consumption entries (a consumable goes away, nothing is produced).
        expect(entries.filter(e => e.inputs.some(i => i.disposition === 'consumed') && e.outputs.length === 0).length).toBeGreaterThanOrEqual(5);
        // Tool-mediated: a required input that survives the transform.
        expect(entries.filter(e => e.inputs.some(i => i.disposition === 'required')).length).toBeGreaterThanOrEqual(3);
        // State-gated repair transforms.
        expect(entries.filter(e => e.inputs.some(i => i.disposition === 'transformed' && i.state !== undefined)).length).toBeGreaterThanOrEqual(3);
        // Per-job production recipes routed to the employer.
        expect(entries.filter(e => e.outputs.some(o => o.owner === 'employer')).length).toBeGreaterThanOrEqual(5);
    });

    test('every OAR action is reachable: a pool/sequence child, a job work action, or free-time selectable', () => {
        const manifest = DEFAULT_ACTION_MANIFEST;
        const referenced = new Set<string>();
        for (const def of Object.values(manifest)) {
            const children = def.children;
            if (children?.mode === 'pool') {
                children.entries.forEach(entry => referenced.add(entry.action));
            } else if (children?.mode === 'sequence') {
                children.steps.forEach(step => referenced.add(step.action));
            }
        }
        for (const job of Object.values(JOBS)) {
            job.workActions.continuous.forEach(spec => referenced.add(spec.action));
            job.workActions.discrete.forEach(spec => referenced.add(spec.action));
        }
        for (const entry of Object.values(OAR)) {
            const def = manifest[entry.action];
            const selectable = (def?.selection?.weight ?? 0) > 0;
            expect({ action: entry.action, reachable: referenced.has(entry.action) || selectable })
                .toEqual({ action: entry.action, reachable: true });
        }
    });
});

describe('cooking chains', () => {
    test('plated_the_meal picks the first satisfiable recipe: salad from fresh ingredients', () => {
        const { engine, actions, deps, inventory } = harness();
        carry(inventory, 'lettuce');
        carry(inventory, 'tomato', 2);
        expect(actions.startAction('a', 'plated_the_meal', {}, cause, deps, result()).ok).toBe(true);
        const salad = inventory.possessionsOf('a').find(i => i.archetypeId === 'caesar_salad')!;
        expect(salad.quantity).toBe(2);
        expect(inventory.possessionsOf('a').some(i => i.archetypeId === 'lettuce')).toBe(false);
        // One tomato of the stack of two was consumed.
        expect(inventory.possessionsOf('a').find(i => i.archetypeId === 'tomato')!.quantity).toBe(1);
        // Provenance chains to the committing log entry.
        const performed = engine.getPersonLog('a').find(e => e.kind === 'action') as ActionLogEntry;
        expect(salad.provenance).toBe(performed.seq);
    });

    test('recipe alternatives fall through in declaration order: potatoes+onion make a roast dinner', () => {
        const { actions, deps, inventory } = harness();
        carry(inventory, 'potato', 2);
        carry(inventory, 'onion');
        expect(actions.startAction('a', 'plated_the_meal', {}, cause, deps, result()).ok).toBe(true);
        expect(inventory.possessionsOf('a').find(i => i.archetypeId === 'meatloaf_slice')!.quantity).toBe(2);
    });

    test('no satisfiable recipe fails typed with zero mutations', () => {
        const { actions, deps, inventory } = harness();
        carry(inventory, 'potato', 1); // roast needs 2
        expect(actions.startAction('a', 'plated_the_meal', {}, cause, deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
        expect(inventory.possessionsOf('a').find(i => i.archetypeId === 'potato')!.quantity).toBe(1);
    });
});

describe('consumption', () => {
    test('ate_a_meal depletes the carried meal stack and then refuses', () => {
        const { actions, deps, inventory } = harness();
        carry(inventory, 'sandwich', 2);
        expect(actions.startAction('a', 'ate_a_meal', {}, cause, deps, result()).ok).toBe(true);
        expect(inventory.possessionsOf('a').find(i => i.archetypeId === 'sandwich')!.quantity).toBe(1);
        expect(actions.startAction('a', 'ate_a_meal', {}, cause, deps, result()).ok).toBe(true);
        expect(inventory.possessionsOf('a').some(i => i.archetypeId === 'sandwich')).toBe(false);
        // LP-5: the carries-food requirement now gates BEFORE the OAR match, so an empty-handed eater is
        // requirements-unmet (the pre-LP-5 shape was the OAR's inputsUnavailable — same zero mutations).
        expect(actions.startAction('a', 'ate_a_meal', {}, cause, deps, result())).toEqual({ ok: false, reason: 'requirementsUnmet' });
    });
});

describe('tool-mediated repair', () => {
    test('a broken keepsake plus a toolbox repairs in place; the toolbox is retained', () => {
        const { actions, deps, inventory } = harness();
        const watch = carry(inventory, 'wristwatch', 1, { condition: 'broken' });
        carry(inventory, 'toolbox');
        expect(actions.startAction('a', 'repaired_an_item', {}, cause, deps, result()).ok).toBe(true);
        expect(watch.archetypeId).toBe('wristwatch');
        expect(watch.state).toBeUndefined(); // condition cleared — identity preserved (044)
        expect(inventory.possessionsOf('a').some(i => i.archetypeId === 'toolbox')).toBe(true);
    });

    test('an intact keepsake does not match the state-gated entry', () => {
        const { actions, deps, inventory } = harness();
        carry(inventory, 'wristwatch');
        carry(inventory, 'toolbox');
        expect(actions.startAction('a', 'repaired_an_item', {}, cause, deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
    });

    test('the breaking mishap sets the state the repair entry looks for (the loop closes)', () => {
        const { actions, deps, inventory } = harness();
        const watch = carry(inventory, 'wristwatch');
        carry(inventory, 'toolbox');
        expect(actions.startAction('a', 'noticed_a_broken_keepsake', {}, cause, deps, result()).ok).toBe(true);
        expect(watch.state).toEqual({ condition: 'broken' });
        expect(actions.startAction('a', 'repaired_an_item', {}, cause, deps, result()).ok).toBe(true);
        expect(watch.state).toBeUndefined();
    });
});

describe('per-job production (047 routing)', () => {
    test('a baker batch lands in the business inventory at the workplace', () => {
        const { actions, deps, inventory, world } = harness(() => '9-9');
        world.requestTransition('a', { kind: 'building', key: '9-9' }, 1000, null);
        expect(actions.startAction('a', 'baked_a_batch_of_bread', {}, cause, deps, result()).ok).toBe(true);
        const owned = inventory.instancesOwnedBy({ kind: 'business', key: '9-9' });
        expect(owned).toHaveLength(1);
        expect(owned[0]!).toMatchObject({ archetypeId: 'bread_loaf', quantity: 4, container: { kind: 'location', key: 'building:9-9' } });
        // Nothing of it belongs to the person.
        expect(inventory.possessionsOf('a')).toHaveLength(0);
    });

    test('production without an employer fails typed (no orphaned goods)', () => {
        const { actions, deps } = harness();
        expect(actions.startAction('a', 'assembled_a_crate', {}, cause, deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
    });

    // LP-4 (proposal simulation-aliveness-2 P0-2): the grocery restock channel. restocking_shelves used to
    // be pure flavor — no OAR entry, so a supermarket could NEVER stock food and the town starved at the
    // shelf. The stocked_the_shelves child now produces employer-owned staples at the workplace, bounded by
    // the 089 per-archetype ceiling like every production recipe.
    test('stocking the shelves lands grocery staples in the business inventory (the restock channel)', () => {
        const { actions, deps, inventory, world } = harness(() => '9-9');
        world.requestTransition('a', { kind: 'building', key: '9-9' }, 1000, null);
        expect(actions.startAction('a', 'stocked_the_shelves', {}, cause, deps, result()).ok).toBe(true);
        const owned = inventory.instancesOwnedBy({ kind: 'business', key: '9-9' });
        const archetypes = new Set(owned.map(instance => instance.archetypeId));
        expect(archetypes.has('egg')).toBe(true);
        expect(archetypes.has('bread_loaf')).toBe(true);
        expect(archetypes.has('tomato')).toBe(true);
        // All employer-owned, none pocketed.
        expect(inventory.possessionsOf('a')).toHaveLength(0);
    });
});

describe('long-run object sanity (task 053)', () => {
    test('twenty days: production accumulates only employer-owned goods, no runaway duplication', async () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const state: PopulationState = {
            worldSeed: 5353,
            people: { baker: person('baker'), homebody: person('homebody') },
            drawSeed: 1, placedIds: [], nextSeq: 300, lastSimulatedYear: 0,
        };
        // A kitchen fixture at home: since 071 cooking requires a stove/oven at the location (generated
        // houses always have them via the 070 essentials; this fixture world places one directly).
        inventory.createInstance({ archetypeId: 'stove', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        // The homebody starts with a stocked pantry so the cooking/eating chains run.
        for (const [archetype, quantity] of [['flour_bag', 2], ['egg', 6], ['lettuce', 2], ['tomato', 3], ['potato', 4], ['onion', 2], ['bread_loaf', 2], ['cheese_wedge', 2]] as const) {
            inventory.createInstance({ archetypeId: archetype, owner: { kind: 'person', personId: 'homebody' }, container: { kind: 'possessions', personId: 'homebody' }, tick: 0, quantity });
        }
        const startingUnits = Object.values(inventory.getState().instances).reduce((sum, i) => sum + i.quantity, 0);

        const bakerJob = JOBS['baker']!;
        const jobOf = (id: string) => (id === 'baker' ? {
            shiftStart: bakerJob.shiftStart, shiftEnd: bakerJob.shiftEnd, daysOfWeek: bakerJob.daysOfWeek,
            workplaceKey: '7-7',
            continuousActions: bakerJob.workActions.continuous,
            discreteActions: bakerJob.workActions.discrete,
        } : null);
        const employerKeyOf = (id: string) => (id === 'baker' ? '7-7' : null);

        // The needs ledger drives the day (084) — every real run has one, and without it nothing ever
        // makes the homebody hungry, so "did they eat" was a pure free-time coin flip (it broke on the W0
        // stream shift). With hunger real, cooking→eating is structural, not luck.
        const needs = new Needs();
        for (let tick = 0; tick < 20 * 24; tick++) {
            await runTick({
                engine, actionEngine: actions, brain,
                state, agentIds: ['baker', 'homebody'], tick, ticksPerYear: TPY,
                ctx: { mode: 'bootstrap', world, markets: { needs } },
                inventory, jobOf, employerKeyOf,
            });
        }

        // The bakery accumulated goods — and every one of them is employer-owned production.
        const bakeryGoods = inventory.instancesOwnedBy({ kind: 'business', key: '7-7' });
        expect(bakeryGoods.length).toBeGreaterThan(0);
        expect(bakeryGoods.every(i => ['bread_loaf', 'cake'].includes(i.archetypeId))).toBe(true);
        for (const instance of Object.values(inventory.getState().instances)) {
            if (instance.container.kind === 'location' && instance.container.key === 'building:7-7') {
                expect(instance.owner).toEqual({ kind: 'business', key: '7-7' });
            }
        }

        // Consumables depleted: the homebody cooked and ate — meals were consumed, not hoarded forever.
        // Which consumption discrete fires (solo meal vs shared) shifts with the free-time candidate set as
        // the manifest grows (095 added the vice repertoire), so accept either meal-consumption entry.
        const log = engine.getPersonLog('homebody');
        expect(log.some(e => e.kind === 'action' && e.defId === 'plated_the_meal')).toBe(true);
        expect(log.some(e => e.kind === 'action' && (e.defId === 'ate_a_meal' || e.defId === 'shared_a_meal'))).toBe(true);

        // No runaway duplication: personal possessions stay within pantry-scale bounds. Production is
        // excluded (it grows linearly with shifts worked by design, bounded by pool chances/cooldowns).
        // Bound widened for W0: real hunger now drives shopping trips whose (per-item-optional, larger)
        // baskets conjure off-map — grocery-cadence growth, not duplication (runaway would be thousands).
        const personalUnits = Object.values(inventory.getState().instances)
            .filter(i => i.owner.kind === 'person')
            .reduce((sum, i) => sum + i.quantity, 0);
        expect(personalUnits).toBeLessThan(startingUnits + 220);
        expect(bakeryGoods.reduce((sum, i) => sum + i.quantity, 0)).toBeLessThan(20 * 30);
    }, 60000);
});
