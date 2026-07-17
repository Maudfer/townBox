// Task 121 — the headless city systems: the off-map analogues of City's signal handlers and day sweeps
// (cohabitation, move-out, garbage collection, wages/cost-of-living, pets, gossip, visit counterparts,
// justice plumbing). These close the headless-gap sweep's findings: the generator used to drop every
// signal City reacts to, so crimes were never filed, adoptions never registered, newlyweds never shared a
// home, and money read 0 for everyone.

import EventEngine from 'game/events/EventEngine';
import LogicalWorld from 'game/history/LogicalWorld';
import { DEFAULT_ECONOMY_PARAMS } from 'game/economy/Economy';
import { PETS_CONFIG } from 'game/population/PetRegistry';
import SkillBook from 'game/skills/SkillBook';
import { GenPerson, PersonId, PopulationState } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';
import { TICKS_PER_YEAR } from 'util/time';

const TPY = TICKS_PER_YEAR;

function gen(id: string, opts: { age?: number; gender?: GenPerson['gender']; spouse?: string; motherId?: string; fatherId?: string } = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender: opts.gender ?? Genders.Female,
        birthTick: -(opts.age ?? 30) * TPY, deathTick: null,
        fatherId: opts.fatherId ?? null, motherId: opts.motherId ?? null,
        partnerships: opts.spouse ? [{ partnerId: opts.spouse, startTick: 0, endTick: null }] : [],
    };
}

function poolWith(records: PopulationState['people']): PopulationState {
    return { worldSeed: 7, people: records, drawSeed: 0, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

function emptyResult(): TickResult {
    return { died: [], born: [], signals: [], committed: [] };
}

const homeOf = (world: LogicalWorld, id: PersonId): string => (world.locationOf(id) as { key: string }).key;

describe('household churn (cohabitation + move-out)', () => {
    test('cohabit: the larger household stays, the mover brings dependent minors', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        // Enter everyone UNMARRIED so they get separate homes; kid lives with mom.
        const state = poolWith({
            mom: gen('mom'), dad: gen('dad', { gender: Genders.Male }),
            kid: gen('kid', { age: 6, motherId: 'mom' }),
        });
        world.assignHome('mom', state.people);
        world.assignHome('kid', state.people); // joins mom (parent rule)
        world.assignHome('dad', state.people);
        expect(homeOf(world, 'dad')).not.toBe(homeOf(world, 'mom'));
        // They marry (the pairing path mutates the pool directly), then the caller runs cohabitation.
        state.people['mom']!.partnerships.push({ partnerId: 'dad', startTick: 10, endTick: null });
        state.people['dad']!.partnerships.push({ partnerId: 'mom', startTick: 10, endTick: null });
        world.cohabit(state, 'mom', 10, TPY);
        // Mom's household (mom+kid, 2) is larger than dad's (1) — dad moves in.
        expect(homeOf(world, 'dad')).toBe(homeOf(world, 'mom'));
        expect(homeOf(world, 'kid')).toBe(homeOf(world, 'mom'));
    });

    test('a moved_out_of_parents commit relocates an adult child (and their own minors) to a fresh home', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({
            parent: gen('parent', { age: 55 }),
            adultChild: gen('adultChild', { age: 24, motherId: 'parent' }),
            grandkid: gen('grandkid', { age: 2, motherId: 'adultChild' }),
            lodger: gen('lodger', { age: 30 }),
        });
        const engine = new EventEngine();
        for (const id of ['parent', 'adultChild', 'grandkid', 'lodger']) {
            world.assignHome(id, state.people);
        }
        const parentalHome = homeOf(world, 'parent');
        expect(homeOf(world, 'adultChild')).toBe(parentalHome);
        const result = emptyResult();
        result.committed.push({ personId: 'adultChild', eventId: 'moved_out_of_parents', seq: 1 });
        // The lodger's commit is a no-op: they do not live with a living parent.
        result.committed.push({ personId: 'lodger', eventId: 'moved_out_of_parents', seq: 2 });
        world.handleTickOutcomes(state, engine, result, 20, TPY);
        expect(homeOf(world, 'adultChild')).not.toBe(parentalHome);
        expect(homeOf(world, 'grandkid')).toBe(homeOf(world, 'adultChild')); // the minor came along
        expect(homeOf(world, 'parent')).toBe(parentalHome);
        expect(homeOf(world, 'lodger')).toBe(homeOf(world, 'lodger')); // unchanged shape (own home)
    });
});

describe('the garbage collection sweep', () => {
    test('curbside bags are collected daily; bags still at home are not', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({ p: gen('p') });
        world.assignHome('p', state.people);
        const engine = new EventEngine();
        const home = homeOf(world, 'p');
        world.inventory.createInstance({ archetypeId: 'bag_of_garbage', owner: { kind: 'none' }, container: { kind: 'location', key: 'outside' }, tick: 0 });
        const atHome = world.inventory.createInstance({ archetypeId: 'bag_of_garbage', owner: { kind: 'none' }, container: { kind: 'location', key: home }, tick: 0 });
        world.runDaily(state, 24, 48, TPY, new SkillBook(), engine, new Set(['p']));
        expect(world.inventory.matchingIdsAtLocation('outside', { archetype: 'bag_of_garbage' })).toHaveLength(0);
        expect(world.inventory.getInstance(atHome.id)).not.toBeNull(); // the home bag awaits trash day
    });
});

