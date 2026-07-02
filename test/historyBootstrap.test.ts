import { bootstrapHistory, BootstrapParams } from '../src/app/game/HistoryBootstrap';
import { GenPerson, PersonTable, PopulationState } from '../src/types/Genealogy';
import { Genders, Gender } from '../src/types/Social';

const TPY = 360;

function gen(id: string, gender: Gender, birthYear: number, deathYear: number | null = null): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fam',
        gender,
        birthTick: birthYear * TPY,
        deathTick: deathYear === null ? null : deathYear * TPY,
        fatherId: null,
        motherId: null,
        partnerships: [],
    };
}

// A married couple (alive across the whole span), their child, and a long-dead ancestor.
function makePool(worldSeed = 42): PopulationState {
    const m = gen('m', Genders.Male, -30);
    const f = gen('f', Genders.Female, -28);
    m.partnerships.push({ partnerId: 'f', startTick: -8 * TPY, endTick: null });
    f.partnerships.push({ partnerId: 'm', startTick: -8 * TPY, endTick: null });
    const c = gen('c', Genders.Male, -6);
    c.fatherId = 'm';
    c.motherId = 'f';
    const d = gen('d', Genders.Female, -90, -70); // died long before the bootstrap span

    const people: PersonTable = { m, f, c, d };
    return { worldSeed, people, drawSeed: 0, placedIds: [], nextSeq: 4, lastSimulatedYear: -999 };
}

const PARAMS: BootstrapParams = { enabled: true, years: 6, ticksPerYear: TPY, stepDays: 1 };

function clone(state: PopulationState): PopulationState {
    return JSON.parse(JSON.stringify(state));
}

describe('History bootstrap (task 036)', () => {
    test('living pool people accrue real event history over the span', () => {
        const { history } = bootstrapHistory(makePool(), PARAMS);

        // The married couple should have intimate history recorded (had_sex fires often for partners), which is
        // exactly the record pregnancy/other gated events need — the cold start it removes.
        const coupleHasHistory = !!(history['m']?.['had_sex'] || history['f']?.['had_sex']);
        expect(coupleHasHistory).toBe(true);
    });

    test('is deterministic: same world seed → identical resulting pool and history', () => {
        const a = bootstrapHistory(clone(makePool()), PARAMS);
        const b = bootstrapHistory(clone(makePool()), PARAMS);
        expect(JSON.stringify(a.history)).toBe(JSON.stringify(b.history));
        expect(JSON.stringify(a.state.people)).toBe(JSON.stringify(b.state.people));
    });

    test('a different world seed yields a different history', () => {
        const a = bootstrapHistory(makePool(1));
        const b = bootstrapHistory(makePool(2));
        // Over a multi-year span the stochastic streams diverge (birth counts, event ticks, etc.).
        expect(JSON.stringify(a.history)).not.toBe(JSON.stringify(b.history));
    });

    test('people already dead before the span are untouched and gain no history', () => {
        const { state, history } = bootstrapHistory(makePool(), PARAMS);
        expect(state.people['d']!.deathTick).toBe(-70 * TPY); // unchanged
        expect(history['d']).toBeUndefined();
    });

    test('anchors lastSimulatedYear at the present so the coarse live sim will not re-run the span', () => {
        const { state } = bootstrapHistory(makePool(), PARAMS);
        expect(state.lastSimulatedYear).toBe(0);
    });

    test('disabled bootstrap is a no-op', () => {
        const { history } = bootstrapHistory(makePool(), { ...PARAMS, enabled: false });
        expect(Object.keys(history)).toHaveLength(0);
    });
});
