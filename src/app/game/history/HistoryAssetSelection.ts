// Asset-fed new game (task 055 Part B). A new game does NOT simulate: it SELECTS a slice of the committed
// history asset (game/HistoryAsset.ts) as its starting world. Because the asset is deep and selection is
// windowed + re-identified, the space of distinct starting scenarios is enormous (asset × window × identity
// seed), so a player almost never sees the same story twice.
//
// Three pure steps, all deterministic per (asset, gameSeed):
//   1. Window — pick a "present" tick w uniformly in [epoch + warmMargin, endTick]. w becomes the game's now.
//   2. Slice + rebase — keep everyone with birthTick ≤ w (the living cohort plus their retained ancestors),
//      drop future people, truncate every history/log to events with tick ≤ w, then subtract w from every
//      tick so ages (against tick 0) and event recency read correctly at game start. Anyone whose death is in
//      the asset's future (deathTick > w) is alive now, so their death and post-w history are dropped.
//   3. Re-identify — re-roll names only (lineage-coherent surnames), preserving gender, the kinship graph,
//      ticks, partnerships, and histories, so the same underlying story reads as a different family each game.
//
// Materialization (HouseholdDraw / City.setupHousehold) then works as-is on the sliced pool — drawn residents
// simply arrive with populated event history instead of a cold start, which is the whole point.

import { fakerPT_BR } from '@faker-js/faker';

import { HistoryAsset, HistoryAssetMeta, ShardRef, HISTORY_ASSET_FORMAT_VERSION } from 'game/history/HistoryAsset';
import { PopulationState, PersonId, GenPerson } from 'types/Genealogy';
import { EventHistoryTable, EventLogTable, PersonLogEntry } from 'types/LifeEvent';
import { InventoryState, ObjectInstance, ObjectContainerRef } from 'types/Objects';
import { SkillBookState, PersonSkills, SkillSnapshot , SkillTimeline } from 'types/Skill';
import { Genders } from 'types/Social';
import { decompress } from 'util/compress';
import { SeededRandom } from 'util/random';

export interface SelectedWorld {
    population: PopulationState;
    eventHistory: EventHistoryTable;
    eventLog: EventLogTable;
    eventLogSeq: number;
    // Lived skills + carried possessions (task 077), filtered to the retained cohort with ticks rebased.
    // Present only when the asset carries them (logicalWorld runs). Consumed by GameManager.startNewGameWorld.
    skillBook?: SkillBookState;
    objects?: InventoryState;
    window: number; // the asset-relative present tick w that was selected (for logging/tests)
}

export type AssetValidation = { ok: true } | { ok: false; reason: 'formatVersion' };

// Cheap compatibility gate: the game only consumes assets of its own format version.
export function validateAsset(asset: { meta: HistoryAssetMeta } | HistoryAsset): AssetValidation {
    if (!asset.meta || asset.meta.formatVersion !== HISTORY_ASSET_FORMAT_VERSION) {
        return { ok: false, reason: 'formatVersion' };
    }
    return { ok: true };
}

// Picks the present tick w. Deterministic per gameSeed. Clamps to endTick when the asset is too short to
// afford the warm-margin (tiny fixtures/draft runs), so selection always yields a valid window.
export function pickWindow(meta: HistoryAssetMeta, gameSeed: number): number {
    const { epochTick, endTick, ticksPerYear, params } = meta;
    const low = Math.min(endTick, epochTick + Math.round(params.warmMarginYears * ticksPerYear));
    if (endTick <= low) {
        return endTick;
    }
    const rng = new SeededRandom(gameSeed >>> 0).fork(0x5e1);
    return low + Math.floor(rng.next() * (endTick - low + 1));
}

