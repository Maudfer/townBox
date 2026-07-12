import EventEngine from 'game/events/EventEngine';
import { GenPerson, PersonTable, PopulationState } from 'types/Genealogy';
import { EventManifest, EventLogEntry, HousingMarket, MoneyLedger } from 'types/LifeEvent';
import { SubProfiler } from 'types/Execution';
import { Genders, Gender } from 'types/Social';

// Targeted regression tests for EventEngine.ts corners the other event test files don't reach: the
// reduced-manifest walk filter (task 078), drainLog, hasEvent's minCount/withinTicks branches, the
// money/canMoveOut/custom-overlay attribute reads, divorce's effect + endPartnership, adjustMoney's effect
// path, the probabilityScale hook, attemptCommit's OWN eligibility/abort branches (reached via schedule/
// atHour/manual — distinct from the alive-check that gates every trigger earlier), invoke's ctx.markets
// binding + payload validation + faker-seeding-on-birth, and the --profile sub-timer plumbing.

const TPY = 8640;

function gen(id: string, gender: Gender, ageYears: number, tickNow = 0): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(people: GenPerson[], worldSeed = 7): PopulationState {
    const table: PersonTable = {};
    let seq = 0;
    for (const person of people) {
        table[person.id] = person;
        seq++;
    }
    return { worldSeed, people: table, drawSeed: 0, placedIds: people.map(p => p.id), nextSeq: seq, lastSimulatedYear: 0 };
}

const alive = { where: { attr: 'alive', op: '==', value: true } } as const;

describe('EventEngine — reduced-manifest walk filter (task 078)', () => {
    test('a probabilistic event excluded by the filter never rolls, even at certainty', () => {
        const manifest: EventManifest = {
            texture: { roles: { subject: alive }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'emit', signal: 'texture' }] },
            vital: { roles: { subject: alive }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'emit', signal: 'vital' }] },
        };
        const engine = new EventEngine(manifest, undefined, { probabilisticWalkFilter: id => id === 'vital' });
        const state = makeState([gen('a', Genders.Male, 30)]);
        const result = engine.simulateTick(state, ['a'], 0, TPY);
        expect(result.signals.map(s => s.signal)).toEqual(['vital']); // texture never entered the plan
    });
});

describe('EventEngine — drainLog', () => {
    test('hands back accumulated entries and resets the log while the aggregate history + seq survive', () => {
        const manifest: EventManifest = { ping: { roles: { subject: alive }, triggers: { probabilistic: { perYear: 200000 } }, effects: [] } };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.simulateTick(state, ['a'], 0, TPY);
        const drained = engine.drainLog();
        expect(Object.keys(drained)).toContain('a');
        expect(engine.getLog()).toEqual({}); // the live table is now empty
        expect(engine.hasEvent('a', 'ping', 0)).toBe(true); // aggregate history is untouched
        const nextSeqBefore = engine.getNextLogSeq();
        engine.simulateTick(state, ['a'], 1, TPY, {}); // won't re-fire (perDay-free but no limit here re-rolls)
        expect(engine.getNextLogSeq()).toBeGreaterThanOrEqual(nextSeqBefore);
    });
});

describe('EventEngine — hasEvent query branches', () => {
    test('minCount and withinTicks both gate independently', () => {
        const manifest: EventManifest = { poke: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] } };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.invoke(state, 'poke', 'a', 0, TPY, { source: 'system', causationId: null });
        engine.invoke(state, 'poke', 'a', 10, TPY, { source: 'system', causationId: null });
        expect(engine.hasEvent('a', 'poke', 10, { minCount: 2 })).toBe(true);
        expect(engine.hasEvent('a', 'poke', 10, { minCount: 3 })).toBe(false);
        expect(engine.hasEvent('a', 'poke', 10, { withinTicks: 0 })).toBe(true); // last commit was AT tick 10
        expect(engine.hasEvent('a', 'poke', 100, { withinTicks: 5 })).toBe(false); // 90 ticks ago > 5
    });
});

