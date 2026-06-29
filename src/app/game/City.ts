import { fakerPT_BR } from '@faker-js/faker';

import GameManager from 'game/GameManager';
import House from 'game/House';
import Workplace from 'game/Workplace';
import Building from 'game/Building';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';
import { DEFAULT_POPULATION_PARAMS } from 'game/Population';
import { generateBusiness } from 'game/BusinessGen';
import JobMarket from 'game/JobMarket';
import { DEFAULT_ECONOMY_PARAMS } from 'game/Economy';

import { ageAt, relationshipLabel, isAliveAt, siblingsOf, unclesAuntsOf, grandparentsOf } from 'util/kinship';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { assignSkills } from 'util/skills';
import { notificationForSignal } from 'util/notifications';
import { DAYS_PER_MONTH } from 'util/time';
import { DayResult } from 'types/LifeEvent';
import { Household } from 'types/Household';
import { PersonId, PersonTable } from 'types/Genealogy';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { NewDayEvent, TimeChangedEvent } from 'types/Time';

import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import householdDrawConfig from 'json/householdDraw.json';

const BUSINESS_BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;
const ADULT_AGE_YEARS = (householdDrawConfig as { adultAgeYears: number }).adultAgeYears;

let Game: GameManager;

export default class City {
    private name: string;
    private population: number;


    constructor(gameManager: GameManager) {
        Game = gameManager;

        this.name = fakerPT_BR.location.city();
        this.population = 0;

        Game.on("houseBuilt", { callback: this.setupHousehold, context: this });
        Game.on("workplaceBuilt", { callback: this.setupBusiness, context: this });
        Game.on("newDay", { callback: this.handleNewDay, context: this });
        Game.on("timeChanged", { callback: this.handleCommute, context: this });
        console.log('City created:', this.name);
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }

    public getPopulation(): number {
        return this.population;
    }

    public setPopulation(population: number): void {
        this.population = population;
    }

    public async setupHousehold(house: House): Promise<void> {
        if (!house) {
            throw new Error("Invalid house to setup household");
        }

        const population = Game.population;
        if (!population) {
            throw new Error("Cannot setup household before the population pool exists");
        }

        // Draw at the current in-game moment so household composition (who is alive, who is an adult) is
        // coherent with the date. Falls back to the pool's default scale only if the clock is missing.
        const clock = Game.clock;
        const currentTick = clock ? clock.getCurrentTick() : 0;
        const ticksPerYear = clock ? clock.getTicksPerYear() : DEFAULT_POPULATION_PARAMS.ticksPerYear;
        const capacity = house.getOverview().maxResidents;
        const selection = population.drawHousehold(currentTick, capacity, ticksPerYear);
        const pool = population.getPeople();

        // Materialize each drawn pool person into a live Person bound to this house.
        const personByGenId = new Map<PersonId, Person>();
        for (const memberId of selection.memberIds) {
            const genPerson = population.getPerson(memberId);
            if (!genPerson) {
                continue;
            }

            const person: Person = await Game.emitSingle("personSpawnRequest", house.getEntrance());
            if (!person) {
                continue;
            }

            person.setIndoors(true);
            person.social.setHome(house);
            const age = ageAt(genPerson, currentTick, ticksPerYear);
            person.setupCitizenship(genPerson.firstName, genPerson.familyName, age, genPerson.gender);
            // Link to the genealogy record so age derives from the clock and deaths can be reconciled later.
            person.social.setBirthTick(genPerson.birthTick);
            person.social.setPersonId(memberId);
            // Deterministic, age-aware skill set (task 014) so hiring (015) has something to match.
            person.work.setSkills(assignSkills(memberId, age, population.getState().worldSeed));
            // Seed starting funds (task 017). Newborns (materializeNewborns) start at 0.
            Game.economy?.setPersonBalance(memberId, DEFAULT_ECONOMY_PARAMS.startingPersonFunds);

            house.addResident(person);
            house.addOccupant(person);
            personByGenId.set(memberId, person);
        }

        // Mirror the pool's kinship onto the materialized residents so the family-tree window renders.
        for (const [aId, aPerson] of personByGenId) {
            for (const [bId, bPerson] of personByGenId) {
                if (aId === bId) {
                    continue;
                }
                const label = relationshipLabel(pool, aId, bId);
                if (label) {
                    aPerson.social.addRelationship(label, bPerson);
                }
            }
        }

        const household: Household = {
            id: `hh-${house.getIdentifier()}`,
            houseKey: house.getIdentifier(),
            headId: selection.headId,
            memberIds: selection.memberIds,
            arrangement: selection.arrangement,
        };
        house.setHousehold(household);

        this.population += personByGenId.size;
        console.log('Household spawned', household.arrangement, household.memberIds.length, 'members');
    }

