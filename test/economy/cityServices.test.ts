import City from 'game/City';
import Clock from 'game/Clock';
import CityServices, { SERVICES_CONFIG, computeCoverage, computeSqualor } from 'game/economy/CityServices';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import { PixelPosition, TilePosition } from 'types/Position';
import { ServiceCoverage, ServiceInputs } from 'types/Services';

// The city-services coverage ledger (task 096 / proposal H1–H2): pure ratio derivation over what actually
// exists (facilities + practicing providers + school seats), the reader's neutral-until-measured contract
// (no ledger, no behavioral effect — the factor curves pass through 1 at neutral), and the config's own
// sanity against the coverage math.

function inputs(overrides: Partial<ServiceInputs> = {}): ServiceInputs {
    return { population: 100, providersByService: {}, facilitiesByService: {}, schoolSeats: 0, schoolAgeChildren: 0, ...overrides };
}

describe('computeCoverage', () => {
    test('no facility → 0, regardless of credentialed people walking around', () => {
        const lines = computeCoverage(inputs({ providersByService: { healthcare: 5 } }));
        const healthcare = lines.find(line => line.service === 'healthcare')!;
        expect(healthcare.ratio).toBe(0);
        expect(healthcare.facilities).toBe(0);
        expect(healthcare.providers).toBe(5);
    });

    test('a staffed facility covers up to what the population warrants, clamped at 1', () => {
        // 100 residents / 40 per doctor → 3 needed. 2 practicing → 2/3; 5 practicing → clamped 1.
        const partial = computeCoverage(inputs({ providersByService: { healthcare: 2 }, facilitiesByService: { healthcare: 1 } }))
            .find(line => line.service === 'healthcare')!;
        expect(partial.needed).toBe(3);
        expect(partial.ratio).toBeCloseTo(2 / 3, 10);
        const full = computeCoverage(inputs({ providersByService: { healthcare: 5 }, facilitiesByService: { healthcare: 1 } }))
            .find(line => line.service === 'healthcare')!;
        expect(full.ratio).toBe(1);
    });

    test('education is seat-based: seats vs the enrollable band; no children reads fully covered', () => {
        const short = computeCoverage(inputs({ facilitiesByService: { education: 1 }, schoolSeats: 12, schoolAgeChildren: 20 }))
            .find(line => line.service === 'education')!;
        expect(short.ratio).toBeCloseTo(0.6, 10);
        expect(short.needed).toBe(20);
        const empty = computeCoverage(inputs({ schoolSeats: 0, schoolAgeChildren: 0 }))
            .find(line => line.service === 'education')!;
        expect(empty.ratio).toBe(1);
        // Children with no school at all → 0, even if a seats number leaked in.
        const noSchool = computeCoverage(inputs({ schoolSeats: 10, schoolAgeChildren: 5 }))
            .find(line => line.service === 'education')!;
        expect(noSchool.ratio).toBe(0);
    });

    test('undeclared-yet services (garbage, jail) honestly read 0 — the dashboard names the gap', () => {
        const lines = computeCoverage(inputs());
        expect(lines.find(line => line.service === 'garbage')!.ratio).toBe(0);
        expect(lines.find(line => line.service === 'jail')!.ratio).toBe(0);
    });
});

describe('the reader', () => {
    test('unmeasured reads neutral for everything; after a sweep it reads the ratios (unknown service 0)', () => {
        const services = new CityServices();
        expect(services.coverageOf('healthcare')).toBe(SERVICES_CONFIG.neutralCoverage);
        expect(services.coverageOf('nonsense')).toBe(SERVICES_CONFIG.neutralCoverage);
        expect(services.latest()).toEqual([]);

        services.update(inputs({ providersByService: { healthcare: 3 }, facilitiesByService: { healthcare: 1 } }));
        expect(services.coverageOf('healthcare')).toBe(1);
        expect(services.coverageOf('police')).toBe(0);
        expect(services.coverageOf('nonsense')).toBe(0);
        expect(services.latest().length).toBe(Object.keys(SERVICES_CONFIG.services).length);
    });
});

describe('config ↔ factor-curve contract', () => {
    test('the neutral coverage sits inside the factor curves’ ×1 band (no ledger, no effect)', () => {
        // The recovery factor steps: <0.4 → 0.75, [0.4, 0.8) → 1, ≥0.8 → 1.4 (json/events.json). The
        // neutral level MUST land in the ×1 band or every unmeasured context would drift.
        expect(SERVICES_CONFIG.neutralCoverage).toBeGreaterThanOrEqual(0.4);
        expect(SERVICES_CONFIG.neutralCoverage).toBeLessThan(0.8);
    });
});

describe('the nagbar plumbing (task 114)', () => {
    test('the daily sweep publishes servicesChanged with exactly the ledger lines the dashboard shows', () => {
        const rows = 40;
        const cols = 40;
        const emitted: { name: string; payload: unknown }[] = [];
        const game = {
            field: null,
            population: new Population(),
            clock: new Clock(),
            economy: new Economy(),
            gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
            pixelToTilePosition: (pixel: PixelPosition) => {
                if (pixel === null) {
                    return null;
                }
                const row = Math.floor(pixel.y / 16);
                const col = Math.floor(pixel.x / 16);
                return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
            },
            emit: (name: string, payload: unknown) => emitted.push({ name, payload }),
            emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, rows, cols);
        (game as unknown as { field: Field }).field = field;
        const city = new City(game);

        city.recomputeServices(24);
        const events = emitted.filter(event => event.name === 'servicesChanged');
        expect(events).toHaveLength(1);
        const payload = events[0]!.payload as ServiceCoverage[];
        // The nagbar derives from EXACTLY what the ledger holds — the same lines the city dashboard shows.
        expect(payload.length).toBe(Object.keys(SERVICES_CONFIG.services).length);
        expect(payload).toEqual(city.getCityStats().services);
    });
});

// Squalor (LP-8 / proposal simulation-aliveness-2 P1-2): the outcome reading beside the staffing ratios —
// garbage that actually sits uncollected, scaled per resident, feeding the fell_ill factor and the
// cleaning weights. The audit's founding example: 95 curb bags with zero consequence.
describe('squalor (LP-8)', () => {
    test('computeSqualor scales with uncollected bags per resident and clamps to [0, 1]', () => {
        expect(computeSqualor(0, 30)).toBe(0);
        expect(computeSqualor(45, 30)).toBeCloseTo(0.5); // 1.5 bags/resident at saturation 3
        expect(computeSqualor(900, 30)).toBe(1);
        expect(computeSqualor(10, 0)).toBe(0); // empty town: no reading
    });

    test('the reader publishes the sweep measurement; unmeasured reads clean', () => {
        const services = new CityServices();
        expect(services.squalorOf()).toBe(0);
        services.update({ population: 30, providersByService: {}, facilitiesByService: {}, schoolSeats: 0, schoolAgeChildren: 0, curbBags: 90 });
        expect(services.squalorOf()).toBeCloseTo(1);
        services.update({ population: 30, providersByService: {}, facilitiesByService: {}, schoolSeats: 0, schoolAgeChildren: 0, curbBags: 0 });
        expect(services.squalorOf()).toBe(0);
    });
});
