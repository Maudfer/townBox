import EventEngine from 'game/events/EventEngine';
import { maybeConceive, CONCEPTION_CHANCE } from 'game/population/Conception';
import eventsConfig from 'json/events.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest } from 'types/LifeEvent';
import { Genders, Gender } from 'types/Social';

// Conception rides intimacy (W4 / proposal simulation-aliveness-3 P1-6): a had_sex commit rolls a seeded
// conception chance and invokes the REAL pregnancy event on the would-be mother — whose own eligibility
// (married, wantsMoreChildren, age) keeps the last word. The old world had had_sex with zero effects and
// pregnancy free-rolling beside it.

const TPY = 8640;
const EVENTS = eventsConfig as unknown as EventManifest;

function gen(id: string, gender: Gender, ageYears: number, partnerId: string | null): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, maxChildren: 3,
        partnerships: partnerId ? [{ partnerId, startTick: -5 * TPY, endTick: null }] : [],
    };
}

function married(): PopulationState {
    return {
        worldSeed: 77,
        people: {
            wife: gen('wife', Genders.Female, 28, 'husband'),
            husband: gen('husband', Genders.Male, 30, 'wife'),
        },
        drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0,
    };
}

describe('W4: conception from intimacy', () => {
    test('a married couple conceives through had_sex commits at the seeded chance — from either subject', () => {
        const state = married();
        const engine = new EventEngine(EVENTS);
        let conceived = 0;
        for (let tick = 0; tick < 600 && conceived === 0; tick++) {
            // Real intimacy first: pregnancy's eligibility requires a recent had_sex (the gate holds on
            // the invoke path too). Then alternate the commit subject: the roll must find the MOTHER.
            engine.invoke(state, 'had_sex', 'wife', tick, TPY, { source: 'system', causationId: null });
            maybeConceive(state, engine, tick % 2 === 0 ? 'husband' : 'wife', tick, TPY, null);
            conceived = engine.getPersonLog('wife').filter(entry => entry.kind === 'event' && entry.defId === 'pregnancy').length;
        }
        expect(conceived).toBeGreaterThan(0); // ~10%/commit: 600 rolls make a miss astronomically unlikely
        // And the pregnant flag is real (LP-6 gestation): the overlay records it for the scheduled birth.
        expect(engine.getPersonLog('husband').some(entry => entry.kind === 'event' && entry.defId === 'pregnancy')).toBe(false);
    });

    test('no spouse, no conception channel (the event eligibility keeps the last word)', () => {
        const state = married();
        state.people['wife']!.partnerships = [];
        state.people['husband']!.partnerships = [];
        const engine = new EventEngine(EVENTS);
        for (let tick = 0; tick < 400; tick++) {
            maybeConceive(state, engine, 'wife', tick, TPY, null);
        }
        expect(engine.getPersonLog('wife').some(entry => entry.kind === 'event' && entry.defId === 'pregnancy')).toBe(false);
    });

    test('the chance constant is the documented one (a rate change is a conscious decision)', () => {
        expect(CONCEPTION_CHANCE).toBe(0.10);
    });
});
