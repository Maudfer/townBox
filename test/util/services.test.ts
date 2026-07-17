import { SERVICES_CONFIG } from 'game/economy/CityServices';
import { ServiceCoverage } from 'types/Services';
import { computeServiceWarnings, warningsKey } from 'util/services';

// The nagbar's pure logic (task 114): threshold crossing decides visibility, the authored copy rides
// along, and the dismissal key is per-service-SET — a new degrading service re-arms a dismissed banner.

function line(service: string, ratio: number): ServiceCoverage {
    return { service, label: SERVICES_CONFIG.services[service]?.label ?? service, providers: 0, facilities: 0, needed: 1, ratio };
}

describe('computeServiceWarnings', () => {
    test('only lines below the advisory threshold warn, worst first, carrying the authored copy', () => {
        const below = SERVICES_CONFIG.advisoryBelow;
        const warnings = computeServiceWarnings([
            line('healthcare', below - 0.05),
            line('police', 1),
            line('fire', 0),
        ], SERVICES_CONFIG);
        expect(warnings.map(warning => warning.service)).toEqual(['fire', 'healthcare']); // worst first
        expect(warnings[0]!.warning).toBe(SERVICES_CONFIG.services['fire']!.warning);
        expect(warnings[0]!.warning.length).toBeGreaterThan(0);
    });

    test('crossing the threshold clears the warning', () => {
        const below = SERVICES_CONFIG.advisoryBelow;
        expect(computeServiceWarnings([line('healthcare', below - 0.01)], SERVICES_CONFIG)).toHaveLength(1);
        expect(computeServiceWarnings([line('healthcare', below)], SERVICES_CONFIG)).toHaveLength(0);
        expect(computeServiceWarnings([line('healthcare', below + 0.2)], SERVICES_CONFIG)).toHaveLength(0);
    });

    test('an unauthored service still gets a readable fallback line', () => {
        const warnings = computeServiceWarnings([{ service: 'plumbing', label: 'Plumbing', providers: 0, facilities: 0, needed: 1, ratio: 0 }], SERVICES_CONFIG);
        expect(warnings[0]!.warning).toMatch(/Plumbing/);
    });
});

describe('warningsKey (the per-set dismissal contract)', () => {
    test('the key is stable across order and ratio changes, and changes when the SET changes', () => {
        const fireAndPolice = computeServiceWarnings([line('fire', 0), line('police', 0.1)], SERVICES_CONFIG);
        const policeAndFire = computeServiceWarnings([line('police', 0.05), line('fire', 0.2)], SERVICES_CONFIG);
        expect(warningsKey(fireAndPolice)).toBe(warningsKey(policeAndFire)); // same set → same key (stays dismissed)

        const plusGarbage = computeServiceWarnings([line('fire', 0), line('police', 0.1), line('garbage', 0)], SERVICES_CONFIG);
        expect(warningsKey(plusGarbage)).not.toBe(warningsKey(fireAndPolice)); // a NEW degrading service re-arms
        expect(warningsKey([])).toBe('');
    });
});
