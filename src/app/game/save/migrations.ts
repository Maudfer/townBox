// Save-snapshot migrations (task 040). Loads pass the parsed snapshot through migrateSnapshot() before
// applying it; each migration is a pure in-place upgrade from one version to the next, so old saves keep
// loading as the format evolves. Keep migrations dumb and mechanical — anything smarter belongs in the
// systems that consume the data.

import { WorldSnapshot } from 'types/Save';
import { EventLogTable } from 'types/LifeEvent';
import { JobTable } from 'types/Business';
import { TICKS_PER_DAY } from 'util/time';

import jobsConfig from 'json/jobs.json';

const JOBS = jobsConfig as unknown as JobTable;

export function migrateSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
    if (snapshot.version < 8) {
        migrateDayTicksToHourTicks(snapshot);
        synthesizeEventLog(snapshot);
        snapshot.version = 8;
    }
    if (snapshot.version < 9) {
        // v8 → v9 (task 058): school assignments are a new, additive optional section. Nothing to
        // transform — older saves load with no assignments and the daily sweep enrolls eligible children.
        snapshot.version = 9;
    }
    if (snapshot.version < 10) {
        // v9 → v10 (tasks 059-062): skills moved to the central SkillBook. The transform is intentionally
        // NOT here (migrations stay dumb): SaveManager.deserialize re-initializes each loaded person
        // deterministically and applies the legacy mapping (save/legacySkills.ts) when `skillBook` is absent.
        snapshot.version = 10;
    }
    if (snapshot.version < 11) {
        defaultJobRanks(snapshot);
        snapshot.version = 11;
    }
    if (snapshot.version < 12) {
        // v11 → v12 (task 070): `objectsGenerated` is additive; absent reads as false and the SaveManager
        // load sweep runs the contextual fill once per building. Nothing to transform here.
        snapshot.version = 12;
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

// v7 → v8: pre-log saves only carried the aggregate history ({count, lastTick} per event id). Synthesize a
// minimal append-only log from it: ONE entry per (person, event id), dated at lastTick, source 'system',
// no roles/causation. Deliberately lossy (the true per-occurrence dates are gone; the aggregate keeps the
// real count) — documented in 038 §3.3. Seq assignment is deterministic: sorted person ids, then event ids.
function synthesizeEventLog(snapshot: WorldSnapshot): void {
    if (snapshot.eventLog || !snapshot.eventHistory) {
        return;
    }
    const log: EventLogTable = {};
    let seq = 0;
    for (const personId of Object.keys(snapshot.eventHistory).sort()) {
        const history = snapshot.eventHistory[personId]!;
        for (const eventId of Object.keys(history).sort()) {
            const record = history[eventId]!;
            const entries = log[personId] ?? [];
            entries.push({ seq: seq++, tick: record.lastTick, kind: 'event', defId: eventId, roles: { subject: personId }, triggerSource: 'system', causationId: null });
            log[personId] = entries;
        }
    }
    snapshot.eventLog = log;
    snapshot.eventLogSeq = seq;
}

// v10 → v11 (task 064): existing employees default to their job's ENTRY rank with zeroed work-day counters.
// Jobs are matched by title (the same convention City.jobOf uses); positions with no jobs.json ladder
// (fixtures/legacy custom titles) stay rank-less and fall back to boolean matching.
function defaultJobRanks(snapshot: WorldSnapshot): void {
    for (const personSnapshot of snapshot.people ?? []) {
        const job = personSnapshot.job;
        if (!job || job.rankId) {
            continue;
        }
        const definition = Object.values(JOBS).find(candidate => candidate.title === job.title);
        const entry = definition?.ranks.find(rank => rank.entry);
        if (entry) {
            job.rankId = entry.rankId;
            job.workDaysInRank = 0;
            job.totalWorkDays = 0;
        }
    }
}
