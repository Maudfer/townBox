import { ActionDeps } from 'game/actions/ActionEngine';
import { applyPlan, CommitContext, planConsequences, planOAR } from 'game/events/Consequences';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ConsequenceOp, OAREntry } from 'types/Action';
import { GenPerson, PersonTable, PopulationState } from 'types/Genealogy';
import { MoneyLedger, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Direct unit tests for Consequences.ts's plan/apply primitives (task 044), calling planOAR/planConsequences/
// applyPlan straight — no ActionEngine in between. consequences.test.ts already proves the end-to-end
// integration (actions.startAction driving real OAR/consequence commits, the bake-a-cake chain, atomicity);
// this file isolates the branches that integration path never happens to hit: ownership targets 'world'/
// 'none', a 'location' output container, archetypeParam-resolved object refs, an {output} ref that reads an
// ALREADY-bound output vs. a merely-planned one, the authoring-conflict throw when a planned output is
// never actually bound, OAR context/input fallthrough across multiple entries, and retained/required
// bindAs naming.

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(): PopulationState {
    const table: PersonTable = { a: person('a'), b: person('b') };
    return { worldSeed: 44, people: table, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

function ctx(overrides: Partial<CommitContext> = {}, inventory: Inventory | null = new Inventory(DEFAULT_OBJECT_ARCHETYPES), withWorld = true): CommitContext {
    const engine = new EventEngine({});
    const deps: ActionDeps = {
        state: pool(), tick: 1000, ticksPerYear: TPY,
        ctx: { mode: 'bootstrap', ...(withWorld ? { world: new BootstrapWorld(inventory) } : {}) },
        eventEngine: engine, inventory,
    };
    const result: TickResult = { died: [], born: [], signals: [], committed: [] };
    return { personId: 'a', params: {}, outputs: {}, causationId: null, deps, result, ...overrides };
}

describe('Consequences — resolveOwner targets', () => {
    test('owner "world" and "none" both resolve and are used for a created instance', () => {
        const c1 = ctx();
        const worldPlan = planConsequences([{ op: 'createObject', archetype: 'coin', owner: 'world', bindAs: 'w' }], c1, new Set());
        expect(worldPlan).not.toBeNull();
        applyPlan(worldPlan!);
        const worldInstance = c1.deps.inventory!.getInstance(c1.outputs['w']!)!;
        expect(worldInstance.owner).toEqual({ kind: 'world' });

        const c2 = ctx();
        const nonePlan = planConsequences([{ op: 'createObject', archetype: 'coin', owner: 'none', bindAs: 'n' }], c2, new Set());
        applyPlan(nonePlan!);
        expect(c2.deps.inventory!.getInstance(c2.outputs['n']!)!.owner).toEqual({ kind: 'none' });
    });

    test('a "location" container places the created instance at the person\'s current world location', () => {
        const c = ctx();
        const plan = planConsequences([{ op: 'createObject', archetype: 'coin', container: 'location', bindAs: 'x' }], c, new Set());
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        const instance = c.deps.inventory!.getInstance(c.outputs['x']!)!;
        expect(instance.container).toEqual({ kind: 'location', key: 'home' }); // BootstrapWorld default location
    });

    test('a "location" container without a world in ctx.deps.ctx fails to plan', () => {
        const c = ctx({}, new Inventory(DEFAULT_OBJECT_ARCHETYPES), false);
        const plan = planConsequences([{ op: 'createObject', archetype: 'coin', container: 'location' }], c, new Set());
        expect(plan).toBeNull();
    });

    test('employer ownership without an employerKeyOf resolver fails to plan', () => {
        const c = ctx();
        const plan = planConsequences([{ op: 'createObject', archetype: 'coin', owner: 'employer' }], c, new Set());
        expect(plan).toBeNull();
    });
});

describe('Consequences — {output} refs: bound vs. merely-planned vs. never-bound', () => {
    test('an already-bound output resolves directly (no throw)', () => {
        const c = ctx({ outputs: { existing: 'o0' } });
        c.deps.inventory!.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 }); // o0
        const plan = planConsequences([{ op: 'setObjectState', object: { output: 'existing' }, key: 'shiny', value: true }], c, new Set());
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        expect(c.deps.inventory!.getInstance('o0')!.state).toEqual({ shiny: true });
    });

    test('a merely-PLANNED output (declared but never actually bound by any step) throws at apply time — an authoring conflict', () => {
        const c = ctx();
        // plannedOutputs says 'ghost' WILL be bound (as an OAR alternative that never actually ran would
        // claim), but no op in this set ever binds it — the classic cross-entry authoring-conflict case
        // (game/actions/ActionEngine.ts's startAction seeds plannedOutputs from ALL OAR entries, not just
        // the chosen one).
        const plan = planConsequences([{ op: 'setObjectState', object: { output: 'ghost' }, key: 'x', value: 1 }], c, new Set(['ghost']));
        expect(plan).not.toBeNull(); // plan-time validation passes: 'ghost' IS in plannedOutputs
        expect(() => applyPlan(plan!)).toThrow(/never bound \(authoring conflict\)/);
    });

    test('an output ref that is neither bound nor planned fails to plan', () => {
        const c = ctx();
        const plan = planConsequences([{ op: 'setObjectState', object: { output: 'nowhere' }, key: 'x', value: 1 }], c, new Set());
        expect(plan).toBeNull();
    });
});

describe('Consequences — carried/atLocation refs with archetypeParam (task 067/068)', () => {
    test('carried ref resolves the archetype from an action param', () => {
        const c = ctx({ params: { thing: 'coin' } });
        c.deps.inventory!.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const plan = planConsequences([{ op: 'consumeObject', object: { carried: { archetypeParam: 'thing' } } as unknown as { carried: { archetype?: string } } }], c, new Set());
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        expect(c.deps.inventory!.possessionsOf('a')).toHaveLength(0);
    });

    test('a missing or non-string archetypeParam value fails to resolve the query', () => {
        const c = ctx({ params: {} }); // 'thing' never supplied
        const plan = planConsequences([{ op: 'consumeObject', object: { carried: { archetypeParam: 'thing' } } as unknown as { carried: { archetype?: string } } }], c, new Set());
        expect(plan).toBeNull();
    });

    test('atLocation ref resolves via archetypeParam too, and fails without a world', () => {
        const withWorld = ctx({ params: { thing: 'coin' } });
        withWorld.deps.inventory!.createInstance({ archetypeId: 'coin', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const plan = planConsequences([{ op: 'removeObject', object: { atLocation: { archetypeParam: 'thing' } } as unknown as { atLocation: { archetype?: string } } }], withWorld, new Set());
        expect(plan).not.toBeNull();

        const noWorld = ctx({ params: { thing: 'coin' } }, new Inventory(DEFAULT_OBJECT_ARCHETYPES), false);
        const failedPlan = planConsequences([{ op: 'removeObject', object: { atLocation: { archetype: 'coin' } } } as ConsequenceOp], noWorld, new Set());
        expect(failedPlan).toBeNull();
    });

    test('a ref with no inventory at all always fails to resolve', () => {
        const c = ctx({}, null);
        const plan = planConsequences([{ op: 'consumeObject', object: { carried: { archetype: 'coin' } } }], c, new Set());
        expect(plan).toBeNull();
    });
});

describe('Consequences — consequence ops: setObjectState/removeObject/adjustMoney target branches', () => {
    test('setObjectState and removeObject resolve a {param} ref', () => {
        const c = ctx();
        const coin = c.deps.inventory!.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const setPlan = planConsequences([{ op: 'setObjectState', object: { param: 'target' }, key: 'flag', value: true }], ctxWith(c, { target: coin.id }), new Set());
        applyPlan(setPlan!);
        expect(coin.state).toEqual({ flag: true });

        const removePlan = planConsequences([{ op: 'removeObject', object: { param: 'target' } }], ctxWith(c, { target: coin.id }), new Set());
        applyPlan(removePlan!);
        expect(c.deps.inventory!.getInstance(coin.id)).toBeNull();
    });

    function ctxWith(base: CommitContext, params: Record<string, string>): CommitContext {
        return { ...base, params };
    }

    test('transferObject fails to plan when the object ref cannot resolve', () => {
        const c = ctx();
        const plan = planConsequences([{ op: 'transferObject', object: { param: 'ghost' }, owner: 'world' }], c, new Set());
        expect(plan).toBeNull();
    });

    test('adjustMoney targetPerson without a string target param fails to plan; a bound target credits through the ledger', () => {
        const c = ctx();
        const bad = planConsequences([{ op: 'adjustMoney', amount: 10, target: 'targetPerson' }], c, new Set());
        expect(bad).toBeNull();

        const adjustments: { id: string; delta: number }[] = [];
        const ledger: MoneyLedger = { getPersonBalance: () => 0, adjustPerson: (id, delta) => adjustments.push({ id, delta }) };
        const withLedger = ctx({ params: { target: 'b' }, deps: { ...ctx().deps, ctx: { mode: 'bootstrap', markets: { ledger } } } });
        const plan = planConsequences([{ op: 'adjustMoney', amount: 25, target: 'targetPerson' }], withLedger, new Set());
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        expect(adjustments).toEqual([{ id: 'b', delta: 25 }]);
    });

    test('adjustMoney with no ledger bound is a harmless no-op step', () => {
        const c = ctx();
        const plan = planConsequences([{ op: 'adjustMoney', amount: 10 }], c, new Set());
        expect(plan).not.toBeNull();
        expect(() => applyPlan(plan!)).not.toThrow();
    });
});

describe('Consequences — OAR: contextSatisfied, matchInputs, disposition branches, multi-entry fallthrough', () => {
    test('an unsatisfied context on the first entry falls through to a satisfiable second entry', () => {
        const c = ctx();
        c.deps.inventory!.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const entries: OAREntry[] = [
            { action: 'craft', context: { objectAtLocation: { archetype: 'oven' } }, inputs: [], outputs: [{ archetype: 'coin', bindAs: 'unused' }] },
            { action: 'craft', inputs: [{ archetype: 'coin', quantity: 1, disposition: 'consumed' }], outputs: [{ archetype: 'flyer', bindAs: 'made' }] },
        ];
        const plan = planOAR(entries, c);
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        expect(c.outputs['made']).toBeDefined();
    });

    test('unmatched inputs on the first entry fall through to a second, simpler entry', () => {
        const c = ctx();
        const entries: OAREntry[] = [
            { action: 'craft', inputs: [{ archetype: 'nonexistent_ingredient', quantity: 1, disposition: 'consumed' }], outputs: [{ archetype: 'coin' }] },
            { action: 'craft', inputs: [], outputs: [{ archetype: 'flyer', bindAs: 'made' }] },
        ];
        const plan = planOAR(entries, c);
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        expect(c.outputs['made']).toBeDefined();
    });

    test('an instance whose state does not match the required input state is skipped (stateMatches false)', () => {
        const c = ctx();
        c.deps.inventory!.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, state: { proofed: false } });
        const entries: OAREntry[] = [{ action: 'bake', inputs: [{ archetype: 'raw_dough', state: { proofed: true }, disposition: 'consumed' }], outputs: [{ archetype: 'baked_dough' }] }];
        expect(planOAR(entries, c)).toBeNull(); // no proofed dough available
    });

    test('with no inventory bound, an entry WITH inputs can never be satisfied (matchInputs\' inventory-less branch)', () => {
        const c = ctx({}, null);
        const withInputs: OAREntry[] = [{ action: 'craft', inputs: [{ archetype: 'coin', disposition: 'consumed' }], outputs: [{ archetype: 'flyer' }] }];
        expect(planOAR(withInputs, c)).toBeNull();
    });

    test('with no inventory bound, a zero-input, zero-output entry still plans (nothing to resolve against it)', () => {
        const c = ctx({}, null);
        const noop: OAREntry[] = [{ action: 'craft', inputs: [], outputs: [] }];
        expect(planOAR(noop, c)).toEqual({ steps: [] });
    });

    test('a "retained" input with bindAs names the instance for later reference without consuming it', () => {
        const c = ctx();
        const tool = c.deps.inventory!.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const entries: OAREntry[] = [{
            action: 'use_tool',
            inputs: [{ archetype: 'backpack', disposition: 'retained', bindAs: 'theTool' }],
            outputs: [{ archetype: 'coin', bindAs: 'reward' }],
        }];
        const plan = planOAR(entries, c);
        expect(plan).not.toBeNull();
        applyPlan(plan!);
        expect(c.outputs['theTool']).toBe(tool.id); // named, not consumed
        expect(c.deps.inventory!.getInstance(tool.id)).not.toBeNull(); // still there
        expect(c.outputs['reward']).toBeDefined();
    });

    test('contextSatisfied with an archetypeParam resolves against the committing action\'s params', () => {
        const c = ctx({ params: { needed: 'oven' } });
        c.deps.inventory!.createInstance({ archetypeId: 'oven', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const entries: OAREntry[] = [{
            action: 'bake', context: { objectAtLocation: { archetypeParam: 'needed' } },
            inputs: [], outputs: [{ archetype: 'coin', bindAs: 'x' }],
        }];
        expect(planOAR(entries, c)).not.toBeNull();
    });

    test('contextSatisfied with an unresolvable archetypeParam (missing/wrong-type value) fails', () => {
        const c = ctx({ params: {} });
        const entries: OAREntry[] = [{ action: 'bake', context: { objectAtLocation: { archetypeParam: 'needed' } }, inputs: [], outputs: [{ archetype: 'coin' }] }];
        expect(planOAR(entries, c)).toBeNull();
    });

    test('contextSatisfied fails outright without an inventory or world', () => {
        const c = ctx({}, null);
        const entries: OAREntry[] = [{ action: 'bake', context: { objectAtLocation: { archetype: 'oven' } }, inputs: [], outputs: [{ archetype: 'coin' }] }];
        expect(planOAR(entries, c)).toBeNull();
    });

    test('planOAR with zero entries returns undefined (distinct from null)', () => {
        const c = ctx();
        expect(planOAR([], c)).toBeUndefined();
    });
});
