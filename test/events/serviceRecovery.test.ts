import EventEngine from 'game/events/EventEngine';
import { SERVICES_CONFIG } from 'game/economy/CityServices';
import eventsConfig from 'json/events.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest } from 'types/LifeEvent';
import { ServiceCoverageReader } from 'types/Services';
import { Genders } from 'types/Social';

// Healthcare coverage with teeth (task 096 / proposal H2): recovery hazards carry a factor over the
// subject's healthcareCoverage attribute, which resolves through markets.services. A town with a staffed
// hospital measurably recovers faster than one without — same seed, same illness, different ledger — and an
// unmeasured context (no reader bound) reads the neutral level where the curve is exactly 1.

const TPY = 8640;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(): PopulationState {
    return { worldSeed: 55, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
}

const reader = (ratio: number): ServiceCoverageReader => ({ coverageOf: () => ratio });

// Fall ill at tick 0, then walk the year hour by hour until `recovered` commits. Same world seed → the RNG
// stream is identical across runs; only the hazard differs, so the covered run can never recover LATER.
function recoveryTick(services: ServiceCoverageReader | null): number {
    const engine = new EventEngine(EVENTS);
    const state = makeState();
    engine.invoke(state, 'fell_ill', 'a', 0, TPY, { source: 'system', causationId: null });
    const ctx = services ? { markets: { services } } : {};
    for (let tick = 1; tick < TPY; tick++) {
        engine.simulateTick(state, ['a'], tick, TPY, ctx);
        if (engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'recovered')) {
            return tick;
        }
    }
    return TPY;
}

describe('coverage → recovery speed', () => {
    // Cohort frequencies, not a single pair (the jobSeeking lesson): one sick person's recovery tick can
    // legitimately TIE across coverages (the winning draw lands below both hazards), and per-seed draws are
    // correlated. Thirty sick people give each agent its own draw slot per tick — the covered town must
    // recover decisively more of them within the window (hazard 0.0029 vs 0.0016/tick → ≈52% vs ≈32% by
    // tick 300).
    test('a covered town recovers decisively more of a sick cohort within the window', () => {
        const recoveredCount = (ratio: number): number => {
            const engine = new EventEngine(EVENTS);
            const ids = Array.from({ length: 30 }, (_, index) => `p${String(index).padStart(2, '0')}`);
            const people: Record<string, GenPerson> = {};
            for (const id of ids) {
                people[id] = person(id);
            }
            const state: PopulationState = { worldSeed: 55, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
            for (const id of ids) {
                engine.invoke(state, 'fell_ill', id, 0, TPY, { source: 'system', causationId: null });
            }
            for (let tick = 1; tick <= 300; tick++) {
                engine.simulateTick(state, ids, tick, TPY, { markets: { services: reader(ratio) } });
            }
            return ids.filter(id => engine.getPersonLog(id).some(entry => entry.kind === 'event' && entry.defId === 'recovered')).length;
        };
        const covered = recoveredCount(1);
        const uncovered = recoveredCount(0);
        expect(covered).toBeGreaterThan(uncovered);
        // And the minimum-duration gate (092) holds: nobody recovers within two days even fully covered.
        const engine = new EventEngine(EVENTS);
        const state = makeState();
        engine.invoke(state, 'fell_ill', 'a', 0, TPY, { source: 'system', causationId: null });
        for (let tick = 1; tick <= 48; tick++) {
            engine.simulateTick(state, ['a'], tick, TPY, { markets: { services: reader(1) } });
        }
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'recovered')).toBe(false);
    });

    test('an unmeasured context reads the neutral coverage (factor ×1) — no ledger, no effect', () => {
        const engine = new EventEngine(EVENTS);
        const state = makeState();
        expect(engine.contextFor(state, 'a', 0, TPY).getAttr('healthcareCoverage')).toBe(SERVICES_CONFIG.neutralCoverage);
        // And a bound reader flows through the same attribute.
        engine.bindMarkets({ markets: { services: reader(0.9) } });
        expect(engine.contextFor(state, 'a', 0, TPY).getAttr('healthcareCoverage')).toBe(0.9);
        engine.unbindMarkets();
        // Neutral-vs-unbound equivalence: the same seeded year recovers at the same tick either way.
        expect(recoveryTick(null)).toBe(recoveryTick(reader(SERVICES_CONFIG.neutralCoverage)));
    });
});