    // Generates a business for a newly placed work building (Engine A). Deterministic per save + location: the
    // seed is the world seed mixed with the workplace's anchor key, so the same building at the same spot
    // always yields the same business, and it survives save/load without a persisted cursor. Picks a blueprint,
    // draws a size, names it, expands its job positions, and assigns it to the workplace.
    public setupBusiness(workplace: Workplace): void {
        if (!workplace) {
            throw new Error("Invalid workplace to setup business");
        }

        const blueprintKeys = Object.keys(BUSINESS_BLUEPRINTS);
        if (blueprintKeys.length === 0) {
            return;
        }

        const worldSeed = Game.population ? Game.population.getState().worldSeed : 0;
        const seed = (worldSeed ^ hashStringToSeed(workplace.getIdentifier())) >>> 0;
        const rng = new SeededRandom(seed);
        fakerPT_BR.seed(seed);

        const blueprintKey = rng.pick(blueprintKeys);
        const blueprint = BUSINESS_BLUEPRINTS[blueprintKey]!;
        const size = rng.nextInt(blueprint.size.min, blueprint.size.max);
        const name = fakerPT_BR.company.name();

        const business = generateBusiness(blueprintKey, blueprint, JOBS, name, size);
        workplace.setBusiness(business);
        // Seed starting capital (task 017), scaled by size so bigger establishments start with more.
        Game.economy?.setBusinessBalance(workplace.getIdentifier(), DEFAULT_ECONOMY_PARAMS.startingBusinessCapital * size);

        console.log('Business spawned:', business.name, `(${business.lineOfWork}, size ${size}, ${business.positions.length} positions)`);
    }

    // Runs the daily life simulation and reconciles the materialized world (docs/tasks/013 §5.7, §9). Each
    // in-game day: the off-map pool advances via the coarse yearly sim (excluding materialized people), and the
    // per-day event engine (Engine B) runs detailed life events over materialized people — deaths despawn the
    // resident, births materialize a newborn into the mother's house. Public for unit testing; invoked via
    // "newDay" in production.
    public async handleNewDay(event: NewDayEvent): Promise<void> {
        const population = Game.population;
        const clock = Game.clock;
        const field = Game.field;
        if (!population || !clock || !field) {
            return;
        }
        const ticksPerYear = clock.getTicksPerYear();

        // Index materialized (on-map) people by their pool id.
        const personByGenId = new Map<PersonId, Person>();
        for (const person of field.getPeople()) {
            const id = person.social.getPersonId();
            if (id) {
                personByGenId.set(id, person);
            }
        }
        const materializedIds = new Set(personByGenId.keys());

        // Coarse off-map pool sim: materialized people are excluded (Engine B owns their life events).
        population.simulate(event.tick, ticksPerYear, undefined, materializedIds);

        // Monthly economic update (payroll now; cost of living / P&L hook in here later). Independent of the
        // event engine, so it runs even in engine-less test harnesses.
        this.processMonthlyEconomy(event.tick);

        const engine = Game.eventEngine;
        if (!engine) {
            return;
        }

        // Employment market over the current materialized people, so get_job/layoff events hire/fire for real;
        // the economy ledger backs the `money` attribute and `adjustMoney` effect (task 017).
        const jobMarket = new JobMarket(personByGenId, field);
        const result = engine.simulateDay(population.getState(), [...materializedIds], event.tick, ticksPerYear, { jobMarket, ledger: Game.economy ?? null });
        this.reconcileDeaths(result.died, personByGenId);
        await this.materializeNewborns(result.born, personByGenId);
        // Resolve households left incoherent by deaths (e.g. a minor whose guardian died) — task 011.
        if (result.died.length > 0) {
            this.resolveRehousing(event.tick, ticksPerYear);
        }
        // Surface the day's notable happenings to the HUD feed (task 029).
        this.announceCityEvents(result, personByGenId, event.tick);
        // Remaining signals (partnershipFormed, hired, …) are consumed by later economy/commute phases.
    }

    // Translates the day's deaths, births, and event signals into cityEvent feed entries (task 029). The
    // single place that maps the simulation's outcomes to player-facing notifications.
    private announceCityEvents(result: DayResult, personByGenId: Map<PersonId, Person>, tick: number): void {
        const population = Game.population;
        const nameOf = (id: PersonId): string => {
            const person = personByGenId.get(id);
            if (person) {
                return person.social.getFullName();
            }
            const record = population?.getPerson(id);
            return record ? `${record.firstName} ${record.familyName}` : 'Someone';
        };

        for (const id of result.died) {
            this.announce('death', tick, `${nameOf(id)} passed away`, personByGenId.get(id) ?? null);
        }
        for (const birth of result.born) {
            this.announce('birth', tick, `${nameOf(birth.motherId)} had a baby`, personByGenId.get(birth.id) ?? null);
        }
        for (const signal of result.signals) {
            if (!signal.personId) {
                continue;
            }
            const notification = notificationForSignal(signal.signal, nameOf(signal.personId));
            if (notification) {
                this.announce(notification.kind, tick, notification.message, personByGenId.get(signal.personId) ?? null);
            }
        }
    }

