import { consentProbability } from 'game/actions/Consent';
import Mood, { MOOD_CONFIG } from 'game/population/Mood';
import EventEngine from 'game/events/EventEngine';
import eventsConfig from 'json/events.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Mood (task 091 / proposal G1): valence impulses with magnitude-scaled half-lives (a ripple fades in days,
// grief shadows months), the closed-form read, the engine wiring (every commit lands its authored valence),
// and the consent shift.

const TPY = 8640;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

describe('the meter', () => {
    test('rests at the baseline; impulses land scaled and clamped', () => {
        const mood = new Mood();
        expect(mood.moodOf('a', 0)).toBe(MOOD_CONFIG.baseline);
        mood.impulse('a', 2, 0);
        expect(mood.moodOf('a', 0)).toBe(MOOD_CONFIG.baseline + 2 * MOOD_CONFIG.impulseScale);
        // A stack of blows clamps at 0, never below.
        for (let i = 0; i < 6; i++) {
            mood.impulse('a', -3, 0);
        }
        expect(mood.moodOf('a', 0)).toBe(0);
    });

    test('magnitude picks the half-life: a ripple fades in days, grief shadows months (closed-form)', () => {
        const mood = new Mood();
        mood.impulse('a', -1, 0);
        mood.impulse('b', -3, 0);
        const ripple = MOOD_CONFIG.baseline - mood.moodOf('a', MOOD_CONFIG.halfLifeDays['1'] * 24);
        expect(ripple).toBeCloseTo(MOOD_CONFIG.impulseScale / 2, 6); // exactly half after one half-life
        // 30 days on: the ripple is dust, the grief is still heavy.
        expect(MOOD_CONFIG.baseline - mood.moodOf('a', 30 * 24)).toBeLessThan(0.01);
        expect(MOOD_CONFIG.baseline - mood.moodOf('b', 30 * 24)).toBeGreaterThan(10);
        // Stride-independence (the K2 rule): reads never mutate.
        const fresh = new Mood();
        fresh.loadState(mood.serialize());
        expect(fresh.moodOf('b', 30 * 24)).toBeCloseTo(mood.moodOf('b', 30 * 24), 12);
    });

    test('the impulse list stays bounded, strongest-surviving', () => {
        const mood = new Mood();
        for (let i = 0; i < 20; i++) {
            mood.impulse('a', 1, i);
        }
        expect(mood.serialize().people['a']!.impulses.length).toBeLessThanOrEqual(MOOD_CONFIG.maxActiveImpulses);
    });
});

describe('the engine wiring', () => {
    test('a committed event lands its authored valence on the subject through markets.mood', () => {
        const mood = new Mood();
        const engine = new EventEngine(EVENTS);
        const state: PopulationState = { worldSeed: 4, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        const before = mood.moodOf('a', 100);
        // became_parent is manual + valence +3 (the pass tagged it).
        const { outcome } = engine.invoke(state, 'became_parent', 'a', 100, TPY, { source: 'system', causationId: null }, {}, { markets: { mood } });
        expect(outcome.ok).toBe(true);
        expect(mood.moodOf('a', 100)).toBeGreaterThan(before);
    });

    test('the mood context attribute reads the ledger (vice gates depend on it)', () => {
        const mood = new Mood();
        const engine = new EventEngine(EVENTS);
        const state: PopulationState = { worldSeed: 4, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        engine.bindMarkets({ markets: { mood } });
        mood.impulse('a', -3, 100);
        const context = engine.contextFor(state, 'a', 100, TPY);
        expect(context.getAttr('mood')).toBe(mood.moodOf('a', 100));
        engine.unbindMarkets();
    });
});

describe('the consent shift', () => {
    test('a low target mood makes everything a harder ask', () => {
        const base = { actionId: 'hugged_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 0, worldSeed: 1 };
        const gloomy = consentProbability({ ...base, targetMood: 15 });
        const sunny = consentProbability({ ...base, targetMood: 95 });
        expect(sunny).toBeGreaterThan(gloomy);
        expect(consentProbability({ ...base, targetMood: MOOD_CONFIG.baseline })).toBeCloseTo(consentProbability(base), 9);
    });
});

describe('the valence pass (P2c)', () => {
    test('the heavy hitters carry their authored weights; texture defaults landed', () => {
        expect(EVENTS['became_widowed']!.valence).toBe(-3);
        expect(EVENTS['marriage']!.valence).toBe(3);
        expect(EVENTS['fell_ill']!.valence).toBe(-1);
        expect(EVENTS['made_friend']!.valence).toBe(1);
        // A healthy share of the corpus is tagged (414 at authoring time; floor guards regressions).
        const tagged = Object.values(EVENTS).filter(event => (event.valence ?? 0) !== 0).length;
        expect(tagged).toBeGreaterThan(300);
    });
});