// Slices the asset at window w and rebases every tick by −w. Pure; does not mutate the asset.
export function sliceAndRebase(asset: HistoryAsset, w: number): Omit<SelectedWorld, 'window'> {
    const source = asset.population.people;
    const people: Record<PersonId, GenPerson> = {};
    let maxSeqSuffix = -1;

    for (const [id, person] of Object.entries(source)) {
        if (person.birthTick > w) {
            continue; // not yet born at the present — drop future people entirely
        }
        const alive = person.deathTick === null || person.deathTick > w;
        const rebased: GenPerson = {
            id: person.id,
            firstName: person.firstName,
            familyName: person.familyName,
            gender: person.gender,
            birthTick: person.birthTick - w,
            // Deaths in the asset's future haven't happened at w → the person is alive now.
            deathTick: alive ? null : person.deathTick! - w,
            fatherId: person.fatherId,
            motherId: person.motherId,
            partnerships: person.partnerships
                .filter(partnership => partnership.startTick <= w) // partnerships not yet formed are dropped
                .map(partnership => ({
                    partnerId: partnership.partnerId,
                    startTick: partnership.startTick - w,
                    // Ongoing-at-w partnerships (endTick in the future) read as ongoing now.
                    endTick: partnership.endTick !== null && partnership.endTick <= w ? partnership.endTick - w : null,
                })),
        };
        people[id] = rebased;
        const suffix = Number.parseInt(id.replace(/^p/, ''), 10);
        if (Number.isFinite(suffix)) {
            maxSeqSuffix = Math.max(maxSeqSuffix, suffix);
        }
    }

    // Slice + rebase the logs to entries at tick ≤ w, keeping only retained people, and rebuild the aggregate
    // history from the truncated log (the log is the source of truth; the aggregate is a derived index).
    const eventLog: EventLogTable = {};
    const eventHistory: EventHistoryTable = {};
    let maxSeq = -1;
    for (const [id, entries] of Object.entries(asset.eventLog)) {
        if (!(id in people)) {
            continue;
        }
        const kept: PersonLogEntry[] = [];
        for (const entry of entries) {
            if (entry.tick > w) {
                continue;
            }
            const rebasedEntry = { ...entry, tick: entry.tick - w } as PersonLogEntry;
            kept.push(rebasedEntry);
            maxSeq = Math.max(maxSeq, entry.seq);
            if (rebasedEntry.kind === 'event') {
                const record = (eventHistory[id] ??= {});
                const existing = record[rebasedEntry.defId];
                if (!existing) {
                    record[rebasedEntry.defId] = { count: 1, lastTick: rebasedEntry.tick };
                } else {
                    existing.count += 1;
                    existing.lastTick = Math.max(existing.lastTick, rebasedEntry.tick);
                }
            }
        }
        if (kept.length > 0) {
            eventLog[id] = kept;
        }
    }

    const population: PopulationState = {
        worldSeed: asset.population.worldSeed,
        people,
        drawSeed: asset.population.drawSeed,
        placedIds: [],
        nextSeq: maxSeqSuffix + 1,
        lastSimulatedYear: 0,
    };

    const result: Omit<SelectedWorld, 'window'> = { population, eventHistory, eventLog, eventLogSeq: maxSeq + 1 };

    // Lived skills (task 077 per-window snapshotting): for each retained person, install the snapshot taken AS
    // OF the window — the latest with tick <= w — so a windowed person's proficiency matches their windowed age
    // rather than an end-of-life snapshot. A person with NO snapshot <= w (born after the last snapshot before
    // w, e.g. a young child) is simply left out, so City.setupHousehold's age-appropriate initialize() runs for
    // them. Installing the SkillBook marks the rest `initialized`, so initialize() no-ops and their real skills
    // survive. Ticks rebased by −w. Possessions kept only for the retained cohort, ticks rebased.
    if (asset.skillTimeline) {
        const records: Record<PersonId, PersonSkills> = {};
        const initialized: Record<PersonId, true> = {};
        for (const id of Object.keys(people)) {
            const snapshot = latestSnapshotAt(asset.skillTimeline[id], w);
            if (!snapshot) {
                continue; // no snapshot as of w → live init handles this person (age-appropriate)
            }
            const rebasedSkills: PersonSkills = {};
            for (const [skillId, record] of Object.entries(snapshot.skills)) {
                rebasedSkills[skillId] = { ...record, firstAcquiredTick: record.firstAcquiredTick - w, lastProgressedTick: record.lastProgressedTick - w };
            }
            records[id] = rebasedSkills;
            initialized[id] = true;
        }
        result.skillBook = { records, initialized };
    }
    if (asset.objects) {
        result.objects = sliceObjects(asset.objects, new Set(Object.keys(people)), w);
    }

    return result;
}

// The latest snapshot with tick <= w (timeline is ascending by tick), or null if none.
function latestSnapshotAt(timeline: SkillSnapshot[] | undefined, w: number): SkillSnapshot | null {
    if (!timeline || timeline.length === 0) {
        return null;
    }
    let chosen: SkillSnapshot | null = null;
    for (const snapshot of timeline) {
        if (snapshot.tick <= w) {
            chosen = snapshot;
        } else {
            break;
        }
    }
    return chosen;
}

// Keeps only object instances (transitively) carried by a retained person, rebasing createdAtTick by −w.
function sliceObjects(objects: InventoryState, keptPeople: Set<PersonId>, w: number): InventoryState {
    const instances = objects.instances;
    const rootsAtKept = (start: ObjectInstance): boolean => {
        const seen = new Set<string>();
        let current: ObjectInstance | undefined = start;
        while (current) {
            const container: ObjectContainerRef = current.container;
            if (container.kind === 'possessions') {
                return keptPeople.has(container.personId);
            }
            if (container.kind === 'object') {
                if (seen.has(container.instanceId)) {
                    return false;
                }
                seen.add(container.instanceId);
                current = instances[container.instanceId];
                continue;
            }
            return false;
        }
        return false;
    };
    const kept: InventoryState['instances'] = {};
    for (const [id, instance] of Object.entries(instances)) {
        if (rootsAtKept(instance)) {
            kept[id] = { ...instance, createdAtTick: instance.createdAtTick - w };
        }
    }
    return { instances: kept, nextInstanceSeq: objects.nextInstanceSeq };
}

