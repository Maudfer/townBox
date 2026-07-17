import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import Economy from 'game/economy/Economy';
import { generateBusiness } from 'game/economy/BusinessGen';
import JobMarket from 'game/economy/JobMarket';
import GameManager from 'game/GameManager';
import SkillBook from 'game/skills/SkillBook';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Person from 'game/agents/Person';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import retconsConfig from 'json/retcons.json';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { PopulationState, GenPerson, PersonId } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { RetconConfig } from 'types/Retcon';
import { Genders } from 'types/Social';
import { SeededRandom, hashStringToSeed } from 'util/random';

// Career retcons at hydration (task 098 / proposal I4): a town with an UNSTAFFED clinic may inject a
// plausible nursing-school chapter into a bounded fraction of household draws — a real committed event at a
// PAST tick, dependency-valid skill grants through the normal SkillRegistry path, and the person becomes
// genuinely hireable for the gap. Nothing is overwritten; deterministic per (worldSeed, house anchor).

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;
const RETCONS = retconsConfig as unknown as RetconConfig;
const WORLD_SEED = 5;

// The per-household roll is deterministic — pick house keys whose roll lands / misses, so the tests assert
// exact behavior instead of trusting luck.
function retconRoll(houseKey: string): boolean {
    return new SeededRandom((WORLD_SEED ^ hashStringToSeed(`retcon#${houseKey}`)) >>> 0).next() < RETCONS.chancePerHousehold;
}
function findHouseKey(shouldRoll: boolean): string {
    for (let index = 0; index < 500; index++) {
        const key = `${index}-${index}`;
        if (retconRoll(key) === shouldRoll) {
            return key;
        }
    }
    throw new Error('no house key found');
}
const LUCKY_HOUSE = findHouseKey(true);
const UNLUCKY_HOUSE = findHouseKey(false);

function gen(id: string, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame() {
    const rows = 40;
    const cols = 40;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const skillBook = new SkillBook();
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        skillBook,
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
        emit: () => {},
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    return { game, field, population, clock, economy, city, skillBook, eventEngine };
}

// A town with an operating clinic (facility present, zero practicing staff) and one drawn household.
function clinicTown(memberAges: number[]) {
    const world = makeGame();
    const people: Record<string, GenPerson> = {};
    const memberIds: PersonId[] = [];
    memberAges.forEach((age, index) => {
        const id = `m${index}`;
        people[id] = gen(id, age);
        memberIds.push(id);
    });
    const state: PopulationState = { worldSeed: WORLD_SEED, people, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.population.loadState(state);
    world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
    memberIds.forEach((id, index) => {
        const person: Person = world.field.loadPerson(100 + index * 5, 100);
        person.social.setPersonId(id);
    });
    const clinic = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
    clinic.setBusiness(generateBusiness('clinic', BLUEPRINTS['clinic']!, JOBS, 'Test Clinic', 2));
    return { ...world, memberIds, clinic };
}

describe('the retcon path', () => {
    test('an unstaffed clinic + a lucky draw → one member gains nursing school at 24, and is now hireable', () => {
        const town = clinicTown([32, 30, 8]);
        town.city.applyCareerRetcon(LUCKY_HOUSE, town.memberIds, TICK_NOW, TPY);

        const retconned = town.memberIds.filter(id =>
            town.eventEngine.getPersonLog(id).some(entry => entry.kind === 'event' && entry.defId === 'nursing_school'));
        expect(retconned).toHaveLength(1); // at most one per household — and the child was never a candidate
        const [nurseId] = retconned;
        expect(nurseId).not.toBe('m2');

        const log = town.eventEngine.getPersonLog(nurseId!);
        const chapter = log.find(entry => entry.kind === 'event' && entry.defId === 'nursing_school')!;
        // The chapter happened in their PAST, at the authored age, via the system source.
        expect(chapter.tick).toBe(town.population.getPerson(nurseId!)!.birthTick + RETCONS.templates['healthcare']!.atAgeYears * TPY);
        expect(chapter.tick).toBeLessThan(TICK_NOW);
        expect(chapter.triggerSource).toBe('system');
        // The grants are real, dependency-valid proficiency — the JobMarket can staff the clinic with them.
        expect(town.skillBook.proficiency(nurseId!, 'measure_vital_signs')).toBeGreaterThanOrEqual(30);
        expect(town.skillBook.proficiency(nurseId!, 'administer_medication')).toBeGreaterThanOrEqual(30);
        const market = new JobMarket(new Map(), town.field, town.skillBook, TICK_NOW);
        expect(market.strictlyQualifiesFor(nurseId!, 'nurse')).toBe(true);
    });

    test('no facility, no retcon — a nurse with nowhere to practice helps nobody', () => {
        const world = makeGame();
        const people = { m0: gen('m0', 32) };
        world.population.loadState({ worldSeed: WORLD_SEED, people, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('m0');
        world.city.applyCareerRetcon(LUCKY_HOUSE, ['m0'], TICK_NOW, TPY);
        expect(world.eventEngine.getPersonLog('m0')).toHaveLength(0);
    });

    test('the bounded fraction: an unlucky house key draws exactly as recorded', () => {
        const town = clinicTown([32, 30]);
        town.city.applyCareerRetcon(UNLUCKY_HOUSE, town.memberIds, TICK_NOW, TPY);
        for (const id of town.memberIds) {
            expect(town.eventEngine.getPersonLog(id)).toHaveLength(0);
        }
    });

    test('someone already holding the skills is never re-schooled', () => {
        const town = clinicTown([32]);
        town.skillBook.grantWithPrerequisites('m0', 'measure_vital_signs', 40, TICK_NOW, 'test');
        town.skillBook.grantWithPrerequisites('m0', 'administer_medication', 40, TICK_NOW, 'test');
        town.city.applyCareerRetcon(LUCKY_HOUSE, town.memberIds, TICK_NOW, TPY);
        expect(town.eventEngine.getPersonLog('m0').some(entry => entry.kind === 'event' && entry.defId === 'nursing_school')).toBe(false);
    });

    test('out-of-band ages are never candidates', () => {
        const town = clinicTown([8, 70]);
        town.city.applyCareerRetcon(LUCKY_HOUSE, town.memberIds, TICK_NOW, TPY);
        for (const id of town.memberIds) {
            expect(town.eventEngine.getPersonLog(id)).toHaveLength(0);
        }
    });
});
