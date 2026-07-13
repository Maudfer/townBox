import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Habits, { HABITS_CONFIG } from 'game/population/Habits';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import { ActionManifest, ActionDefinition } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Vices & habits (task 095 / proposal G3): committing a habit-linked action practices the habit through
// markets.habits; the habit level multiplies the vice's own free-time selection weight (escalation); and
// depression collapses the outgoing social/leisure weights (the withdrawal pass) while the home-bound coping
// set stays exempt — addiction and withdrawal both emerge from the same selection math as everything else.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    ids.forEach(id => (people[id] = person(id)));
    return { worldSeed: 31, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('habit practice through the engine', () => {
    test('a discrete commit with a habit key practices it; one without does not', () => {
        const manifest: ActionManifest = {
            sip: { label: 'Sipped', type: 'discrete', category: 'leisure', habit: 'drinking' },
            blink: { label: 'Blinked', type: 'discrete', category: 'leisure' },
        };
        const engine = new EventEngine({});
        const actions = new ActionEngine(manifest, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const habits = new Habits();
        const deps = { state: pool(['a']), tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world, markets: { habits } }, eventEngine: engine, inventory };

        expect(actions.startAction('a', 'blink', {}, { source: 'brain', causationId: null }, deps, result()).ok).toBe(true);
        expect(habits.levelOf('a', 'drinking', 10)).toBe(0);
        expect(actions.startAction('a', 'sip', {}, { source: 'brain', causationId: null }, deps, result()).ok).toBe(true);
        expect(habits.levelOf('a', 'drinking', 10)).toBe(HABITS_CONFIG.practiceBump);
    });

    test('a continuous habit action practices ONLY on completion (interruption practices nothing)', () => {
        const manifest: ActionManifest = {
            bender: { label: 'On a bender', type: 'continuous', category: 'leisure', durationTicks: 2, habit: 'drinking' },
        };
        const engine = new EventEngine({});
        const actions = new ActionEngine(manifest, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('a');
        world.register('b');
        const habits = new Habits();
        const mkDeps = (tick: number) => ({ state: pool(['a', 'b']), tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world, markets: { habits } }, eventEngine: engine, inventory });

        // Person a completes the action: 2 running ticks then the duration closes it.
        expect(actions.startAction('a', 'bender', {}, { source: 'brain', causationId: null }, mkDeps(0), result()).ok).toBe(true);
        for (let tick = 1; tick <= 4 && actions.activeInstanceOf('a'); tick++) {
            actions.advance(mkDeps(tick));
        }
        // Practiced at the completion tick; the read a couple of ticks later is (barely) cooled.
        expect(habits.levelOf('a', 'drinking', 5)).toBeGreaterThan(HABITS_CONFIG.practiceBump * 0.99);

        // Person b gets interrupted mid-run: no practice.
        expect(actions.startAction('b', 'bender', {}, { source: 'brain', causationId: null }, mkDeps(10), result()).ok).toBe(true);
        const instance = actions.activeInstanceOf('b')!;
        actions.interrupt(instance.id, { source: 'brain', causationId: null }, mkDeps(11), result());
        expect(habits.levelOf('b', 'drinking', 12)).toBe(HABITS_CONFIG.practiceBump * 0); // still zero
    });
});

describe('escalation in free-time selection', () => {
    // Count evening picks of the drinking repertoire over many independent ticks. A maxed-out habit
    // multiplies drank_alone/at_the_bar weights ×(1 + 10×escalationPerLevel) ≈ ×4.5 — the practiced
    // drinker must reach for the bottle measurably more often than the identical teetotaler. The habit
    // is re-practiced daily (an active drinker's counter never cools) so the multiplier holds all run.
    function countDrinkingPicks(habits: Habits | null, keepSaturated = false): number {
        const engine = new EventEngine(); // real manifests: attrs (mood/depressed) resolve through agentAttr
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('a');
        let picks = 0;
        for (let day = 0; day < 150; day++) {
            const tick = day * 24 + 20; // 20:00 — inside both vices' evening windows
            if (habits && keepSaturated) {
                for (let i = 0; i < 12; i++) {
                    habits.practice('a', 'drinking', tick);
                }
            }
            const deps: BrainDeps = {
                state: pool(['a']), tick, ticksPerYear: TPY,
                ctx: { mode: 'bootstrap', world, markets: habits ? { habits } : {} },
                eventEngine: engine, inventory,
            };
            const pick = brain.selectFreeTimeAction('a', deps);
            if (pick === 'drank_alone' || pick === 'at_the_bar') {
                picks++;
            }
        }
        return picks;
    }

    test('a practiced habit raises the vice pick rate; no habit reads as ×1', () => {
        const sober = countDrinkingPicks(null);
        const hooked = countDrinkingPicks(new Habits(), true);
        expect(hooked).toBeGreaterThan(sober * 2);
        // And the empty-ledger run matches the no-market run exactly (multiplier 1 changes nothing).
        expect(countDrinkingPicks(new Habits())).toBe(sober);
    });
});

describe('the withdrawal pass (data)', () => {
    test('outgoing social/leisure actions carry the depressed dampener; the coping set stays exempt', () => {
        const exempt = new Set(['at_the_bar', 'drank_alone', 'stayed_in_bed_all_day', 'resting_at_home_sick']);
        const isDepressedDampener = (def: ActionDefinition): boolean =>
            (def.selection?.modifiers ?? []).some(m => JSON.stringify(m.when).includes('"depressed"') && m.multiply < 1);
        let dampened = 0;
        for (const [id, def] of Object.entries(ACTIONS)) {
            if (def.type !== 'continuous') {
                continue;
            }
            const outgoing = def.category === 'social'
                || (def.category === 'leisure' && typeof def.location === 'string' && (def.location.startsWith('venue:') || def.location === 'outside'));
            if (exempt.has(id)) {
                expect(isDepressedDampener(def)).toBe(false);
            } else if (outgoing) {
                expect({ id, dampened: isDepressedDampener(def) }).toEqual({ id, dampened: true });
                dampened++;
            }
        }
        expect(dampened).toBeGreaterThanOrEqual(15);
    });

    test('the vice actions are wired: habit keys, mood gates, and the withdrawal boosters exist', () => {
        expect(ACTIONS['at_the_bar']!.habit).toBe('drinking');
        expect(ACTIONS['drank_alone']!.habit).toBe('drinking');
        expect(ACTIONS['drank_alone']!.location).toBe('home');
        // stayed_in_bed_all_day is the withdrawal magnet: huge depressed multiplier, no habit (it isn't a vice).
        const bed = ACTIONS['stayed_in_bed_all_day']!;
        expect(bed.habit).toBeUndefined();
        expect((bed.selection?.modifiers ?? []).some(m => JSON.stringify(m.when).includes('"depressed"') && m.multiply > 1)).toBe(true);
    });
});
