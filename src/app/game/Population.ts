import { fakerPT_BR } from '@faker-js/faker';

import { SeededRandom } from 'util/random';
import { isAliveAt } from 'util/kinship';

import { selectHousehold, HouseholdSelection } from 'game/HouseholdDraw';

import { Genders, Gender } from 'types/Social';
import { GenPerson, PersonId, PersonTable, PopulationState, PopulationParams } from 'types/Genealogy';

import populationConfig from 'json/population.json';

export const DEFAULT_POPULATION_PARAMS: PopulationParams = populationConfig as PopulationParams;

// The present epoch. Ages are derived against the clock's current tick at runtime; generation anchors "now"
// at tick 0 so ancestors have negative birthTicks and the living cohort straddles it.
const PRESENT_TICK = 0;

interface Couple {
    maleId: PersonId;
    femaleId: PersonId;
}

// generatePopulation is a pure function of (seed, params): the same inputs always yield a byte-identical
// PopulationState. It forward-simulates several generations of intertwined family trees — founders pair and
// have children, those children pair (across family lines, giving cross-household genealogy) and have their
// own children, and lifespans are sampled so older generations are mostly deceased. The result is a flat,
// serializable table of people: a large pool of dead ancestors plus a living cohort to draw households from.
export function generatePopulation(seed: number, params: PopulationParams): PopulationState {
    const rng = new SeededRandom(seed);
    // faker shares the structural seed so generated names are reproducible alongside the graph.
    fakerPT_BR.seed(seed);

    const people: PersonTable = {};
    let counter = 0;

    const yearsToTicks = (years: number): number => Math.round(years * params.ticksPerYear);
    const ageGapYears = (a: GenPerson, b: GenPerson): number => Math.abs(a.birthTick - b.birthTick) / params.ticksPerYear;
    const atCap = (): boolean => counter >= params.maxPopulation;

    function createPerson(gender: Gender, birthTick: number, fatherId: PersonId | null, motherId: PersonId | null, familyName: string): GenPerson {
        const id = `p${counter++}`;
        const person: GenPerson = {
            id,
            firstName: fakerPT_BR.person.firstName(gender),
            familyName,
            gender,
            birthTick,
            deathTick: null,
            fatherId,
            motherId,
            partnerships: [],
        };
        people[id] = person;
        return person;
    }

    // Samples a lifespan and marks the person dead if they would have died on or before the present.
    function assignLifespanDeath(person: GenPerson): void {
        // Triangular distribution centred on the mean, within ±spread.
        const lifespanYears = Math.max(1, params.lifespanMeanYears + (rng.next() + rng.next() - 1) * params.lifespanSpreadYears);
        const deathCandidate = person.birthTick + yearsToTicks(lifespanYears);
        if (deathCandidate <= PRESENT_TICK) {
            person.deathTick = deathCandidate;
        }
    }

    function sampleChildCount(): number {
        const weights = params.childDistribution;
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = rng.next() * total;
        for (let i = 0; i < weights.length; i++) {
            roll -= weights[i]!;
            if (roll < 0) {
                return i;
            }
        }
        return weights.length - 1;
    }

    function shareParent(a: GenPerson, b: GenPerson): boolean {
        return (
            (a.fatherId !== null && a.fatherId === b.fatherId) ||
            (a.motherId !== null && a.motherId === b.motherId)
        );
    }

    function shuffle<T>(items: T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = rng.nextInt(0, i);
            const swap = copy[i]!;
            copy[i] = copy[j]!;
            copy[j] = swap;
        }
        return copy;
    }

    // Records a (coherent) marriage between two people, ending it at the first spouse's death if applicable.
    function marry(a: GenPerson, b: GenPerson, startTick: number): void {
        const deaths = [a.deathTick, b.deathTick].filter((d): d is number => d !== null);
        let endTick: number | null = deaths.length ? Math.min(...deaths) : null;
        if (endTick !== null && endTick <= startTick) {
            endTick = startTick; // degenerate, but keep the invariant endTick >= startTick
        }
        a.partnerships.push({ partnerId: b.id, startTick, endTick });
        b.partnerships.push({ partnerId: a.id, startTick, endTick });
    }

    // A plausible marriage tick for a pair: the older partner reaches adulthood. Null if either is already
    // dead by then (so we never marry the deceased).
    function marriageTick(a: GenPerson, b: GenPerson): number | null {
        const tick = Math.max(a.birthTick, b.birthTick) + yearsToTicks(rng.nextInt(params.parentMinAgeYears, params.parentMinAgeYears + 6));
        if (!isAliveAt(a, tick) || !isAliveAt(b, tick)) {
            return null;
        }
        return tick;
    }

    // Pairs adults of one generation into reproductive couples for the next. Pairing reaches across family
    // lines (excluding siblings) so the resulting trees span what will become separate households. Unpaired
    // people may receive a fresh immigrant spouse to keep lines branching.
    function pairUp(individuals: GenPerson[]): Couple[] {
        const couples: Couple[] = [];
        const paired = new Set<PersonId>();
        const shuffled = shuffle(individuals);
        const females = shuffled.filter(person => person.gender === Genders.Female);

        for (const male of shuffled) {
            if (male.gender !== Genders.Male || paired.has(male.id)) {
                continue;
            }
            if (!rng.chance(params.pairingProbability)) {
                continue;
            }

            let matched: GenPerson | null = null;
            for (const female of females) {
                if (paired.has(female.id) || shareParent(male, female)) {
                    continue;
                }
                if (ageGapYears(male, female) > params.spouseMaxAgeGapYears) {
                    continue;
                }
                const tick = marriageTick(male, female);
                if (tick === null) {
                    continue;
                }
                marry(male, female, tick);
                matched = female;
                break;
            }

            if (matched) {
                paired.add(male.id);
                paired.add(matched.id);
                couples.push({ maleId: male.id, femaleId: matched.id });
            } else if (!atCap() && rng.chance(params.immigrantSpouseProbability)) {
                const gapYears = rng.nextInt(-params.spouseMaxAgeGapYears, params.spouseMaxAgeGapYears);
                const immigrant = createPerson(Genders.Female, male.birthTick + yearsToTicks(gapYears), null, null, fakerPT_BR.person.lastName());
                assignLifespanDeath(immigrant);
                const tick = marriageTick(male, immigrant);
                if (tick !== null) {
                    marry(male, immigrant, tick);
                    paired.add(male.id);
                    paired.add(immigrant.id);
                    couples.push({ maleId: male.id, femaleId: immigrant.id });
                }
            }
        }

        return couples;
    }

    // Births for one generation: each couple has children, all anchored after both parents reach the
    // sampled parenting age and only while both parents are still alive.
    function birthChildren(couples: Couple[]): GenPerson[] {
        const children: GenPerson[] = [];
        for (const couple of couples) {
            const father = people[couple.maleId]!;
            const mother = people[couple.femaleId]!;
            const count = sampleChildCount();
            for (let c = 0; c < count; c++) {
                if (atCap()) {
                    return children;
                }
                const parentAge = rng.nextInt(params.parentMinAgeYears, params.parentMaxAgeYears);
                const birthTick = Math.max(father.birthTick, mother.birthTick) + yearsToTicks(parentAge);
                if (birthTick > PRESENT_TICK) {
                    continue; // not yet born relative to the present epoch
                }
                if (!isAliveAt(father, birthTick) || !isAliveAt(mother, birthTick)) {
                    continue; // a parent had already died
                }
                const gender = rng.chance(0.5) ? Genders.Male : Genders.Female;
                const child = createPerson(gender, birthTick, father.id, mother.id, father.familyName);
                assignLifespanDeath(child);
                children.push(child);
            }
        }
        return children;
    }

    // --- Founders --------------------------------------------------------------
    // Anchor founders far enough in the past that, after `generations` of ~generationGapYears each, the
    // youngest generation straddles the present.
    const founderBirthYear = -(params.generations * params.generationGapYears);
    let couples: Couple[] = [];
    for (let i = 0; i < params.founderCouples && !atCap(); i++) {
        const husbandBirth = yearsToTicks(founderBirthYear + (rng.next() - 0.5) * params.generationGapYears);
        const husband = createPerson(Genders.Male, husbandBirth, null, null, fakerPT_BR.person.lastName());
        assignLifespanDeath(husband);

        if (atCap()) {
            break;
        }
        const wifeGap = rng.nextInt(-params.spouseMaxAgeGapYears, params.spouseMaxAgeGapYears);
        const wife = createPerson(Genders.Female, husbandBirth + yearsToTicks(wifeGap), null, null, fakerPT_BR.person.lastName());
        assignLifespanDeath(wife);

        const tick = marriageTick(husband, wife);
        if (tick !== null) {
            marry(husband, wife, tick);
        }
        couples.push({ maleId: husband.id, femaleId: wife.id });
    }

    // --- Descendant generations ------------------------------------------------
    for (let generation = 1; generation <= params.generations && !atCap(); generation++) {
        const children = birthChildren(couples);
        couples = pairUp(children);
    }

    return {
        worldSeed: seed,
        people,
        drawSeed: rng.getState(),
        placedIds: [],
        nextSeq: counter,
    };
}