    private announce(kind: string, tick: number, message: string, person: Person | null): void {
        Game.emit("cityEvent", { kind, tick, message, person });
    }

    // The once-a-month economic update (task 018+). Gated by the economy's lastEconomyMonth so it runs once
    // per in-game month and never double-runs across save/load. Public for unit testing; in production it is
    // driven each day by handleNewDay. Cost of living (019) and business P&L (020) will hook in here.
    public processMonthlyEconomy(tick: number): void {
        const economy = Game.economy;
        if (!economy) {
            return;
        }
        const month = Math.floor(tick / DAYS_PER_MONTH);
        if (month <= economy.getLastEconomyMonth()) {
            return;
        }
        economy.setLastEconomyMonth(month);
        this.runPayroll(tick);
    }

    // Pays each employed person their monthly salary from their employer's balance, through the ledger (task
    // 018). A business that can't cover payroll simply goes into debt (negative balance); when it first crosses
    // into the red it surfaces a stress notification — the hook business P&L (020) / bankruptcy (021) consume.
    private runPayroll(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                continue;
            }

            const key = structure.getIdentifier();
            const balanceBefore = economy.getBusinessBalance(key);
            let totalPaid = 0;
            for (const employee of structure.getEmployees()) {
                const job = employee.work.getJob();
                const personId = employee.social.getPersonId();
                if (!job || !personId) {
                    continue;
                }
                economy.transfer({ kind: 'business', id: key }, { kind: 'person', id: personId }, job.salary);
                totalPaid += job.salary;
            }

