// Save-snapshot migrations (task 040). Loads pass the parsed snapshot through migrateSnapshot() before
// applying it; each migration is a pure in-place upgrade from one version to the next, so old saves keep
// loading as the format evolves. Keep migrations dumb and mechanical — anything smarter belongs in the
// systems that consume the data.

import { WorldSnapshot } from 'types/Save';
import { TICKS_PER_DAY } from 'util/time';

export function migrateSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
    if (snapshot.version < 8) {
        migrateDayTicksToHourTicks(snapshot);
        snapshot.version = 8;
    }
    return snapshot;
}

// v7 → v8: the canonical simulation tick changed from the in-game day to the in-game hour (task 040).
// Every persisted tick value scales by 24. The clock's elapsedMs is the time source itself (scale-free),
// and month indexes (economy.lastEconomyMonth) / year indexes (population.lastSimulatedYear) keep their
// own units, so neither migrates.
function migrateDayTicksToHourTicks(snapshot: WorldSnapshot): void {
    const scale = TICKS_PER_DAY;

    for (const person of Object.values(snapshot.population?.people ?? {})) {
        person.birthTick *= scale;
        if (person.deathTick !== null) {
            person.deathTick *= scale;
        }
        for (const partnership of person.partnerships) {
            partnership.startTick *= scale;
            if (partnership.endTick !== null) {
                partnership.endTick *= scale;
            }
        }
    }

    for (const personSnapshot of snapshot.people ?? []) {
        if (personSnapshot.birthTick !== null) {
            personSnapshot.birthTick *= scale;
        }
    }

    for (const history of Object.values(snapshot.eventHistory ?? {})) {
        for (const record of Object.values(history)) {
            record.lastTick *= scale;
        }
    }
}
