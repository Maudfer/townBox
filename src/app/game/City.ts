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
import HousingMarket from 'game/HousingMarket';
import { DEFAULT_ECONOMY_PARAMS } from 'game/Economy';

import { ageAt, relationshipLabel, isAliveAt, siblingsOf, unclesAuntsOf, grandparentsOf, spouseAt, childrenOf, parentsOf } from 'util/kinship';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { assignSkills } from 'util/skills';
import { notificationForSignal } from 'util/notifications';
import { DAYS_PER_MONTH } from 'util/time';
import { computeBusinessPnl, positionDelta, unitMaterialCost, resolveDemand, DemandBusiness } from 'util/businessFinance';
import { evaluateCurve } from 'util/curve';
import { DayResult } from 'types/LifeEvent';
import { Household, HouseholdArrangements } from 'types/Household';
import { PersonId, PersonTable } from 'types/Genealogy';
import { BusinessBlueprintTable, BusinessInstance, JobTable } from 'types/Business';
import { DemandTable } from 'types/Demand';
import { NewDayEvent, TimeChangedEvent } from 'types/Time';

import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import householdDrawConfig from 'json/householdDraw.json';
import materialsConfig from 'json/materials.json';
import demandConfig from 'json/demand.json';

const BUSINESS_BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;
const MATERIAL_PRICES: Record<string, number> = Object.fromEntries(
    Object.entries(materialsConfig as Record<string, { basePrice: number }>).map(([key, value]) => [key, value.basePrice])
);
const DEMAND_TABLE = demandConfig as unknown as DemandTable;
const ADULT_AGE_YEARS = (householdDrawConfig as { adultAgeYears: number }).adultAgeYears;

let Game: GameManager;

export default class City {
    private name: string;
    private population: number;
    // Evicted households with no home (task 022). Their members stay materialized (home = null, hidden) so they
    // can recover; this registry drives the monthly recovery attempt and is serialized in the save.
    private homelessHouseholds: Household[];


