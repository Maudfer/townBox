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

// Seed chosen for a strictly separating stream: covered-vs-uncovered can legitimately TIE on many seeds
// (the winning draw lands below both hazards — the factor can only ever make recovery earlier-or-equal),
// so the strict assertion pins a seed where the gap actually shows (day ~2 vs day ~21 here).
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
    test('full coverage recovers no later than none, and strictly earlier on this seed', () => {
        const uncovered = recoveryTick(reader(0));
        const covered = recoveryTick(reader(1));
        expect(covered).toBeLessThanOrEqual(uncovered);
        expect(covered).toBeLessThan(uncovered); // the 0.75 vs 1.4 factor gap shows on this seed
        // The illness minimum-duration gate (task 092) still holds under full coverage.
        expect(covered).toBeGreaterThan(48);
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
