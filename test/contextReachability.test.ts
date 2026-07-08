import Brain, { BrainDeps } from '../src/app/game/Brain';
import ActionEngine from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory from '../src/app/game/Inventory';
import { generateBuildingObjects } from '../src/app/game/ObjectGeneration';

import { ActionManifest } from '../src/types/Action';
import { ObjectArchetype } from '../src/types/Objects';
import { ObjectQuery } from '../src/types/Simulation';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';
import { TickResult } from '../src/types/LifeEvent';

import actionsConfig from '../src/json/actions.json';
import objectsConfig from '../src/json/objects.json';
import businessesConfig from '../src/json/businesses.json';
import residencesConfig from '../src/json/residences.json';

// World-aware reachability (task 071): no action requirement may be dead-on-arrival — every object query in
// the manifest must be satisfiable by SOME plausibly generated building (statically: a matching archetype
// whose placement intersects the house's or some blueprint's tags), and a freshly generated house must keep
// free-time selection varied (the anti-frustration guard).

const ACTIONS = actionsConfig as unknown as ActionManifest;
const OBJECTS = objectsConfig as unknown as Record<string, ObjectArchetype>;
const HOUSE_TAGS = (residencesConfig as { house: { tags: string[] } }).house.tags;
const BLUEPRINT_TAGS = Object.values(businessesConfig as Record<string, { tags?: string[] }>).map(blueprint => blueprint.tags ?? []);
const ALL_BUILDING_TAGS = new Set<string>([...HOUSE_TAGS, ...BLUEPRINT_TAGS.flat()]);

// Purchases keep createObject as the DOCUMENTED fallback until the venue model maps shops to real buildings
// (068/071 decision): venue:shop has no map backing yet, so buying cannot move from real stock.
const PURCHASE_FALLBACKS = new Set([
    'found_coin', 'collected_a_seashell', 'picked_a_flower', 'found_something_under_the_couch', 'found_a_toy',
    'picked_up_a_pebble', 'received_a_keepsake', // serendipity/nature/gifts — genuine creation, kept
    'bought_a_snack', 'bought_groceries', 'made_an_impulse_purchase', 'picked_up_a_prescription',
    'picked_up_fresh_ingredients', 'bought_cleaning_supplies', 'bought_some_tools', 'bought_gift_wrap',
]);

function collectQueries(node: unknown, out: { kind: string; query: ObjectQuery }[]): void {
    if (Array.isArray(node)) {
        node.forEach(child => collectQueries(child, out));
        return;
    }
    if (typeof node !== 'object' || node === null) {
        return;
    }
    const record = node as Record<string, unknown>;
    for (const key of ['carries', 'objectAtLocation']) {
        if (typeof record[key] === 'object' && record[key] !== null) {
            out.push({ kind: key, query: record[key] as ObjectQuery });
        }
    }
    Object.values(record).forEach(child => collectQueries(child, out));
}

function archetypeMatches(archetype: ObjectArchetype, query: ObjectQuery): boolean {
    if (query.tag !== undefined && !(archetype.tags ?? []).includes(query.tag)) {
        return false;
    }
    if (query.flag !== undefined && !(archetype.flags as unknown as Record<string, boolean>)[query.flag]) {
        return false;
    }
    return true;
}

