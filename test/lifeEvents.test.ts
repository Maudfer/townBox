import EventEngine from '../src/app/game/EventEngine';
import SkillRegistry from '../src/app/game/SkillRegistry';
import Person from '../src/app/game/Person';

import { Genders, Gender } from '../src/types/Social';
import { JobRequirements } from '../src/types/Work';
import { GenPerson, PersonId, PersonTable, PopulationState } from '../src/types/Genealogy';
import { EventManifest, JobMarket } from '../src/types/LifeEvent';

const TPY = 360;

function gen(id: string, gender: Gender, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(people: GenPerson[], worldSeed = 7): PopulationState {
    const table: PersonTable = {};
    for (const person of people) {
        table[person.id] = person;
    }
    return { worldSeed, people: table, drawSeed: 0, placedIds: people.map(p => p.id), nextSeq: people.length, lastSimulatedYear: 0 };
}

describe('Life events — health attribute (task 032)', () => {
    test('falling ill lowers health so the same person is no longer eligible to fall ill again', () => {
        const manifest: EventManifest = {
            fell_ill: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'health', op: '>=', value: 1 }] } } },
                probability: { perYear: 1 },
                effects: [{ type: 'setAttr', attr: 'health', value: 0.5 }, { type: 'emit', signal: 'fellIll', target: 'subject' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 40)]);

        const day0 = engine.simulateDay(state, ['a'], 0, TPY);
        expect(day0.signals.map(s => s.signal)).toContain('fellIll');

        const day1 = engine.simulateDay(state, ['a'], 1, TPY);
        expect(day1.signals.map(s => s.signal)).not.toContain('fellIll'); // health is 0.5 now, predicate health>=1 fails
    });

    test('low health raises death probability (health gradient drives the death event)', () => {
        const manifest: EventManifest = {
            // Healthy (health >= 0.95) → factor 0 → never dies; once sick → factor 1 → certain that day.
            death: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
                probability: { perYear: 1, factors: [{ driver: 'subject.health', curve: { mode: 'step', points: [{ at: 0, value: 1 }, { at: 0.95, value: 0 }] } }] },
                effects: [{ type: 'setDeath' }],
            },
            fell_ill: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'health', op: '>=', value: 1 }] } } },
                probability: { perYear: 1 },
                effects: [{ type: 'setAttr', attr: 'health', value: 0.5 }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 40)]);

        // Day 0: death runs first while healthy (factor 0 → survives), then fell_ill lowers health to 0.5.
        const day0 = engine.simulateDay(state, ['a'], 0, TPY);
        expect(day0.died).toEqual([]);

        // Day 1: now sick, the health gradient makes death certain.
        const day1 = engine.simulateDay(state, ['a'], 1, TPY);
        expect(day1.died).toEqual(['a']);
    });
});

describe('Life events — acquireSkill effect (task 032)', () => {
    test('SkillRegistry grants a valid, not-yet-held skill once', () => {
        const person = new Person(0, 0);
        const registry = new SkillRegistry(new Map<PersonId, Person>([['a', person]]));

        expect(registry.acquireSkill('a', 'MedicalSkill')).toBe(true);
        expect(person.work.getSkills()).toContain(JobRequirements.MedicalSkill);
        expect(registry.acquireSkill('a', 'MedicalSkill')).toBe(false); // already held
        expect(registry.acquireSkill('a', 'NotASkill')).toBe(false); // unknown skill
        expect(registry.acquireSkill('missing', 'MedicalSkill')).toBe(false); // unknown person
    });

    test('an education event grants the skill through the engine adapter', () => {
        const manifest: EventManifest = {
            nursing_school: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
                probability: { perYear: 1 },
                effects: [{ type: 'acquireSkill', value: 'MedicalSkill', target: 'subject' }, { type: 'emit', signal: 'graduated', target: 'subject' }],
            },
        };
        const engine = new EventEngine(manifest);
        const person = new Person(0, 0);
        const registry = new SkillRegistry(new Map<PersonId, Person>([['a', person]]));
        const state = makeState([gen('a', Genders.Female, 24)]);

        const result = engine.simulateDay(state, ['a'], 0, TPY, { skills: registry });

        expect(result.signals.map(s => s.signal)).toContain('graduated');
        expect(person.work.getSkills()).toContain(JobRequirements.MedicalSkill);
    });
});

describe('Life events — retirement (task 032)', () => {
    test('retirement releases the job slot and emits a signal', () => {
        const fired: string[] = [];
        const jobMarket: JobMarket = {
            isEmployed: () => true,
            canHire: () => false,
            hire: () => false,
            fire: (id: string) => { fired.push(id); },
        };
        const manifest: EventManifest = {
            retirement: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '>=', value: 65 }, { attr: 'employed', op: '==', value: true }] } } },
                probability: { perYear: 1 },
                effects: [{ type: 'releaseSlot', resource: 'job', target: 'subject' }, { type: 'setAttr', attr: 'retired', value: true }, { type: 'emit', signal: 'retired', target: 'subject' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 70)]);

        const result = engine.simulateDay(state, ['a'], 0, TPY, { jobMarket });

        expect(fired).toEqual(['a']);
        expect(result.signals.map(s => s.signal)).toContain('retired');
    });
});

describe('Life events — real manifest (task 032)', () => {
    test('compiles with no warnings and derives retirement→get_job exclusivity', () => {
        const engine = new EventEngine();
        const graph = engine.getGraph();
        expect(graph.warnings).toEqual([]);
        // Retirement sets retired=true; get_job requires retired==false → derived exclusivity.
        expect(graph.excludes['retirement']).toContain('get_job');
    });

    test('exposes authored labels, falling back to a prettified id', () => {
        const engine = new EventEngine();
        expect(engine.getEventLabel('fell_ill')).toBe('Fell ill');
        expect(engine.getEventLabel('trade_school')).toBe('Finished trade school');
        expect(engine.getEventLabel('made_up_event')).toBe('Made Up Event');
    });
});
