import ActionEngine from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import KnownFacts from 'game/population/KnownFacts';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Gossip in motion (task 104 / O2 + the C4 seam): witnesses RECORD what they saw into the known-facts
// memory, and shared_gossip commits carry the speaker's target through the event payload so the transfer
// can move the juiciest story along. Both halves ride machinery that already exists (witness pass, 067
// payloads, counterpart events).

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    ids.forEach(id => (people[id] = person(id)));
    return { worldSeed: 41, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('witnesses record (O1 intake)', () => {
    test('a co-located witness of a notable scene learns the fact — zero-valence scenes are noise', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('actor');
        world.register('bystander');
        const knownFacts = new KnownFacts();
        const state = pool(['actor', 'bystander']);
        const deps = { state, tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world, markets: { knownFacts } }, eventEngine: engine, inventory };

        // Commit a witnessable, negatively-valenced event on the actor (escaped_a_fire: witnessable, -2).
        const { outcome, result: invokeResult } = engine.invoke(state, 'escaped_a_fire', 'actor', 10, TPY, { source: 'system', causationId: null }, {}, deps.ctx);
        expect(outcome.ok).toBe(true);
        brain.processTick(['actor', 'bystander'], deps, invokeResult.committed, result());

        const facts = knownFacts.factsOf('bystander', 11);
        expect(facts).toHaveLength(1);
        expect(facts[0]!.aboutId).toBe('actor');
        expect(facts[0]!.eventId).toBe('escaped_a_fire');
        expect(facts[0]!.valence).toBe(-2);
        expect(facts[0]!.viaWitness).toBe(true);
    });
});

describe('the transfer pick (O2 policy)', () => {
    // City.transferGossip is a pure function of the store — exercised here through a minimal Game stub.
    test('the juiciest story travels; stories about the speaker or listener never do', async () => {
        const CityModule = await import('game/City');
        const FieldModule = await import('game/world/Field');
        const knownFacts = new KnownFacts();
        const game = {
            field: null, knownFacts,
            gridParams: { rows: 10, cols: 10, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: () => ({ x: 0, y: 0 }),
            pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as never;
        const field = new FieldModule.default(game, 10, 10);
        (game as { field: unknown }).field = field;
        const city = new CityModule.default(game);

        knownFacts.learn('speaker', { aboutId: 'x', seq: 1, eventId: 'mild', valence: 1, learnedAtTick: 0, viaWitness: true });
        knownFacts.learn('speaker', { aboutId: 'y', seq: 2, eventId: 'scandal', valence: -3, learnedAtTick: 0, viaWitness: true });
        knownFacts.learn('speaker', { aboutId: 'listener', seq: 3, eventId: 'about_them', valence: -3, learnedAtTick: 0, viaWitness: true });

        city.transferGossip('speaker', 'listener', 10);
        const heard = knownFacts.factsOf('listener', 10);
        expect(heard).toHaveLength(1);
        expect(heard[0]!.eventId).toBe('scandal'); // |−3| beats |1|; the about-them story never travels
        expect(heard[0]!.viaWitness).toBe(false); // heard, not seen
    });
});

describe('the gossip payload (O2 plumbing)', () => {
    test('shared_gossip commits with the target in the payload; the listener logs the counterpart', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('speaker');
        world.register('listener');
        const state = pool(['speaker', 'listener']);
        const deps = { state, tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world }, eventEngine: engine, inventory };

        const tickResult = result();
        const start = actions.startAction('speaker', 'shared_gossip', { target: 'listener' }, { source: 'brain', causationId: null }, deps, tickResult);
        expect(start.ok).toBe(true);
        const commit = tickResult.committed.find(entry => entry.eventId === 'shared_gossip');
        expect(commit).toBeDefined();
        expect(commit!.params?.['target']).toBe('listener'); // City's transfer reads exactly this
        expect(engine.getPersonLog('listener').some(entry => entry.kind === 'event' && entry.defId === 'heard_gossip')).toBe(true);
    });
});