    constructor(gameManager: GameManager) {
        Game = gameManager;

        this.name = fakerPT_BR.location.city();
        this.population = 0;
        this.homelessHouseholds = [];

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

    // Homeless households (task 022) — exposed so the save manager can round-trip the registry.
    public getHomelessHouseholds(): Household[] {
        return this.homelessHouseholds;
    }

    public setHomelessHouseholds(households: Household[]): void {
        this.homelessHouseholds = households;
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
        const business = this.openBusiness(workplace);
        if (business) {
            console.log('Business spawned:', business.name, `(${business.lineOfWork}, size ${business.size}, ${business.positions.length} positions)`);
        }
    }

    // Generates and installs a business on a work building (Engine A). Deterministic per save + location +
    // generation: the seed mixes the world seed with the lot's anchor key and its generation index, so the
    // first business matches the legacy location-only seed (generation 0) while a re-occupied lot
    // (generation ≥ 1) draws a *different* business. Optionally constrains the draw to a demand `category`
    // (task 037 re-occupancy). Picks a blueprint, draws a size, names it, seeds capital, advances the lot's
    // generation count, and clears its vacancy clock.
    private openBusiness(workplace: Workplace, category?: string): BusinessInstance | null {
        const blueprintKeys = Object.keys(BUSINESS_BLUEPRINTS);
        if (blueprintKeys.length === 0) {
            return null;
        }

        const generation = workplace.getBusinessGenerations();
        const key = workplace.getIdentifier();
        const worldSeed = Game.population ? Game.population.getState().worldSeed : 0;
        // Generation 0 keeps the legacy location-only seed, so existing placements/saves are unchanged.
        const seedKey = generation === 0 ? key : `${key}#${generation}`;
        const seed = (worldSeed ^ hashStringToSeed(seedKey)) >>> 0;
        const rng = new SeededRandom(seed);
        fakerPT_BR.seed(seed);

        const candidates = category ? blueprintKeys.filter(blueprintKey => BUSINESS_BLUEPRINTS[blueprintKey]!.category === category) : blueprintKeys;
        const pool = candidates.length > 0 ? candidates : blueprintKeys;
        const blueprintKey = rng.pick(pool);
        const blueprint = BUSINESS_BLUEPRINTS[blueprintKey]!;
        const size = rng.nextInt(blueprint.size.min, blueprint.size.max);
        const name = fakerPT_BR.company.name();

        const business = generateBusiness(blueprintKey, blueprint, JOBS, name, size);
        workplace.setBusiness(business);
        // Seed starting capital (task 017), scaled by size so bigger establishments start with more.
        Game.economy?.setBusinessBalance(key, DEFAULT_ECONOMY_PARAMS.startingBusinessCapital * size);
        workplace.setBusinessGenerations(generation + 1);
        workplace.setVacantMonths(0);
        return business;
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
        // Housing market gates move-out eligibility (task 024): a person can only leave home when a vacant one
        // exists. Rebuilt each day over the current materialized people, like the job market.
        const housing = new HousingMarket(personByGenId, field);
        const result = engine.simulateDay(population.getState(), [...materializedIds], event.tick, ticksPerYear, { jobMarket, ledger: Game.economy ?? null, housing });
        this.reconcileDeaths(result.died, personByGenId);
        await this.materializeNewborns(result.born, personByGenId);
        // Resolve households left incoherent by deaths (e.g. a minor whose guardian died) — task 011.
        if (result.died.length > 0) {
            this.resolveRehousing(event.tick, ticksPerYear);
        }
        // Living-arrangement dynamics driven by event signals: newlyweds move in together (task 023) and grown
        // children leave the family home to form their own household (task 024).
        for (const signal of result.signals) {
            if (!signal.personId) {
                continue;
            }
            if (signal.signal === 'partnershipFormed') {
                this.resolveCohabitation(signal.personId, event.tick, ticksPerYear);
            } else if (signal.signal === 'movedOut') {
                this.resolveMoveOut(signal.personId, event.tick);
            }
        }
        // Surface the day's notable happenings to the HUD feed (task 029).
        this.announceCityEvents(result, personByGenId, event.tick);
        // Remaining signals (hired, fellIll, …) are consumed by the feed and later phases.
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
        this.runBusinessEconomics(tick);
        this.runReoccupancy(tick);
        this.runCostOfLiving(tick);
        this.runEvictions(tick);
        this.runRecovery(tick);
    }

    // Monthly business P&L driven by the demand model (task 033): households generate per-category demand,
    // businesses compete for it by capacity (staffing × throughput), and revenue = unitsSold × price. P&L =
    // revenue − materials − fixed − payroll (payroll already debited by runPayroll, so only the income side is
    // applied here). Records P&L + a profit/loss streak; a sustainedly profitable, fully-staffed business grows.
    // A business whose balance stays below the debt floor for too long goes bankrupt and closes (task 021).
    private runBusinessEconomics(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        // City-wide demand per category from the materialized population (consumers). v1 is flat per-capita;
        // demographic/income modifiers and locality are documented refinements (033 §A2/§A6).
        const population = field.getPeople().length;
        const demandByCategory: Record<string, number> = {};
        for (const [category, demand] of Object.entries(DEMAND_TABLE)) {
            demandByCategory[category] = population * demand.perCapita;
        }

        // Each operating business's capacity, and an index to resolve units back to it.
        const competitors: DemandBusiness[] = [];
        const byKey = new Map<string, { workplace: Workplace; business: NonNullable<ReturnType<Workplace['getBusiness']>>; blueprint: BusinessBlueprintTable[string] }>();
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                continue;
            }
            const blueprint = BUSINESS_BLUEPRINTS[business.blueprintKey];
            if (!blueprint) {
                continue;
            }
            const key = structure.getIdentifier();
            const throughput = DEMAND_TABLE[blueprint.category]?.throughputPerEmployee ?? 0;
            competitors.push({ key, category: blueprint.category, capacity: structure.getEmployees().length * throughput });
            byKey.set(key, { workplace: structure, business, blueprint });
        }

        const unitsByKey = resolveDemand(competitors, demandByCategory);