// Owns the live PopulationState for a game and offers read access. Generation is the pure function above;
// this class is the simulation-core holder (created per game, serialized into the save). Household drawing
// and the live births/deaths simulation are layered on in later phases (004c/004d).
export default class Population {
    private state: PopulationState;

    constructor(state?: PopulationState) {
        this.state = state ?? { worldSeed: 0, people: {}, drawSeed: 0, placedIds: [], nextSeq: 0 };
    }

    generate(seed: number, params: PopulationParams = DEFAULT_POPULATION_PARAMS): void {
        this.state = generatePopulation(seed, params);
    }

    getState(): PopulationState {
        return this.state;
    }

    loadState(state: PopulationState): void {
        this.state = state;
    }

    // Draws a coherent living household for a newly placed house, advancing (and persisting) the draw RNG so
    // reloads reproduce the sequence. Mutates state (placed people, any immigrants).
    drawHousehold(currentTick: number, capacity: number, ticksPerYear: number = DEFAULT_POPULATION_PARAMS.ticksPerYear): HouseholdSelection {
        const rng = new SeededRandom(this.state.drawSeed);
        const selection = selectHousehold(this.state, rng, currentTick, capacity, ticksPerYear);
        this.state.drawSeed = rng.getState();
        return selection;
    }

    getPerson(id: PersonId): GenPerson | null {
        return this.state.people[id] ?? null;
    }

    getPeople(): PersonTable {
        return this.state.people;
    }

    size(): number {
        return Object.keys(this.state.people).length;
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }
}