describe('the monthly money loop', () => {
    test('adults arrive with the starting stake; wages and cost of living flow; the money total is conserved', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({ adult: gen('adult', { age: 30 }), babe: gen('babe', { age: 0, motherId: 'adult' }) });
        const skillBook = new SkillBook();
        world.onEnter('adult', 30, -30 * TPY, 0, skillBook, state.people);
        world.onEnter('babe', 0, 0, 0, skillBook, state.people);
        expect(world.economy.getPersonBalance('adult')).toBe(DEFAULT_ECONOMY_PARAMS.startingPersonFunds);
        expect(world.economy.getPersonBalance('babe')).toBe(0);

        const before = world.economy.getPersonBalance('adult');
        world.runMonthlyEconomy(state, 720, TPY, new Set(['adult', 'babe']));
        // No job market in this fixture: only the cost of living moved (housing + per-capita × 2 members).
        const col = DEFAULT_ECONOMY_PARAMS.housingCost + DEFAULT_ECONOMY_PARAMS.perCapitaCost * 2;
        expect(world.economy.getPersonBalance('adult')).toBe(before - col);
        // Conservation: every one-sided flow is external-mirrored, so the grand total stays at zero.
        expect(world.economy.getPersonBalance('adult') + world.economy.getPersonBalance('babe') + world.economy.getExternalBalance()).toBe(0);
    });
});

describe('pets, gossip and visit counterparts', () => {
    test('a petAdopted signal registers a real capped pet; lifespan ends it with the grief milestone', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({ owner: gen('owner') });
        world.assignHome('owner', state.people);
        const engine = new EventEngine();
        const adopt = (): void => {
            const result = emptyResult();
            result.signals.push({ signal: 'petAdopted', personId: 'owner', tick: 0, eventId: 'adopted_a_pet', causationId: 1 });
            world.handleTickOutcomes(state, engine, result, 0, TPY);
        };
        for (let i = 0; i < PETS_CONFIG.maxPerOwner + 2; i++) {
            adopt();
        }
        expect(world.pets.countOf('owner')).toBe(PETS_CONFIG.maxPerOwner); // cap enforced
        // The species milestone landed in the log.
        const log = engine.getPersonLog('owner');
        expect(log.some(entry => entry.kind === 'event' && entry.defId.startsWith('adopted_'))).toBe(true);

        // Fast-forward far past every lifespan: the daily roll eventually takes each companion.
        let tick = Math.ceil(20 * TPY);
        for (let day = 0; day < 600 && world.pets.countOf('owner') > 0; day++, tick += 24) {
            world.runDaily(state, tick, tick + 24, TPY, new SkillBook(), engine, new Set(['owner']));
        }
        expect(world.pets.countOf('owner')).toBe(0);
        expect(engine.getPersonLog('owner').some(entry => entry.kind === 'event' && entry.defId === 'pet_passed_away')).toBe(true);
    });

    test('shared_gossip transfers the juiciest fact; a sick visit lands the patient counterpart', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({ speaker: gen('speaker'), listener: gen('listener'), sickie: gen('sickie') });
        const engine = new EventEngine();
        for (const id of ['speaker', 'listener', 'sickie']) {
            world.assignHome(id, state.people);
        }
        world.knownFacts.learn('speaker', { aboutId: 'sickie', seq: 5, eventId: 'witnessed_a_scene', valence: -2, learnedAtTick: 0, viaWitness: true });
        const result = emptyResult();
        result.committed.push({ personId: 'speaker', eventId: 'shared_gossip', seq: 9, params: { target: 'listener' } });
        result.committed.push({ personId: 'speaker', eventId: 'visited_sick_relative', seq: 10, params: { target: 'sickie' } });
        world.handleTickOutcomes(state, engine, result, 10, TPY);
        expect(world.knownFacts.factsOf('listener', 10).some(fact => fact.aboutId === 'sickie')).toBe(true);
        expect(engine.getPersonLog('sickie').some(entry => entry.kind === 'event' && entry.defId === 'was_visited_while_sick')).toBe(true);
    });
});

describe('the justice plumbing', () => {
    test('a filed case either resolves (conviction milestones + fine) or goes cold (impunity) — deterministically', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({ crook: gen('crook', { age: 30 }) });
        const skillBook = new SkillBook();
        world.onEnter('crook', 30, -30 * TPY, 0, skillBook, state.people);
        const engine = new EventEngine();
        const balanceBefore = world.economy.getPersonBalance('crook');
        world.incidents.report('shoplifting', 0, 'somewhere', 'crook', 3);
        let tick = 24;
        for (let day = 0; day < 40 && world.incidents.open().length > 0; day++, tick += 24) {
            world.runDaily(state, tick, tick + 24, TPY, skillBook, engine, new Set(['crook']));
        }
        expect(world.incidents.open()).toHaveLength(0); // resolved or cold within the window
        const log = engine.getPersonLog('crook');
        const caught = log.some(entry => entry.kind === 'event' && entry.defId === 'got_caught');
        const gotAway = log.some(entry => entry.kind === 'event' && entry.defId === 'got_away_with_it');
        expect(caught || gotAway).toBe(true);
        if (caught) {
            expect(world.economy.getPersonBalance('crook')).toBe(balanceBefore - DEFAULT_ECONOMY_PARAMS.crimeFineAmount);
        }
    });

    test('detention round-trip: detain → detentionOf facts → the release sweep frees and logs', () => {
        const world = new LogicalWorld(7, { homes: true, schools: false, jobs: false, objects: false });
        const state = poolWith({ con: gen('con', { age: 30 }) });
        world.assignHome('con', state.people);
        const engine = new EventEngine();
        world.detention.detain('con', 48, 'facility:police_station');
        expect(world.detentionOf('con')).toEqual({ locationKey: 'facility:police_station' });
        world.runDaily(state, 72, 96, TPY, new SkillBook(), engine, new Set(['con'])); // past untilTick
        expect(world.detentionOf('con')).toBeNull();
        expect(engine.getPersonLog('con').some(entry => entry.kind === 'event' && entry.defId === 'released_from_jail')).toBe(true);
    });
});