// Re-rolls names only (mutates the given population in place). Surnames are lineage-coherent: a person
// inherits their father's re-rolled surname, matching how generation assigns family names — so surnames stay
// consistent within a bloodline while the whole story reads as a different family. Deterministic per gameSeed.
export function reidentify(population: PopulationState, gameSeed: number): void {
    fakerPT_BR.seed(gameSeed >>> 0);
    const people = population.people;
    const surnameOf = new Map<PersonId, string>();

    // Resolve a person's re-rolled surname, memoized, walking up the father line. A missing/pruned father is a
    // line founder → a fresh surname. Guard against cycles (never expected in a DAG) with a visiting set.
    const resolveSurname = (id: PersonId, visiting: Set<PersonId>): string => {
        const cached = surnameOf.get(id);
        if (cached !== undefined) {
            return cached;
        }
        const person = people[id];
        let surname: string;
        if (person && person.fatherId && people[person.fatherId] && !visiting.has(person.fatherId)) {
            visiting.add(id);
            surname = resolveSurname(person.fatherId, visiting);
        } else {
            surname = fakerPT_BR.person.lastName();
        }
        surnameOf.set(id, surname);
        return surname;
    };

    for (const id of Object.keys(people).sort((a, b) => a.localeCompare(b))) {
        const person = people[id]!;
        person.firstName = fakerPT_BR.person.firstName(person.gender === Genders.Male ? Genders.Male : Genders.Female);
        person.familyName = resolveSurname(id, new Set());
    }
}

// The full Part B pipeline: validate → window → slice + rebase → re-identify. Returns null when the asset is
// incompatible (the caller falls back to a cold-start pool, §3.7).
export function selectStartingWorld(asset: HistoryAsset, gameSeed: number): SelectedWorld | null {
    if (!validateAsset(asset).ok) {
        return null;
    }
    const window = pickWindow(asset.meta, gameSeed);
    const sliced = sliceAndRebase(asset, window);
    reidentify(sliced.population, gameSeed);
    return { ...sliced, window };
}

// --- Sharded / chunked loading (task 077 streaming) -------------------------------------------------------
//
// A streamed asset is a directory: a small header (below) + compressed section files (population/objects/
// eventHistory) + `log-*`/`skills-*` shards. Selection at window `w` reads only the shards whose range starts
// at/before `w` — future shards are never fetched — so both the generator (writing) and the game (loading)
// stay memory-bounded regardless of how long the history is. `read` maps a shard/section file name to its
// compressed payload (Node fs in tests; a bundled fetch in the browser).

export interface AssetHeader {
    meta: HistoryAssetMeta;
    eventLogSeq: number;
    sections: { population: string; objects: string; eventHistory: string };
    logShards: ShardRef[];
    skillShards: ShardRef[];
}

function decodeSection<T>(payload: string): T {
    return JSON.parse(decompress(payload)) as T;
}

// The full sharded Part B pipeline: pick w, read only the ≤ w shards, assemble, slice/rebase/re-identify.
export function selectStartingWorldFromShards(header: AssetHeader, read: (file: string) => string, gameSeed: number): SelectedWorld | null {
    if (!validateAsset({ meta: header.meta }).ok) {
        return null;
    }
    const w = pickWindow(header.meta, gameSeed);

    // Merge only the log shards that can hold entries at/before w (minTick <= w). Entries after w are
    // truncated by sliceAndRebase; shards entirely after w are never read.
    const eventLog: EventLogTable = {};
    for (const shard of header.logShards) {
        if (shard.minTick > w) {
            continue;
        }
        const table = decodeSection<EventLogTable>(read(shard.file));
        for (const [id, entries] of Object.entries(table)) {
            (eventLog[id] ??= []).push(...entries);
        }
    }
    const skillTimeline: SkillTimeline = {};
    for (const shard of header.skillShards) {
        if (shard.minTick > w) {
            continue;
        }
        const timeline = decodeSection<SkillTimeline>(read(shard.file));
        for (const [id, snapshots] of Object.entries(timeline)) {
            (skillTimeline[id] ??= []).push(...snapshots);
        }
    }

    const asset: HistoryAsset = {
        meta: header.meta,
        population: decodeSection<PopulationState>(read(header.sections.population)),
        objects: decodeSection<InventoryState>(read(header.sections.objects)),
        eventHistory: {}, // rebuilt from the windowed log by sliceAndRebase
        eventLog,
        eventLogSeq: header.eventLogSeq,
        eventSchedule: { queue: [], nextScheduleSeq: 0 },
        skillTimeline,
    };
    const sliced = sliceAndRebase(asset, w);
    reidentify(sliced.population, gameSeed);
    return { ...sliced, window: w };
}
