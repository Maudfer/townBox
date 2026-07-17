import EventEngine from 'game/events/EventEngine';
import Mood from 'game/population/Mood';
import eventsConfig from 'json/events.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Depression as a wired STATE (task 095 / proposal G3): sustained low mood raises the depressive_episode
// hazard (the mood factor zeroes at healthy mood, so the content can only fire on the miserable);
// the 'depressed' attribute gates the withdrawal modifiers in actions.json; lifted_spirits reads mood the
// other way, so social support (which lifts mood) genuinely speeds recovery — measured, never scripted.

const TPY = 8640;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(): PopulationState {
    return { worldSeed: 6, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
}

describe('the state machine', () => {
    test('episode sets depressed; a second episode is ineligible; lifted_spirits clears it', () => {
        const engine = new EventEngine(EVENTS);
        const state = makeState();

        // Recovery is ineligible while not depressed.
        const early = engine.invoke(state, 'lifted_spirits', 'a', 100, TPY, { source: 'system', causationId: null });
        expect(early.outcome.ok).toBe(false);

        const episode = engine.invoke(state, 'depressive_episode', 'a', 100, TPY, { source: 'system', causationId: null });
        expect(episode.outcome.ok).toBe(true);
        expect(engine.contextFor(state, 'a', 101, TPY).getAttr('depressed')).toBe(true);

        // Already depressed → the episode's own eligibility (depressed == false) rejects a double-commit.
        const relapse = engine.invoke(state, 'depressive_episode', 'a', 102, TPY, { source: 'system', causationId: null });
        expect(relapse.outcome.ok).toBe(false);

        const lifted = engine.invoke(state, 'lifted_spirits', 'a', 200, TPY, { source: 'system', causationId: null });
        expect(lifted.outcome.ok).toBe(true);
        expect(engine.contextFor(state, 'a', 201, TPY).getAttr('depressed')).toBe(false);
        // The person log carries the arc in order, with the feed signals attached to the manifest.
        const logIds = engine.getPersonLog('a').filter(e => e.kind === 'event').map(e => e.defId);
        expect(logIds).toEqual(['depressive_episode', 'lifted_spirits']);
    });

    test('the depressed attribute defaults false and is compiler-known (no unknown-attribute warning)', () => {
        const engine = new EventEngine(EVENTS);
        const state = makeState();
        expect(engine.contextFor(state, 'a', 0, TPY).getAttr('depressed')).toBe(false);
        expect(engine.getGraph().warnings.filter(w => w.includes('depressed'))).toEqual([]);
    });
});

describe('the mood coupling (probabilistic hazard)', () => {
    // Run the same seeded year twice: once with the meter dragged to the floor, once at baseline. The step
    // factor zeroes at mood ≥ 45, so the content person NEVER slips into an episode, while the grieving one
    // eventually does (perYear 1.2 × factor 5 ≈ once every couple of months of misery).
    function episodesOverAYear(gloomy: boolean): number {
        const engine = new EventEngine(EVENTS);
        const mood = new Mood();
        const state = makeState();
        if (gloomy) {
            for (let i = 0; i < 6; i++) {
                mood.impulse('a', -3, 0); // stacked grief: pinned at ~0 for months
            }
        }
        let episodes = 0;
        for (let tick = 0; tick < TPY; tick += 24) {
            // Day strides keep the test fast; the Poisson conversion is stride-honest (task 048).
            const result = engine.simulateTick(state, ['a'], tick, TPY, { markets: { mood } }, 24);
            void result;
            if (engine.getPersonLog('a').some(e => e.kind === 'event' && e.defId === 'depressive_episode')) {
                episodes++;
                break;
            }
            // Keep the gloom pinned (impulses decay over months; re-land to hold the floor).
            if (gloomy && tick % (30 * 24) === 0) {
                mood.impulse('a', -3, tick);
            }
        }
        return episodes;
    }

    test('a person at baseline mood never has an episode; a grief-pinned person does', () => {
        expect(episodesOverAYear(false)).toBe(0);
        expect(episodesOverAYear(true)).toBeGreaterThan(0);
    });
});

describe('the manifest wiring', () => {
    test('both events are authored the way the arc needs them', () => {
        const episode = EVENTS['depressive_episode']!;
        expect(episode.valence).toBe(-2);
        expect(episode.limit).toEqual({ withinTicks: 2160 });
        expect(episode.triggers.manual).toBeDefined();
        expect(episode.effects).toContainEqual({ type: 'setAttr', attr: 'depressed', value: true });
        expect(episode.effects).toContainEqual({ type: 'emit', signal: 'depressiveEpisode', target: 'subject' });

        const lifted = EVENTS['lifted_spirits']!;
        expect(lifted.valence).toBe(2);
        expect(lifted.effects).toContainEqual({ type: 'setAttr', attr: 'depressed', value: false });
        expect(lifted.effects).toContainEqual({ type: 'emit', signal: 'liftedSpirits', target: 'subject' });
    });
});