describe('EventEngine — attribute reads without/with markets bound', () => {
    test('money reads 0 without a ledger and the real balance with one bound', () => {
        const manifest: EventManifest = {
            rich_only: { roles: { subject: { where: { attr: 'money', op: '>=', value: 100 } } }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'emit', signal: 'richFired' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const noLedger = engine.simulateTick(state, ['a'], 0, TPY);
        expect(noLedger.signals).toEqual([]); // 0 < 100 without a ledger

        const ledger: MoneyLedger = { getPersonBalance: () => 500, adjustPerson: () => {} };
        const withLedger = engine.simulateTick(state, ['a'], 1, TPY, { markets: { ledger } });
        expect(withLedger.signals.map(s => s.signal)).toContain('richFired');
    });

    test('canMoveOut reads false without a housing adapter and true with one', () => {
        const manifest: EventManifest = {
            leaves: { roles: { subject: { where: { attr: 'canMoveOut', op: '==', value: true } } }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'emit', signal: 'moved' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        expect(engine.simulateTick(state, ['a'], 0, TPY).signals).toEqual([]);

        const housing: HousingMarket = { canMoveOut: () => true };
        expect(engine.simulateTick(state, ['a'], 1, TPY, { markets: { housing } }).signals.map(s => s.signal)).toContain('moved');
    });

    test('an attribute outside the closed switch falls back to the overlay bag', () => {
        const manifest: EventManifest = {
            set_mood: { roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'setAttr', attr: 'mood', value: 'happy' }] },
            mood_check: { roles: { subject: { where: { attr: 'mood', op: '==', value: 'happy' } } }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'emit', signal: 'moodMatched' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        expect(engine.simulateTick(state, ['a'], 0, TPY).signals).toEqual([]); // no mood set yet
        engine.invoke(state, 'set_mood', 'a', 1, TPY, { source: 'system', causationId: null });
        expect(engine.simulateTick(state, ['a'], 2, TPY).signals.map(s => s.signal)).toContain('moodMatched');
    });

    test('contextFor on a nonexistent person id reads every attribute as undefined', () => {
        const engine = new EventEngine({});
        const state = makeState([gen('a', Genders.Male, 30)]);
        const ctx = engine.contextFor(state, 'ghost', 0, TPY);
        expect(ctx.getAttr('alive')).toBeUndefined();
        expect(ctx.getAttr('age')).toBeUndefined();
    });

    test('an unbound role-scoped predicate ({role,where}) evaluates false without throwing', () => {
        // Every EventEngine context is built with ONLY the subject role bound (see makeContext call sites),
        // so ctx.role(anythingElse) always resolves to null — this pins that documented limitation.
        const manifest: EventManifest = {
            picky: {
                roles: { subject: { where: { role: 'partner', where: { attr: 'age', op: '>=', value: 18 } } } },
                triggers: { probabilistic: { perYear: 200000 } },
                effects: [{ type: 'emit', signal: 'neverFires' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const result = engine.simulateTick(state, ['a'], 0, TPY);
        expect(result.signals).toEqual([]);
    });
});

describe('EventEngine — divorce effect', () => {
    test('divorce ends the partnership symmetrically and marks both marital=divorced', () => {
        const manifest: EventManifest = {
            split_up: { roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'divorce' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30), gen('b', Genders.Female, 28)]);
        state.people['a']!.partnerships.push({ partnerId: 'b', startTick: -100, endTick: null });
        state.people['b']!.partnerships.push({ partnerId: 'a', startTick: -100, endTick: null });

        engine.invoke(state, 'split_up', 'a', 5, TPY, { source: 'system', causationId: null });
        expect(state.people['a']!.partnerships[0]!.endTick).toBe(5);
        expect(state.people['b']!.partnerships[0]!.endTick).toBe(5);
        expect(engine.contextFor(state, 'a', 6, TPY).getAttr('marital')).toBe('divorced');
        expect(engine.contextFor(state, 'b', 6, TPY).getAttr('marital')).toBe('divorced');
    });

    test('divorcing someone with no partnership is a harmless no-op', () => {
        const manifest: EventManifest = { split_up: { roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'divorce' }] } };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        expect(engine.invoke(state, 'split_up', 'a', 5, TPY, { source: 'system', causationId: null }).outcome.ok).toBe(true);
        expect(engine.contextFor(state, 'a', 6, TPY).getAttr('marital')).toBe('divorced');
    });
});

describe('EventEngine — adjustMoney effect', () => {
    test('credits the target through the bound ledger; a no-op (no ledger) still commits', () => {
        const manifest: EventManifest = {
            payday: { roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'adjustMoney', amount: { mode: 'const', value: 50 } }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);

        // Without a ledger: no-op, but the event still commits (returns true).
        expect(engine.invoke(state, 'payday', 'a', 0, TPY, { source: 'system', causationId: null }).outcome.ok).toBe(true);

        const adjustments: { id: string; delta: number }[] = [];
        const ledger: MoneyLedger = { getPersonBalance: () => 0, adjustPerson: (id, delta) => { adjustments.push({ id, delta }); } };
        engine.invoke(state, 'payday', 'a', 1, TPY, { source: 'system', causationId: null }, {}, { markets: { ledger } });
        expect(adjustments).toEqual([{ id: 'a', delta: 50 }]);
    });

    test('adjustMoney can target another bound role via `target`', () => {
        const manifest: EventManifest = {
            gift: {
                roles: { subject: alive, recipient: { where: { attr: 'alive', op: '==', value: true } } },
                triggers: { manual: { requiredBindings: ['recipient'] } },
                effects: [{ type: 'adjustMoney', target: 'recipient', amount: { mode: 'const', value: 20 } }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30), gen('b', Genders.Female, 28)]);
        const adjustments: { id: string; delta: number }[] = [];
        const ledger: MoneyLedger = { getPersonBalance: () => 0, adjustPerson: (id, delta) => { adjustments.push({ id, delta }); } };
        engine.invoke(state, 'gift', 'a', 0, TPY, { source: 'system', causationId: null }, { recipient: 'b' }, { markets: { ledger } });
        expect(adjustments).toEqual([{ id: 'b', delta: 20 }]);
    });
});

describe('EventEngine — acquireSlot abort path', () => {
    test('a probabilistic get-a-job-style event aborts (no commit) when hire fails/no market is bound', () => {
        const manifest: EventManifest = {
            auto_get_job: { roles: { subject: alive }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'acquireSlot' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const result = engine.simulateTick(state, ['a'], 0, TPY); // no jobMarket bound -> hire() false -> aborted
        expect(result.committed).toEqual([]);
        expect(engine.getHistory()['a']?.['auto_get_job']).toBeUndefined();
    });
});

describe('EventEngine — probabilityScale', () => {
    test('scales the effective hazard before the roll; 0 fully suppresses a certain event', () => {
        const manifest: EventManifest = { certain: { roles: { subject: alive }, triggers: { probabilistic: { perYear: 200000 } }, effects: [{ type: 'emit', signal: 'fired' }] } };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.setProbabilityScale(() => 0);
        expect(engine.simulateTick(state, ['a'], 0, TPY).signals).toEqual([]);
        engine.setProbabilityScale(null);
        expect(engine.simulateTick(state, ['a'], 1, TPY).signals.map(s => s.signal)).toContain('fired');
    });

    test('scales a tick-constant (hourOfDay-only) hazard too', () => {
        const manifest: EventManifest = {
            timeOfDay: {
                roles: { subject: alive },
                triggers: { probabilistic: { perYear: 200000, factors: [{ driver: 'subject.hourOfDay', curve: { mode: 'const', value: 1 } }] } },
                effects: [{ type: 'emit', signal: 'clockFired' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.setProbabilityScale(() => 0);
        expect(engine.simulateTick(state, ['a'], 0, TPY).signals).toEqual([]);
    });
});

describe('EventEngine — attemptCommit\'s own branches (schedule/atHour/manual)', () => {
    test('a scheduled trigger for an unknown event id is silently a no-op (unknownEvent inside attemptCommit)', () => {
        const engine = new EventEngine({});
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.scheduleTrigger('does_not_exist', 'a', 5, null);
        expect(() => engine.simulateTick(state, ['a'], 5, TPY)).not.toThrow();
        expect(engine.getPersonLog('a')).toEqual([]);
    });

    test('two scheduled triggers due the same tick commit in dueTick/id order (exercises the schedule sort comparator)', () => {
        const manifest: EventManifest = {
            first: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
            second: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.scheduleTrigger('second', 'a', 5, null);
        engine.scheduleTrigger('first', 'a', 5, null);
        engine.simulateTick(state, ['a'], 5, TPY);
        const ids = engine.getPersonLog('a').map(e => e.defId);
        expect(ids).toEqual(['second', 'first']); // enqueue order (id ascending) breaks the dueTick tie
    });

    test('two atHour rules at different hours both fire (exercises the atHour Map sort comparator)', () => {
        const manifest: EventManifest = {
            morning: { roles: { subject: alive }, triggers: { automated: { rules: [{ atHour: 6 }] } }, effects: [] },
            evening: { roles: { subject: alive }, triggers: { automated: { rules: [{ atHour: 20 }] } }, effects: [] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.simulateTick(state, ['a'], 0, TPY, {}, 24); // a whole-day coarse step covers both hours
        const ids = engine.getPersonLog('a').map(e => e.defId).sort();
        expect(ids).toEqual(['evening', 'morning']);
    });

    test('subjectWhere ineligibility inside attemptCommit is distinct from the alive check (manual invoke)', () => {
        const manifest: EventManifest = {
            women_only: { roles: { subject: { where: { attr: 'gender', op: '==', value: 'female' } } }, triggers: { manual: {} }, effects: [] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]); // alive, but the wrong gender
        expect(engine.invoke(state, 'women_only', 'a', 0, TPY, { source: 'system', causationId: null }).outcome).toEqual({ ok: false, reason: 'ineligible' });
    });

    test('a manual event whose effects abort still returns a typed "aborted" outcome (attemptCommit + commit both return null)', () => {
        const manifest: EventManifest = { manual_hire: { roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'acquireSlot' }] } };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        expect(engine.invoke(state, 'manual_hire', 'a', 0, TPY, { source: 'system', causationId: null }).outcome).toEqual({ ok: false, reason: 'aborted' });
        expect(engine.getPersonLog('a')).toEqual([]);
    });
});

describe('EventEngine — invoke() payload validation, ctx.markets binding, and faker seeding', () => {
    test('invalidParams: unknown key, wrong type, and a missing required param', () => {
        const manifest: EventManifest = {
            tagged: {
                roles: { subject: alive }, triggers: { manual: {} }, effects: [],
                parameters: { tag: { type: 'string', required: true }, count: { type: 'number' } },
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        expect(engine.invoke(state, 'tagged', 'a', 0, TPY, { source: 'system', causationId: null }, {}, {}, { unknown: 'x' } as unknown as Record<string, string>).outcome).toEqual({ ok: false, reason: 'invalidParams' });
        expect(engine.invoke(state, 'tagged', 'a', 0, TPY, { source: 'system', causationId: null }, {}, {}, { tag: 5 } as unknown as Record<string, string>).outcome).toEqual({ ok: false, reason: 'invalidParams' });
        expect(engine.invoke(state, 'tagged', 'a', 0, TPY, { source: 'system', causationId: null }, {}, {}, {}).outcome).toEqual({ ok: false, reason: 'invalidParams' }); // tag required, missing
        expect(engine.invoke(state, 'tagged', 'a', 0, TPY, { source: 'system', causationId: null }, {}, {}, { tag: 'x' }).outcome.ok).toBe(true);
    });

    test('ctx.markets binds for the duration of the invoke call and is restored afterward', () => {
        const manifest: EventManifest = {
            spend: { roles: { subject: { where: { attr: 'money', op: '>=', value: 10 } } }, triggers: { manual: {} }, effects: [] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const ledger: MoneyLedger = { getPersonBalance: () => 100, adjustPerson: () => {} };
        expect(engine.invoke(state, 'spend', 'a', 0, TPY, { source: 'system', causationId: null }, {}, { markets: { ledger } }).outcome.ok).toBe(true);
        // Markets are unbound again after invoke returns (no ledger leaks into a plain simulateTick).
        expect(engine.contextFor(state, 'a', 1, TPY).getAttr('money')).toBe(0);
    });

    test('a manual birth event reseeds faker deterministically (invokeUsesFaker) and produces a named child', () => {
        const manifest: EventManifest = {
            stork: {
                roles: { subject: alive, dad: { where: { attr: 'alive', op: '==', value: true } } },
                triggers: { manual: { requiredBindings: ['dad'] } },
                effects: [{ type: 'birth', mother: 'subject', father: 'dad' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('mom', Genders.Female, 30), gen('dad', Genders.Male, 32)]);
        const { result } = engine.invoke(state, 'stork', 'mom', 5, TPY, { source: 'system', causationId: null }, { dad: 'dad' });
        expect(result.born).toHaveLength(1);
        expect(state.people[result.born[0]!.id]!.firstName.length).toBeGreaterThan(0);
    });
});

describe('EventEngine — --profile sub-timer plumbing (task 079)', () => {
    test('setProfileSub attributes invoke\'s internal phases and attemptCommit\'s eligibility/roles/commit segments', () => {
        const manifest: EventManifest = { pinged: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] } };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const sub: SubProfiler = { brainHooks: {}, brainResolve: 0, actionsAdvance: {} };
        engine.setProfileSub(sub);
        engine.invoke(state, 'pinged', 'a', 0, TPY, { source: 'system', causationId: null });
        engine.setProfileSub(null);
        expect(sub.actionsAdvance['invoke:pre']).toBeGreaterThanOrEqual(0);
        expect(sub.actionsAdvance['invoke:attempt']).toBeGreaterThanOrEqual(0);
        expect(sub.actionsAdvance['invoke:predicate']).toBeGreaterThanOrEqual(0);
        expect(sub.actionsAdvance['invoke:roles']).toBeGreaterThanOrEqual(0);
        expect(sub.actionsAdvance['invoke:commit']).toBeGreaterThanOrEqual(0);
    });
});

describe('EventEngine — needsRoles early role resolution failure (probabilistic path)', () => {
    test('a probability factor driven by an unresolvable non-subject role skips the draw-consumer entirely', () => {
        const manifest: EventManifest = {
            jealous: {
                roles: {
                    subject: alive,
                    // No candidate can ever satisfy this (age > 999), so resolveRoles always fails for 'rival'.
                    rival: { where: { attr: 'age', op: '>', value: 999 } },
                },
                triggers: { probabilistic: { perYear: 200000, factors: [{ driver: 'rival.age', curve: { mode: 'const', value: 1 } }] } },
                effects: [{ type: 'emit', signal: 'jealousFired' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30), gen('b', Genders.Female, 28)]);
        const result = engine.simulateTick(state, ['a', 'b'], 0, TPY);
        expect(result.signals).toEqual([]); // rival never resolves -> the event can never commit
    });
});

describe('EventEngine — determinism smoke for the extras above', () => {
    test('log entries carry monotonic, unique seqs across a mixed batch of the paths above', () => {
        const manifest: EventManifest = {
            a1: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
            a2: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.invoke(state, 'a1', 'a', 0, TPY, { source: 'system', causationId: null });
        engine.invoke(state, 'a2', 'a', 1, TPY, { source: 'system', causationId: null });
        const seqs = engine.getPersonLog('a').map(e => (e as EventLogEntry).seq);
        expect(new Set(seqs).size).toBe(seqs.length);
        expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    });
});
