import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory from 'game/objects/Inventory';
import Mood, { MOOD_CONFIG } from 'game/population/Mood';
import Needs from 'game/population/Needs';
import { ActionManifest, OARTable } from 'types/Action';
import { GenPerson, PopulationState } from 'types/Genealogy';
import { NeedsReader } from 'types/Needs';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Needs with teeth (LP-5 / proposal simulation-aliveness-2 P1-1, P1-7). The audit's starving town held a
// median mood of 77 because needs fed nothing but selection weights. Now: starvation commits a wired
// went_hungry (valence −2 → mood through the standard machinery), raises the fell_ill hazard through the
// foodLevel attribute, and the household cook feeds co-located people (satisfyNeed).

const TPY = 8640;

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'F', gender: Genders.Female, birthTick: 1000 - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function state(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    for (const id of ids) {
        people[id] = gen(id);
    }
    return { worldSeed: 5, people, drawSeed: 1, placedIds: [], nextSeq: 50, lastSimulatedYear: 0 };
}

// A pinned-level needs stub (NeedsReader surface) for attribute reads.
function stubNeeds(level: number): NeedsReader {
    return {
        levelOf: () => level,
        satisfy: () => {},
        selectionMultiplier: () => 1,
        criticalNeedsOf: () => [],
    };
}

describe('starvation consequences (LP-5)', () => {
    test('a starving person commits went_hungry (once per day) and their mood drops through valence', () => {
        const engine = new EventEngine();
        const mood = new Mood();
        const pool = state(['a']);
        const ctx = { markets: { needs: stubNeeds(2), mood } };
        for (let tick = 1000; tick < 1000 + 48; tick++) {
            engine.simulateTick(pool, ['a'], tick, TPY, ctx as never);
        }
        const hungry = engine.getPersonLog('a').filter(entry => entry.kind === 'event' && entry.defId === 'went_hungry');
        expect(hungry.length).toBeGreaterThanOrEqual(1);
        expect(hungry.length).toBeLessThanOrEqual(2); // once per day over two days
        expect(mood.moodOf('a', 1000 + 48)).toBeLessThan(MOOD_CONFIG.baseline);
    });

    test('a well-fed person never goes hungry (the gate holds)', () => {
        const engine = new EventEngine();
        const pool = state(['a']);
        const ctx = { markets: { needs: stubNeeds(90) } };
        for (let tick = 1000; tick < 1000 + 48; tick++) {
            engine.simulateTick(pool, ['a'], tick, TPY, ctx as never);
        }
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'went_hungry')).toBe(false);
    });
});

describe('the family table (LP-5 / P1-7)', () => {
    const ACTIONS: ActionManifest = {
        served_the_family: {
            label: 'Served the family a meal', type: 'discrete', category: 'maintenance',
            consequences: [{ op: 'satisfyNeed', need: 'food', amount: 35, scope: 'coLocated' }],
        },
    } as unknown as ActionManifest;

    test('the cook feeds everyone sharing the room, not themselves twice', () => {
        const inventory = new Inventory();
        const engine = new EventEngine({} as never);
        const actions = new ActionEngine(ACTIONS, engine.getLifeLog(), {} as OARTable);
        const needs = new Needs();
        const world = new BootstrapWorld(inventory);
        const pool = state(['cook', 'kid']);
        world.register('cook');
        world.register('kid');
        const deps: ActionDeps = {
            state: pool, tick: 500, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { needs } },
            eventEngine: engine, inventory,
        };
        const result: TickResult = { died: [], born: [], signals: [], committed: [] };
        const kidBefore = needs.levelOf('kid', 'food', 500, pool.worldSeed);
        const cookBefore = needs.levelOf('cook', 'food', 500, pool.worldSeed);

        expect(actions.startAction('cook', 'served_the_family', {}, { source: 'system', causationId: null }, deps, result).ok).toBe(true);

        // The kid ate (fan-out); the cook's own credit rides `satisfies` (none in this fixture).
        expect(needs.levelOf('kid', 'food', 500, pool.worldSeed)).toBeGreaterThan(kidBefore);
        expect(needs.levelOf('cook', 'food', 500, pool.worldSeed)).toBe(cookBefore);
    });
});
