import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Needs from 'game/population/Needs';
import Mood from 'game/population/Mood';
import Inventory from 'game/objects/Inventory';
import { generateBuildingObjects } from 'game/objects/ObjectGeneration';
import residencesConfig from 'json/residences.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// The aliveness-2 keystone (proposal simulation-aliveness-2, Part 5): the fed-week arc. The audit's town
// starved — one banana per kitchen, no restock channel, pantomime cooking, needs with no teeth. This runs
// a full hourly week over the REAL manifests + a REALLY generated house and asserts the loop the LP-4/5
// bundle exists for: people cook real food, eat it, the pantry depletes honestly, and the food meter stays
// alive. Bootstrap mode (instant transitions) — the live-map physics have their own LP-2/LP-3 keystones.

const TPY = 8640;
const TICK_NOW = 40 * TPY; // midnight, an arbitrary adult life

function gen(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const HOUSE_TAGS = (residencesConfig as { house: { tags: string[] } }).house.tags;

describe('the fed week (LP-4 + LP-5 keystone)', () => {
    test('a week of hourly ticks: real meals from a real pantry, honestly depleted, food meter alive', () => {
        const inventory = new Inventory();
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const needs = new Needs();
        const mood = new Mood();
        const world = new BootstrapWorld(inventory);
        world.register('a');

        const state: PopulationState = { worldSeed: 77, people: { a: gen('a') }, drawSeed: 1, placedIds: [], nextSeq: 9, lastSimulatedYear: 0 };
        // A REAL generated house: the LP-4 pantry staples land via minPerBuilding. The bootstrap 'home' is
        // where objectLocationOf resolves, so generate there.
        generateBuildingObjects({ anchorKey: 'home', tags: HOUSE_TAGS, host: 'house', worldSeed: 77, tick: TICK_NOW }, inventory);
        // The generator writes to 'building:home'; the bootstrap world's shared home is plain 'home' —
        // align the fixture with the abstract location the person's object queries resolve to.
        for (const instance of [...inventory.instancesAtLocation('building:home')]) {
            inventory.moveInstance(instance.id, { kind: 'location', key: 'home' });
        }
        const pantryBefore = inventory.instancesAtLocation('home').filter(instance => ['egg', 'bread_loaf', 'tomato', 'potato'].includes(instance.archetypeId)).length;
        expect(pantryBefore).toBeGreaterThan(0);

        const deps = (tick: number): BrainDeps => ({
            state, tick, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { needs, mood } },
            eventEngine: engine, inventory,
        });
        for (let tick = TICK_NOW; tick < TICK_NOW + 7 * 24; tick++) {
            const tickResult = result();
            if (process.env['FEDWEEK_DEBUG'] && tick % 24 === 7) {
                console.log('[PROBE]', 'tick', tick - TICK_NOW,
                    'critical', JSON.stringify(needs.criticalNeedsOf('a', tick, state.worldSeed)),
                    'loc', JSON.stringify(world.locationOf('a')),
                    'food', Math.round(needs.levelOf('a', 'food', tick, state.worldSeed)),
                    'carriedFood', inventory.carriedInstances('a').map(i => i.archetypeId).join('|'),
                    'pantryAtHome', inventory.instancesAtLocation('home').filter(i => ['egg','bread_loaf','tomato','potato'].includes(i.archetypeId)).length);
            }
            engine.bindMarkets(deps(tick).ctx);
            actions.advance(deps(tick));
            const simResult = engine.simulateTick(state, ['a'], tick, TPY, deps(tick).ctx);
            brain.processTick(['a'], deps(tick), simResult.committed, tickResult);
            engine.unbindMarkets();
            engine.getLifeLog().stampMinutes(tick, state.worldSeed);
        }

        const log = engine.getPersonLog('a');
        if (process.env['FEDWEEK_DEBUG']) {
            const counts: Record<string, number> = {};
            for (const entry of log) { const k = (entry as {defId?:string}).defId ?? 'unk'; counts[k] = (counts[k] ?? 0) + 1; }
            console.log('[FEDWEEK]', JSON.stringify(counts));
            console.log('[FEDWEEK] food by day:', Array.from({length: 8}, (_, d) => Math.round(needs.levelOf('a', 'food', TICK_NOW + d * 24, state.worldSeed))).join(','));
        }
        const meals = log.filter(entry => entry.kind === 'action' && (entry.defId ?? '').startsWith('ate_')).length;
        expect(meals).toBeGreaterThanOrEqual(3); // a week holds real meals, not pantomime

        // Eating CONSUMED the pantry (LP-5's honest OAR alternatives): the home stock strictly shrank —
        // the audit's world only ever accumulated. (Purchases may add carried food on top; bounded.)
        const homeStaples = inventory.instancesAtLocation('home')
            .filter(instance => ['egg', 'bread_loaf', 'tomato', 'potato'].includes(instance.archetypeId)).length;
        expect(homeStaples).toBeLessThan(pantryBefore);
        const carriedStaples = inventory.possessionsOf('a')
            .filter(instance => ['egg', 'bread_loaf', 'tomato', 'potato'].includes(instance.archetypeId))
            .reduce((total, instance) => total + instance.quantity, 0);
        expect(carriedStaples).toBeLessThanOrEqual(12); // no hoarding spiral

        // The meter never flatlines for the week (the audit's town pinned food at 0 by day 2).
        expect(needs.levelOf('a', 'food', TICK_NOW + 7 * 24, state.worldSeed)).toBeGreaterThan(10);
        // And nobody went permanently hungry: at most an early wobble before the rhythm sets in.
        const hungryDays = log.filter(entry => entry.kind === 'event' && entry.defId === 'went_hungry').length;
        expect(hungryDays).toBeLessThanOrEqual(2);
    });
});