        for (const [key, { workplace, business, blueprint }] of byKey) {
            const unitsSold = unitsByKey.get(key) ?? 0;
            const pricePerUnit = (DEMAND_TABLE[blueprint.category]?.pricePerUnit ?? 0) * (blueprint.economics?.priceMarkup ?? 1);
            const revenue = unitsSold * pricePerUnit;
            const materialsCost = unitsSold * unitMaterialCost(blueprint, MATERIAL_PRICES);
            const fixedCosts = blueprint.economics?.fixedCostsPerMonth ? evaluateCurve(blueprint.economics.fixedCostsPerMonth, business.size) : 0;
            const payroll = workplace.getEmployees().reduce((total, employee) => total + (employee.work.getJob()?.salary ?? 0), 0);
            const finance = computeBusinessPnl(revenue, materialsCost, fixedCosts, payroll);

            // Payroll was already debited by runPayroll; apply only the income side here.
            economy.adjustBusiness(key, revenue - materialsCost - fixedCosts);
            business.lastPnl = finance.pnl;

            const previousStreak = business.profitStreak ?? 0;
            if (finance.pnl > 0) {
                business.profitStreak = previousStreak > 0 ? previousStreak + 1 : 1;
            } else if (finance.pnl < 0) {
                business.profitStreak = previousStreak < 0 ? previousStreak - 1 : -1;
            }

            // Bankruptcy (task 021): once the balance has stayed below the debt floor for too many consecutive
            // months, the business is insolvent — close it (lay everyone off, vacate the building) and skip
            // growth. The starting capital gives a runway before the count begins (balance >= floor resets it).
            if (economy.getBusinessBalance(key) < DEFAULT_ECONOMY_PARAMS.bankruptcyDebtFloor) {
                business.insolventMonths = (business.insolventMonths ?? 0) + 1;
            } else {
                business.insolventMonths = 0;
            }
            if ((business.insolventMonths ?? 0) >= DEFAULT_ECONOMY_PARAMS.bankruptcyMonths) {
                this.closeBusiness(workplace, business, key, tick);
                continue;
            }

            // Grow when sustainedly profitable and already fully staffed (a proxy for "demand exceeds capacity").
            if ((business.profitStreak ?? 0) >= DEFAULT_ECONOMY_PARAMS.growthMonths
                && workplace.getOpenPositions().length === 0
                && business.size < blueprint.size.max) {
                const grown = generateBusiness(business.blueprintKey, blueprint, JOBS, business.name, business.size + 1);
                workplace.expandPositions(business.size + 1, grown.positions, positionDelta(business.positions, grown.positions));
                business.profitStreak = 0;
                this.announce('businessGrew', tick, `${business.name} is expanding`, null);
            }
        }
    }

    // Shuts down a bankrupt business (task 021): lays off every employee (clearing their WorkLife.job so they
    // re-enter the job market via get_job, 015), clears the BusinessInstance so the building becomes vacant, and
    // writes off the unrecoverable debt. The lot stays vacant (and renders desaturated) until the player
    // bulldozes/rebuilds (025) — re-occupancy over time is a documented follow-up. Surfaces businessClosed (and
    // a massLayoff when staff were let go) to the feed (029).
    private closeBusiness(workplace: Workplace, business: BusinessInstance, key: string, tick: number): void {
        const laidOff = workplace.closeBusiness();
        for (const person of laidOff) {
            person.work.clearJob();
        }
        Game.economy?.setBusinessBalance(key, 0);

        this.announce('businessClosed', tick, `${business.name} has gone out of business`, null);
        if (laidOff.length > 0) {
            const subject = laidOff.length === 1 ? '1 person was' : `${laidOff.length} people were`;
            this.announce('massLayoff', tick, `${subject} laid off from ${business.name}`, null);
        }

        // Re-draw so the now-businessless building reads as vacant (desaturated), like an emptied house.
        Game.emit("tileSpawned", workplace);
    }

    // Re-occupies vacant work buildings over time (task 037): a lot vacated by bankruptcy stays vacant for
    // reoccupancyMonths, then attracts a *new, different* business — but only in a category with unmet demand,
    // so the city heals where investment is warranted instead of re-flooding an oversupplied market. Runs after
    // runBusinessEconomics so it sees this month's closures and post-closure supply. Deterministic.
    private runReoccupancy(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        // Blueprints grouped by category, so a chosen category always has something to build.
        const blueprintsByCategory = new Map<string, string[]>();
        for (const [blueprintKey, blueprint] of Object.entries(BUSINESS_BLUEPRINTS)) {
            const keys = blueprintsByCategory.get(blueprint.category) ?? [];
            keys.push(blueprintKey);
            blueprintsByCategory.set(blueprint.category, keys);
        }

        const population = field.getPeople().length;
        // Potential supply per category from operating businesses (full establishment: positions × throughput),
        // so we don't over-build while an existing understaffed business still has room to hire up.
        const supply: Record<string, number> = {};
        const vacant: Workplace[] = [];
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                vacant.push(structure);
                continue;
            }
            const blueprint = BUSINESS_BLUEPRINTS[business.blueprintKey];
            if (!blueprint) {
                continue;
            }
            const throughput = DEMAND_TABLE[blueprint.category]?.throughputPerEmployee ?? 0;
            supply[blueprint.category] = (supply[blueprint.category] ?? 0) + business.positions.length * throughput;
        }

        for (const workplace of vacant) {
            workplace.setVacantMonths(workplace.getVacantMonths() + 1);
            if (workplace.getVacantMonths() < DEFAULT_ECONOMY_PARAMS.reoccupancyMonths) {
                continue;
            }

            // The category with the largest unmet demand (demand − potential supply) that has a blueprint.
            let bestCategory: string | null = null;
            let bestDeficit = 0;
            for (const category of blueprintsByCategory.keys()) {
                const demand = population * (DEMAND_TABLE[category]?.perCapita ?? 0);
                const deficit = demand - (supply[category] ?? 0);
                if (deficit > bestDeficit) {
                    bestDeficit = deficit;
                    bestCategory = category;
                }
            }
            if (!bestCategory) {
                continue; // no unmet demand anywhere → the lot stays vacant
            }

            const business = this.openBusiness(workplace, bestCategory);
            if (!business) {
                continue;
            }
            // Count the new business's potential capacity so later lots this tick don't pile into the same gap.
            const throughput = DEMAND_TABLE[bestCategory]?.throughputPerEmployee ?? 0;
            supply[bestCategory] = (supply[bestCategory] ?? 0) + business.positions.length * throughput;
            this.announce('businessOpened', tick, `${business.name} opened on a vacant lot`, null);
            Game.emit("tileSpawned", workplace);
        }
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

    // Charges each household its monthly cost of living (housing + per-resident upkeep) against its residents'
    // pooled funds (task 019). A household that can't cover it pays what it can and accrues an arrears count —
    // the hook eviction (022) consumes. Money leaves to off-map suppliers for now; routing it to local
    // businesses as revenue is part of the demand model (020/035).
    private runCostOfLiving(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        for (const structure of field.getStructures()) {
            if (!(structure instanceof House)) {
                continue;
            }
            const household = structure.getHousehold();
            const residents = structure.getResidents().filter(resident => resident.social.getPersonId() !== null);
            if (!household || residents.length === 0) {
                continue;
            }

            const expense = DEFAULT_ECONOMY_PARAMS.housingCost + DEFAULT_ECONOMY_PARAMS.perCapitaCost * residents.length;
            const funds = residents.reduce((total, resident) => total + economy.getPersonBalance(resident.social.getPersonId()!), 0);

            // Drain the household's available funds (head first) up to what it can afford; never forced negative.
            let toCharge = Math.min(expense, Math.max(0, funds));
            for (const resident of residents) {
                if (toCharge <= 0) {
                    break;
                }
                const id = resident.social.getPersonId()!;
                const take = Math.min(Math.max(0, economy.getPersonBalance(id)), toCharge);
                economy.adjustPerson(id, -take);
                toCharge -= take;
            }

            const wasInArrears = (household.arrears ?? 0) > 0;
            if (funds < expense) {
                household.arrears = (household.arrears ?? 0) + 1;
                if (!wasInArrears) {
                    this.announce('householdStress', tick, `The ${structure.getHouseholdName()} household can't make ends meet`, null);
                }
            } else {
                household.arrears = 0;
            }
        }
    }

    // Evicts households that have been in arrears (task 019) too long (task 022). Each member is first offered a
    // place in a solvent relative's household (reusing the relocation helper); any member with no taker becomes
    // homeless — they leave the resident list and are hidden, the original household dissolves, the house turns
    // vacant, and a Homeless household is registered for the monthly recovery attempt. Deterministic.
    private runEvictions(tick: number): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        const threshold = DEFAULT_ECONOMY_PARAMS.evictionArrearsMonths;
        const toEvict = field.getStructures().filter((structure): structure is House =>
            structure instanceof House && (structure.getHousehold()?.arrears ?? 0) >= threshold
        );
        for (const house of toEvict) {
            this.evictHousehold(house, tick);
        }
    }

    private evictHousehold(house: House, tick: number): void {
        const population = Game.population;
        const household = house.getHousehold();
        if (!population || !household) {
            return;
        }
        const pool = population.getPeople();
        const byGenId = this.indexByGenId();
        const householdName = house.getHouseholdName();

        const homelessIds: PersonId[] = [];
        let rehoused = 0;
        for (const memberId of [...household.memberIds]) {
            const person = byGenId.get(memberId);
            if (!person) {
                continue; // not materialized — nothing to relocate on the map
            }
            const relativeHouse = this.findRelativeHouse(memberId, byGenId, pool, house, tick);
            if (relativeHouse) {
                this.relocateMember(memberId, byGenId, house, relativeHouse);
                rehoused += 1;
            } else {
                // No taker → homeless: leave the home, keep materialized but hidden, await recovery.
                house.removeResident(person);
                house.removeOccupant(person);
                person.social.setHome(null);
                person.setIndoors(true);
                homelessIds.push(memberId);
            }
        }

        // The original household is dissolved; the house is now vacant.
        house.clearHousehold();
        this.vacateIfEmpty(house);

        this.announce('evicted', tick, `The ${householdName} household was evicted`, null);
        if (rehoused > 0) {
            this.announce('rehoused', tick, `Relatives took in some of the ${householdName} household`, null);
        }
        if (homelessIds.length > 0) {
            this.homelessHouseholds.push({
                id: `homeless-${household.id}`,
                houseKey: '',
                headId: homelessIds[0]!,
                memberIds: homelessIds,
                arrangement: HouseholdArrangements.Homeless,
                arrears: household.arrears,
            });
            this.announce('becameHomeless', tick, `The ${householdName} household is now homeless`, null);
        }
    }

    // The placed home of a solvent relative (with spare capacity) willing to take someone in on eviction — broad
    // kinship search (parents → children → siblings → aunts/uncles → grandparents), deterministic by id.
    private findRelativeHouse(personId: PersonId, byGenId: Map<PersonId, Person>, pool: PersonTable, currentHouse: House, tick: number): House | null {
        const relativeFinders = [parentsOf, childrenOf, siblingsOf, unclesAuntsOf, grandparentsOf];
        for (const find of relativeFinders) {
            const candidates = find(pool, personId).filter(id => byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick));
            for (const relativeId of candidates.sort()) {
                const home = byGenId.get(relativeId)!.social.getHome();
                if (home instanceof House && home !== currentHouse
                    && home.getResidents().length < home.getOverview().maxResidents
                    && this.householdSolvent(home)) {
                    return home;
                }
            }
        }
        return null;
    }

    // A household is solvent enough to take someone in when it isn't in arrears and its residents' pooled funds
    // are not in the red.
    private householdSolvent(house: House): boolean {
        const economy = Game.economy;
        const household = house.getHousehold();
        if (!household || (household.arrears ?? 0) > 0) {
            return false;
        }
        if (!economy) {
            return true;
        }
        const funds = house.getResidents().reduce((total, resident) => {
            const id = resident.social.getPersonId();
            return total + (id ? economy.getPersonBalance(id) : 0);
        }, 0);
        return funds >= 0;
    }

    // Monthly recovery (task 022): a homeless household whose members have recovered enough pooled funds (e.g. via
    // re-employment, 015) occupies the lowest-keyed vacant house, forming a fresh household. Members beyond the
    // home's capacity stay homeless; dead members are pruned. Keeps homelessness escapable, not a dead end.
    private runRecovery(tick: number): void {
        const population = Game.population;
        const economy = Game.economy;
        if (!population || !economy) {
            return;
        }
        const pool = population.getPeople();
        const byGenId = this.indexByGenId();

        const remaining: Household[] = [];
        for (const household of this.homelessHouseholds) {
            const livingMembers = household.memberIds.filter(id => byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick));
            if (livingMembers.length === 0) {
                continue; // everyone gone — drop the record
            }

            const funds = livingMembers.reduce((total, id) => total + economy.getPersonBalance(id), 0);
            const vacant = funds >= DEFAULT_ECONOMY_PARAMS.recoveryFunds ? this.findVacantHouse() : null;
            if (!vacant) {
                remaining.push({ ...household, memberIds: livingMembers, headId: livingMembers[0]! });
                continue;
            }

            const movers = livingMembers.slice(0, vacant.getOverview().maxResidents);
            for (const id of movers) {
                const person = byGenId.get(id)!;
                person.social.setHome(vacant);
                person.setIndoors(true);
                vacant.addResident(person);
                vacant.addOccupant(person);
            }
            vacant.setHousehold({
                id: `hh-${vacant.getIdentifier()}`,
                houseKey: vacant.getIdentifier(),
                headId: movers[0]!,
                memberIds: movers,
                arrangement: movers.length === 1 ? HouseholdArrangements.Single : HouseholdArrangements.Nuclear,
            });
            Game.emit("tileSpawned", vacant); // now occupied → drop the vacant look
            this.announce('rehoused', tick, `A homeless household found a home again`, null);

            // Anyone who didn't fit stays homeless.
            const leftover = livingMembers.slice(vacant.getOverview().maxResidents);
            if (leftover.length > 0) {
                remaining.push({ ...household, memberIds: leftover, headId: leftover[0]! });
            }
        }
        this.homelessHouseholds = remaining;
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
                // If the house just emptied out, re-draw it so it reads as vacant (desaturated).
                if (home instanceof House) {
                    this.vacateIfEmpty(home);
                }
            } else {
                // A homeless person who died: prune them from the homeless registry (task 022).
                this.removeFromHomelessRegistry(personId);
            }

            field.removePerson(person);
            this.population = Math.max(0, this.population - 1);
        }
    }

    // Drops a person from any homeless household, reassigning the head and discarding emptied records (task 022).
    private removeFromHomelessRegistry(personId: PersonId): void {
        for (const household of this.homelessHouseholds) {
            household.memberIds = household.memberIds.filter(id => id !== personId);
            if (household.headId === personId) {
                household.headId = household.memberIds[0] ?? household.headId;
            }
        }
        this.homelessHouseholds = this.homelessHouseholds.filter(household => household.memberIds.length > 0);
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

        this.removeFromHome(person, personId, fromHouse);

        toHouse.addResident(person);
        toHouse.addOccupant(person);
        person.social.setHome(toHouse);
        const toHousehold = toHouse.getHousehold();
        if (toHousehold && !toHousehold.memberIds.includes(personId)) {
            toHousehold.memberIds.push(personId);
        }
    }

    // Detaches a person from their current house + household (the removal half of a relocation, shared by
    // death-reconcile, rehousing, cohabitation, and move-out). Drops them from the resident/occupant lists,
    // prunes the household memberIds (reassigning head if needed), and re-draws the house vacant if it emptied.
    private removeFromHome(person: Person, personId: PersonId, fromHouse: House): void {
        fromHouse.removeResident(person);
        fromHouse.removeOccupant(person);
        const fromHousehold = fromHouse.getHousehold();
        if (fromHousehold) {
            fromHousehold.memberIds = fromHousehold.memberIds.filter(id => id !== personId);
            if (fromHousehold.headId === personId) {
                fromHousehold.headId = fromHousehold.memberIds[0] ?? fromHousehold.headId;
            }
        }
        this.vacateIfEmpty(fromHouse);
    }

    // Re-draws a house as vacant (desaturated) once its last resident leaves, mirroring the empty-house path in
    // reconcileDeaths. The MainScene vacancy check keys off an empty resident list, so a re-emit is enough.
    private vacateIfEmpty(house: House): void {
        if (house.getResidents().length === 0) {
            Game.emit("tileSpawned", house);
        }
    }

    // Indexes the materialized (on-map) people by their genealogy pool id — the lookup death-rehousing,
    // cohabitation, and move-out all need to map signals/relations back to live Persons.
    private indexByGenId(): Map<PersonId, Person> {
        const byGenId = new Map<PersonId, Person>();
        const field = Game.field;
        if (!field) {
            return byGenId;
        }
        for (const person of field.getPeople()) {
            const id = person.social.getPersonId();
            if (id) {
                byGenId.set(id, person);
            }
        }
        return byGenId;
    }

    // The materialized minor children of `parentId` who currently live in `house` — the dependents that move
    // with a parent on cohabitation (task 023).
    private dependentMinorsInHouse(parentId: PersonId, house: House, byGenId: Map<PersonId, Person>, pool: PersonTable, tick: number, ticksPerYear: number): PersonId[] {
        return childrenOf(pool, parentId).filter(childId => {
            const child = byGenId.get(childId);
            return !!child && child.social.getHome() === house
                && !!pool[childId] && isAliveAt(pool[childId]!, tick)
                && ageAt(pool[childId]!, tick, ticksPerYear) < ADULT_AGE_YEARS;
        });
    }

    // Newlywed cohabitation (task 023): when a marriage forms between two materialized people living apart, move
    // the couple (and the moving spouse's dependent minors) into one home. Policy: the larger household stays
    // put and the smaller side moves in (ties keep the subject's home); the move is skipped if the combined
    // household would exceed the target's capacity (a housing-market relocation is a future task). Public for
    // unit testing; in production it runs from handleNewDay on the `partnershipFormed` signal.
    public resolveCohabitation(subjectId: PersonId, tick: number, ticksPerYear: number): void {
        const population = Game.population;
        if (!population) {
            return;
        }
        const pool = population.getPeople();

        const spouseId = spouseAt(pool, subjectId, tick);
        if (!spouseId) {
            return;
        }

        const byGenId = this.indexByGenId();
        const subject = byGenId.get(subjectId);
        const spouse = byGenId.get(spouseId);
        if (!subject || !spouse) {
            return; // only relocate when both spouses are materialized (pool-only partners just record the marriage)
        }

        const subjectHome = subject.social.getHome();
        const spouseHome = spouse.social.getHome();
        if (!(subjectHome instanceof House) || !(spouseHome instanceof House) || subjectHome === spouseHome) {
            return;
        }

        // Keep the larger household put; the smaller side moves in (ties keep the subject's home).
        let target = subjectHome;
        let source = spouseHome;
        let moverSpouseId = spouseId;
        if (spouseHome.getResidents().length > subjectHome.getResidents().length) {
            target = spouseHome;
            source = subjectHome;
            moverSpouseId = subjectId;
        }

        const movers = [moverSpouseId, ...this.dependentMinorsInHouse(moverSpouseId, source, byGenId, pool, tick, ticksPerYear)];
        if (target.getResidents().length + movers.length > target.getOverview().maxResidents) {
            return; // neither home can hold the combined household — leave them put (housing market, future)
        }

        for (const moverId of movers) {
            this.relocateMember(moverId, byGenId, source, target);
        }
        this.announce('cohabited', tick, `${subject.social.getFullName()} and ${spouse.social.getFullName()} moved in together`, subject);
    }

    // Adult-child move-out (task 024): a grown child who leaves home (the `move_out` event, gated on a vacant
    // house being available) is relocated into that vacant house as a new single-person household, shrinking the
    // parental household. If the last vacant home was taken earlier the same day, the move is a no-op. Public for
    // unit testing; in production it runs from handleNewDay on the `movedOut` signal.
    public resolveMoveOut(personId: PersonId, tick: number): void {
        const byGenId = this.indexByGenId();
        const person = byGenId.get(personId);
        if (!person) {
            return;
        }
        const fromHouse = person.social.getHome();
        if (!(fromHouse instanceof House)) {
            return;
        }
        const vacant = this.findVacantHouse();
        if (!vacant) {
            return; // no home available (a same-day mover may have taken the last one)
        }

        this.removeFromHome(person, personId, fromHouse);
        vacant.addResident(person);
        vacant.addOccupant(person);
        person.social.setHome(vacant);
        vacant.setHousehold({
            id: `hh-${vacant.getIdentifier()}`,
            houseKey: vacant.getIdentifier(),
            headId: personId,
            memberIds: [personId],
            arrangement: HouseholdArrangements.Single,
        });
        // Now occupied → re-draw so it drops the vacant (desaturated) look.
        Game.emit("tileSpawned", vacant);
        this.announce('movedOut', tick, `${person.social.getFullName()} moved into their own place`, person);
    }

    // The lowest-keyed vacant house (no residents), or null — the destination for move-out (024) and the
    // recovery path for eviction (022). Deterministic by anchor key.
    private findVacantHouse(): House | null {
        const field = Game.field;
        if (!field) {
            return null;
        }
        let best: House | null = null;
        let bestKey = '';
        for (const structure of field.getStructures()) {
            if (structure instanceof House && structure.getResidents().length === 0) {
                const key = structure.getIdentifier();
                if (!best || key < bestKey) {
                    best = structure;
                    bestKey = key;
                }
            }
        }
        return best;
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


