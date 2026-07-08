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

import { SeededRandom } from 'util/random';

import { PopulationState, PersonId, GenPerson } from 'types/Genealogy';
import { EventHistoryTable, EventLogTable, PersonLogEntry } from 'types/LifeEvent';
import { Genders } from 'types/Social';
import { SkillBookState, PersonSkills } from 'types/Skill';
import { InventoryState, ObjectInstance, ObjectContainerRef } from 'types/Objects';

import { HistoryAsset, HISTORY_ASSET_FORMAT_VERSION } from 'game/HistoryAsset';

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
export function validateAsset(asset: HistoryAsset): AssetValidation {
    if (!asset.meta || asset.meta.formatVersion !== HISTORY_ASSET_FORMAT_VERSION) {
        return { ok: false, reason: 'formatVersion' };
    }
    return { ok: true };
}

// Picks the present tick w. Deterministic per gameSeed. Clamps to endTick when the asset is too short to
// afford the warm-margin (tiny fixtures/draft runs), so selection always yields a valid window.
export function pickWindow(asset: HistoryAsset, gameSeed: number): number {
    const { epochTick, endTick, ticksPerYear, params } = asset.meta;
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

    // Lived skills + carried possessions (task 077): keep only the retained cohort and rebase timestamps by −w.
    // NOTE: skills/possessions are an end-of-generation SNAPSHOT, so the living cohort carries proficiency
    // reflecting their whole simulated life (basics cap at 60 by 18 so they're age-correct; job skills may read
    // as more experienced than the windowed age — an accepted over-fidelity, documented as a §9 follow-up:
    // per-window skill snapshotting). Because the loaded SkillBook marks these people `initialized`,
    // City.setupHousehold's initialize() no-ops for them, preserving these skills.
    if (asset.skillBook) {
        const records: Record<PersonId, PersonSkills> = {};
        const initialized: Record<PersonId, true> = {};
        for (const id of Object.keys(people)) {
            const personSkills = asset.skillBook.records[id];
            if (personSkills) {
                const rebasedSkills: PersonSkills = {};
                for (const [skillId, record] of Object.entries(personSkills)) {
                    rebasedSkills[skillId] = { ...record, firstAcquiredTick: record.firstAcquiredTick - w, lastProgressedTick: record.lastProgressedTick - w };
                }
                records[id] = rebasedSkills;
            }
            if (asset.skillBook.initialized[id]) {
                initialized[id] = true;
            }
        }
        result.skillBook = { records, initialized };
    }
    if (asset.objects) {
        result.objects = sliceObjects(asset.objects, new Set(Object.keys(people)), w);
    }

    return result;
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
    const window = pickWindow(asset, gameSeed);
    const sliced = sliceAndRebase(asset, window);
    reidentify(sliced.population, gameSeed);
    return { ...sliced, window };
}
