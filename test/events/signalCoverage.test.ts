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
