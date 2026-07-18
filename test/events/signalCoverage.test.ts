import eventsConfig from 'json/events.json';
import { EventManifest } from 'types/LifeEvent';

// The signal-coverage guard (LP-6 / task 122 requirement 3). The 052 manifest regeneration silently severed
// the movedOut producer while City.handleTick's consumer switch kept waiting — live move-out was dead for
// six task-numbers before the 121 sweep noticed. Every signal the City consumes must be emitted by at least
// one manifest event, so the next regeneration cannot orphan a consumer again.
//
// Keep this list in sync with the `signal.signal === '...'` switch in City.handleTick's onCommitted block.
const CITY_CONSUMED_SIGNALS = ['partnershipFormed', 'movedOut', 'crimeCommitted', 'chaseConcluded', 'petAdopted'];

describe('signal coverage (task 122 guard)', () => {
    const manifest = eventsConfig as unknown as EventManifest;

    test.each(CITY_CONSUMED_SIGNALS)('some manifest event emits %s', signal => {
        const producers = Object.entries(manifest).filter(([, def]) =>
            (def.effects ?? []).some(effect => effect.type === 'emit' && (effect as { signal?: string }).signal === signal));
        expect(producers.length).toBeGreaterThanOrEqual(1);
    });
});

// The LP-7 quirk budget (proposal P1-4): free-rolling whimsy is a DECISION, not a leak. Every ungated
// probabilistic texture event must carry the quirk marker, and the pool's aggregate hazard stays under
// one quirk per person per week — the audit measured one incoherent texture event every ~2 days.
describe('the texture quirk budget (LP-7)', () => {
    const manifest = eventsConfig as unknown as EventManifest;
    const GATE_ATTRS = /(marital|employed|hasEvent|health|money|retired|petCount|foodLevel|restLevel|squalor|hasMinorChild|hasGrandchildren|depressed|mood|pregnant|homeless)/;
    // Wired-by-gate designs whose classifier disposition reads texture (effect-free by design).
    const EXEMPT = new Set(['went_hungry', 'utterly_exhausted', 'sick_of_the_filth', 'had_sex', 'application_rejected']);

    function isUngatedFreeRoller(def: { roles?: { subject?: { where?: unknown }; partner?: unknown }; triggers?: { probabilistic?: { perYear?: number } }; effects?: unknown[] }): boolean {
        if (!def.triggers?.probabilistic || (def.effects ?? []).length > 0) {
            return false;
        }
        const predicate = JSON.stringify(def.roles?.subject?.where ?? {});
        return !GATE_ATTRS.test(predicate) && !def.roles?.partner && Object.keys(def.roles ?? {}).length <= 1;
    }

    test('every ungated free-rolling texture event is a marked quirk, and the pool stays under budget', () => {
        let aggregate = 0;
        const unmarked: string[] = [];
        for (const [id, def] of Object.entries(manifest)) {
            if (EXEMPT.has(id) || !isUngatedFreeRoller(def as never)) {
                continue;
            }
            aggregate += (def as { triggers?: { probabilistic?: { perYear?: number } } }).triggers?.probabilistic?.perYear ?? 0;
            if ((def as { quirk?: boolean }).quirk !== true) {
                unmarked.push(id);
            }
        }
        expect(unmarked).toEqual([]);
        expect(aggregate).toBeLessThanOrEqual(60); // ≈ one quirk per person per ~6+ days
    });
});