            if (totalPaid > 0 && balanceBefore >= 0 && economy.getBusinessBalance(key) < 0) {
                this.announce('businessStress', tick, `${business.name} is struggling to pay wages`, null);
            }
        }
    }

    // Removes materialized residents who died this day from their house, household, and the field.
    private reconcileDeaths(diedIds: PersonId[], personByGenId: Map<PersonId, Person>): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        for (const personId of diedIds) {
            const person = personByGenId.get(personId);
            if (!person) {
                continue;
            }

            const home = person.social.getHome();
            if (home) {
                home.removeResident(person);
                home.removeOccupant(person);
                const household = home.getHousehold();
                if (household) {
                    household.memberIds = household.memberIds.filter(memberId => memberId !== personId);
                    if (household.headId === personId) {
                        household.headId = household.memberIds[0] ?? household.headId;
                    }
                }
            }

            field.removePerson(person);
            this.population = Math.max(0, this.population - 1);
        }
    }

    // Materializes newborns of materialized mothers into the mother's house, mirroring setupHousehold's
    // materialization. The newborn already exists in the genealogy pool (the birth effect appended it).
    private async materializeNewborns(born: { id: PersonId; motherId: PersonId; fatherId: PersonId }[], personByGenId: Map<PersonId, Person>): Promise<void> {
        const population = Game.population;
        const clock = Game.clock;
        if (!population || !clock) {
            return;
        }

        for (const birth of born) {
            const mother = personByGenId.get(birth.motherId);
            const home = mother?.social.getHome();
            if (!mother || !(home instanceof House)) {
                continue;
            }
            const genChild = population.getPerson(birth.id);
            if (!genChild) {
                continue;
            }

            const person: Person = await Game.emitSingle("personSpawnRequest", home.getEntrance());
            if (!person) {
                continue;
            }

            person.setIndoors(true);
            person.social.setHome(home);
            person.setupCitizenship(genChild.firstName, genChild.familyName, 0, genChild.gender);
            person.social.setBirthTick(genChild.birthTick);
            person.social.setPersonId(birth.id);
            // Newborns are minors → typically no specialised skills yet (task 014); they acquire them with age.
            person.work.setSkills(assignSkills(birth.id, 0, population.getState().worldSeed));

            home.addResident(person);
            home.addOccupant(person);
            personByGenId.set(birth.id, person);

            const household = home.getHousehold();
            if (household) {
                household.memberIds.push(birth.id);
            }

            this.population += 1;
        }
    }

    // Relocates survivors of households left incoherent by a death — primarily a minor whose only adult
    // (guardian/parent) died, leaving them "living alone" (task 011 / docs/tasks/013 §10). Each orphaned minor
    // is moved into a living relative's placed household (sibling → aunt/uncle → grandparent priority) that has
    // capacity. Public for unit testing; in production it runs from handleNewDay after death reconciliation.
    public resolveRehousing(tick: number, ticksPerYear: number): void {
        const field = Game.field;
        const population = Game.population;
        if (!field || !population) {
            return;
        }
        const pool = population.getPeople();

        const byGenId = new Map<PersonId, Person>();
        for (const person of field.getPeople()) {
            const id = person.social.getPersonId();
            if (id) {
                byGenId.set(id, person);
            }
        }

        for (const structure of field.getStructures()) {
            if (!(structure instanceof House)) {
                continue;
            }
            const household = structure.getHousehold();
            if (!household) {
                continue;
            }

            const livingMembers = household.memberIds.filter(id => byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick));
            if (livingMembers.length === 0) {
                continue;
            }
            const hasAdult = livingMembers.some(id => ageAt(pool[id]!, tick, ticksPerYear) >= ADULT_AGE_YEARS);
            if (hasAdult) {
                continue; // a coherent guardian remains
            }

            // No adult present: relocate each minor to a relative's adult household.
            for (const minorId of [...livingMembers]) {
                const target = this.findGuardianHouse(minorId, pool, byGenId, structure, tick, ticksPerYear);
                if (target) {
                    this.relocateMember(minorId, byGenId, structure, target);
                }
            }
        }
    }

    private findGuardianHouse(minorId: PersonId, pool: PersonTable, byGenId: Map<PersonId, Person>, currentHouse: House, tick: number, ticksPerYear: number): House | null {
        const relativeFinders = [siblingsOf, unclesAuntsOf, grandparentsOf];
        for (const find of relativeFinders) {
            const candidates = find(pool, minorId).filter(id =>
                byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick) && ageAt(pool[id]!, tick, ticksPerYear) >= ADULT_AGE_YEARS
            );
            for (const relativeId of candidates.sort()) {
                const home = byGenId.get(relativeId)!.social.getHome();
                if (home instanceof House && home !== currentHouse && home.getResidents().length < home.getOverview().maxResidents) {
                    return home;
                }
            }
        }
        return null;
    }

    private relocateMember(personId: PersonId, byGenId: Map<PersonId, Person>, fromHouse: House, toHouse: House): void {
        const person = byGenId.get(personId);
        if (!person) {
            return;
        }

        fromHouse.removeResident(person);
        fromHouse.removeOccupant(person);
        const fromHousehold = fromHouse.getHousehold();
        if (fromHousehold) {
            fromHousehold.memberIds = fromHousehold.memberIds.filter(id => id !== personId);
            if (fromHousehold.headId === personId) {
                fromHousehold.headId = fromHousehold.memberIds[0] ?? fromHousehold.headId;
            }
        }

        toHouse.addResident(person);
        toHouse.addOccupant(person);
        person.social.setHome(toHouse);
        const toHousehold = toHouse.getHousehold();
        if (toHousehold && !toHousehold.memberIds.includes(personId)) {
            toHousehold.memberIds.push(personId);
        }
    }

    // Schedule-driven commute (task 006). On each in-game minute, dispatch employed, idle residents: out to
    // work once their shift has started, back home once it has ended. Each trip spawns a car at the origin's
    // entrance and drives the Person's TravelStep machine (walk → drive → walk), despawning the car on arrival.
    // Public for unit testing; invoked via the "timeChanged" event in production.
    public handleCommute(event: TimeChangedEvent): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        const minuteOfDay = event.timestamp.hour * 60 + event.timestamp.minute;

        for (const person of field.getPeople()) {
            const job = person.work.getJob();
            const workplace = person.work.getWorkplace();
            const home = person.social.getHome();
            if (!job || !workplace || !home || !person.isIdle()) {
                continue;
            }

            const current = person.getCurrentBuilding() ?? home;
            const shouldBeAtWork = minuteOfDay >= job.shiftStart && minuteOfDay < job.shiftEnd;

            if (shouldBeAtWork && current !== workplace) {
                this.startCommute(person, workplace);
            } else if (!shouldBeAtWork && current === workplace) {
                this.startCommute(person, home);
            }
        }
    }

    private startCommute(person: Person, destination: Building): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        const origin = person.getCurrentBuilding() ?? person.social.getHome();
        const entrance = origin ? origin.getEntrance() : null;
        if (!entrance) {
            return;
        }

        const vehicle = field.spawnVehicle(entrance);
        vehicle.setControlled(true);
        person.setVehicle(vehicle);
        person.setDestination(destination);
    }

    public setupCar(vehicle: Vehicle): void {
        console.log('Car spawning', vehicle);
    }
}