describe('static reachability of every object requirement (task 071)', () => {
    test('every objectAtLocation query is satisfiable in some generatable building', () => {
        const failures: string[] = [];
        for (const [actionId, def] of Object.entries(ACTIONS)) {
            const queries: { kind: string; query: ObjectQuery }[] = [];
            collectQueries(def.requirements, queries);
            for (const { kind, query } of queries) {
                if (kind !== 'objectAtLocation' || query.archetypeParam !== undefined) {
                    continue; // param queries are checked per call; carries below
                }
                const candidates = Object.entries(OBJECTS).filter(([id, archetype]) => {
                    if (query.archetype !== undefined && id !== query.archetype) {
                        return false;
                    }
                    return archetypeMatches(archetype, query);
                });
                const generatable = candidates.some(([, archetype]) => (archetype.placement ?? []).some(tag => ALL_BUILDING_TAGS.has(tag)));
                if (!generatable) {
                    failures.push(`${actionId}: ${JSON.stringify(query)}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    test('every carries query names something that exists and can be carried', () => {
        const failures: string[] = [];
        for (const [actionId, def] of Object.entries(ACTIONS)) {
            const queries: { kind: string; query: ObjectQuery }[] = [];
            collectQueries(def.requirements, queries);
            for (const { kind, query } of queries) {
                if (kind !== 'carries' || query.archetypeParam !== undefined) {
                    continue;
                }
                const satisfiable = Object.entries(OBJECTS).some(([id, archetype]) => {
                    if (query.archetype !== undefined && id !== query.archetype) {
                        return false;
                    }
                    return archetypeMatches(archetype, query) && archetype.flags.carryable;
                });
                if (!satisfiable) {
                    failures.push(`${actionId}: ${JSON.stringify(query)}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    test('the conjuring audit holds: every createObject consequence is on the documented keep-list', () => {
        const undocumented: string[] = [];
        for (const [actionId, def] of Object.entries(ACTIONS)) {
            const conjures = (def.consequences ?? []).some(op => op.op === 'createObject');
            if (conjures && !PURCHASE_FALLBACKS.has(actionId)) {
                undocumented.push(actionId);
            }
        }
        expect(undocumented).toEqual([]);
    });
});

describe('a generated house keeps daily life running (task 071)', () => {
    function harness() {
        const inventory = new Inventory();
        generateBuildingObjects({ anchorKey: '4-4', tags: HOUSE_TAGS, host: 'house', worldSeed: 42, tick: 0 }, inventory);
        const world = new BootstrapWorld(inventory);
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const person: GenPerson = { id: 'a', firstName: 'A', familyName: 'F', gender: Genders.Female, birthTick: -30 * 8640, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
        const state: PopulationState = { worldSeed: 42, people: { a: person }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
        // Put the person inside the generated house.
        world.requestTransition('a', { kind: 'building', key: '4-4' }, 0, null);
        const makeDeps = (tick: number): BrainDeps => ({ state, tick, ticksPerYear: 8640, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory });
        return { inventory, world, engine, actions, brain, makeDeps };
    }

    test('flagship contexts are live: cooking blocked without ingredients but the fixtures exist; shower/TV work', () => {
        const { inventory, actions, makeDeps } = harness();
        const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
        const cause = { source: 'system' as const, causationId: null };
        const deps = makeDeps(10);

        // The essentials guarantee the fixtures; shower + TV requirements pass in any generated house.
        expect(actions.startAction('a', 'took_a_shower', {}, cause, deps, result()).ok).toBe(true);
        expect(actions.startAction('a', 'watching_television', {}, cause, deps, result(), null, undefined, 'building:4-4').ok).toBe(true);

        // Cooking needs the kitchen (present) AND carried ingredients (absent -> blocked; present -> runs).
        const active = actions.activeInstanceOf('a');
        if (active) {
            actions.interrupt(active.id, cause, deps, result());
        }
        expect(actions.startAction('a', 'cooking_meal', {}, cause, deps, result(), null, undefined, 'building:4-4')).toEqual({ ok: false, reason: 'requirementsUnmet' });
        inventory.createInstance({ archetypeId: 'tomato', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(actions.startAction('a', 'cooking_meal', {}, cause, deps, result(), null, undefined, 'building:4-4').ok).toBe(true);
    });

    test('free-time variety guard: a person in a generated house still has a healthy, varied candidate set', () => {
        const { brain, makeDeps } = harness();
        const picks = new Set<string>();
        for (let tick = 100; tick < 140; tick++) {
            const pick = brain.selectFreeTimeAction('a', makeDeps(tick));
            if (pick) {
                picks.add(pick);
            }
        }
        expect(picks.size).toBeGreaterThanOrEqual(4); // selection never collapses to one or two activities
    });
});
