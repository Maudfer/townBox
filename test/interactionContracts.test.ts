import Brain, { BrainDeps } from '../src/app/game/Brain';
import ActionEngine, { ActionDeps } from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from '../src/app/game/Inventory';

import { validateActionsStructure } from '../src/app/game/data/validators/actions';
import { IssueCollector, ValidationIssue } from '../src/app/game/data/registry';

import { ActionManifest } from '../src/types/Action';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';
import { TickResult } from '../src/types/LifeEvent';

import actionsConfig from '../src/json/actions.json';

// Person-targeted interaction contracts (task 072): the schema teeth, same-building enforcement, self/dead
// target rejection, and the social-opportunity hook that finally binds targets — over the REAL manifests.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;

function structure(data: unknown): string {
    const issues: ValidationIssue[] = [];
    validateActionsStructure(data, new IssueCollector('fixture', issues));
    return issues.map(issue => `${issue.path}: ${issue.message}`).join(' | ');
}

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness(ids: string[] = ['a', 'b']) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const brain = new Brain(actions);
    const people = Object.fromEntries(ids.map(id => [id, person(id)]));
    const state: PopulationState = { worldSeed: 9, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ids.forEach(id => world.register(id)); // co-location queries must see the whole roster (072)
    const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { inventory, world, engine, actions, brain, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('the schema teeth', () => {
    test('a person-typed parameter without an interaction contract is rejected', () => {
        const fixture = { hug: { label: 'H', type: 'discrete', category: 'social', parameters: { target: { type: 'person', required: true } } } };
        expect(structure(fixture)).toMatch(/must declare its interaction contract/);
    });

    test('requiresSameBuilding: false is rejected this iteration; bad targetParam is rejected', () => {
        const base = { label: 'H', type: 'discrete', category: 'social', parameters: { target: { type: 'person', required: true } } };
        const remote = { hug: { ...base, interaction: { targetParam: 'target', requiresSameBuilding: false, askFirst: true } } };
        expect(structure(remote)).toMatch(/remote interaction is not modeled yet/);
        const badParam = { hug: { ...base, interaction: { targetParam: 'victim', requiresSameBuilding: true, askFirst: true } } };
        expect(structure(badParam)).toMatch(/must name a declared person-typed parameter/);
    });

    test('every shipped person-targeted action carries a contract (the 072 backfill)', () => {
        for (const [actionId, def] of Object.entries(ACTIONS)) {
            const hasPersonParam = Object.values(def.parameters ?? {}).some(spec => spec.type === 'person');
            if (hasPersonParam) {
                expect(def.interaction?.targetParam).toBe('target');
                expect(def.interaction?.requiresSameBuilding).toBe(true);
                void actionId;
            }
        }
        // The obvious consent split landed: transfers ask, casual socials don't (074 curates the rest).
        expect(ACTIONS['gave_object_to_person']!.interaction!.askFirst).toBe(true);
        expect(ACTIONS['greeted_person']!.interaction!.askFirst).toBe(false);
    });
});

describe('engine enforcement', () => {
    test('same-building co-location: together succeeds, apart is a typed targetNotPresent failure', () => {
        const { world, actions, deps } = harness();
        // Both default to home (the shared bootstrap logical place) — co-located.
        expect(actions.startAction('a', 'greeted_person', { target: 'b' }, cause, deps, result()).ok).toBe(true);

        // Move b elsewhere — no longer reachable.
        world.requestTransition('b', { kind: 'building', key: '9-9' }, 100, null);
        expect(actions.startAction('a', 'greeted_person', { target: 'b' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'targetNotPresent' });
    });

    test('self-targeting and dead/unknown targets are rejected with zero mutations', () => {
        const { actions, deps, engine } = harness();
        expect(actions.startAction('a', 'greeted_person', { target: 'a' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'targetNotPresent' });
        expect(actions.startAction('a', 'greeted_person', { target: 'ghost' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'targetNotPresent' });
        expect(engine.getPersonLog('a')).toHaveLength(0);
    });
});

describe('the social-opportunity hook (dead content comes alive)', () => {
    test('co-located household members produce bound person-targeted intents; alone produces none', () => {
        const { brain, deps, engine } = harness(['a', 'b']);
        // Run many ticks: the 15%/tick chance must fire and the executed social lands in the log with a
        // bound target. Deterministic per seed — the exact ticks are stable across runs.
        for (let tick = 100; tick < 160; tick++) {
            brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
        }
        const socials = engine.getPersonLog('a').filter(entry => entry.kind === 'action' && ACTIONS[entry.defId]?.interaction);
        expect(socials.length).toBeGreaterThan(0);
        for (const entry of socials) {
            expect((entry as { params: Record<string, unknown> }).params['target']).toBe('b');
        }

        // A person alone gets no social intents.
        const lonely = harness(['solo']);
        for (let tick = 100; tick < 160; tick++) {
            lonely.brain.processTick(['solo'], { ...lonely.deps, tick }, [], result());
        }
        const soloSocials = lonely.engine.getPersonLog('solo').filter(entry => entry.kind === 'action' && ACTIONS[entry.defId]?.interaction);
        expect(soloSocials).toHaveLength(0);
    });

    test('the lend → return loop finally closes end to end (the 044/053 content, live at last)', () => {
        const { inventory, actions, deps, engine } = harness(['a', 'b']);
        // a carries something giftable.
        const gift = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });

        expect(actions.startAction('a', 'lent_an_object', { target: 'b' }, cause, deps, result()).ok).toBe(true);
        expect(inventory.getInstance(gift.id)!.container).toEqual({ kind: 'possessions', personId: 'b' }); // b holds it
        expect(inventory.getInstance(gift.id)!.owner).toEqual({ kind: 'person', personId: 'a' }); // a still owns it

        expect(actions.startAction('b', 'returned_borrowed_object', { target: 'a', object: gift.id }, cause, deps, result()).ok).toBe(true);
        expect(inventory.getInstance(gift.id)!.container).toEqual({ kind: 'possessions', personId: 'a' }); // returned
        expect(engine.getPersonLog('a').length + engine.getPersonLog('b').length).toBeGreaterThan(1);
    });

    test('determinism: two same-seed runs produce identical social streams', () => {
        const run = () => {
            const { brain, deps, engine } = harness(['a', 'b']);
            for (let tick = 100; tick < 140; tick++) {
                brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
            }
            return JSON.stringify(engine.getPersonLog('a').map(entry => [entry.defId, entry.tick]));
        };
        expect(run()).toBe(run());
    });
});
