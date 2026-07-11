import EventEngine from 'game/events/EventEngine';
import { EventManifest, EventLogEntry } from 'types/LifeEvent';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { Genders, Gender } from 'types/Social';

// Event triggers (task 042): manual invocation, automated schedule rules (afterEvent delays, atHour sweeps),
// occurrence limits, and causation/source recording — all through the same commit path.

const TPY = 8640;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(tickNow: number): PopulationState {
    return {
        worldSeed: 21,
        people: { a: gen('a', Genders.Female, 30, tickNow), b: gen('b', Genders.Male, 35, tickNow) },
        drawSeed: 1,
        placedIds: [],
        nextSeq: 100,
        lastSimulatedYear: 0,
    };
}

const alive = { where: { attr: 'alive', op: '==', value: true } };

const MANIFEST: EventManifest = {
    // Manual-only: committed by code (an Action, a shift rule); never rolls.
    started_working: {
        label: 'Started working',
        roles: { subject: alive },
        triggers: { manual: {} },
        effects: [{ type: 'emit', signal: 'hired', target: 'subject' }],
    },
    // Manual with a required binding + an automated fallback 8 ticks after started_working.
    stopped_working: {
        label: 'Stopped working',
        roles: { subject: alive },
        triggers: { manual: {}, automated: { rules: [{ afterEvent: 'started_working', delayTicks: 8 }] } },
        effects: [],
    },
    // Manual social event requiring the caller to pin the target.
    gave_gift: {
        roles: { subject: alive, recipient: { where: { attr: 'alive', op: '==', value: true } } },
        triggers: { manual: { requiredBindings: ['recipient'] } },
        effects: [],
    },
    // Manual event with an UNPINNED co-participant `where` role — invoke must build the living-agent list and
    // resolve the friend via candidate search (task 079: the fast-path skips that build only for subject-only
    // events; a where-role event must still search).
    found_friend: {
        roles: { subject: alive, friend: { where: { attr: 'alive', op: '==', value: true } } },
        triggers: { manual: {} },
        effects: [{ type: 'emit', signal: 'befriended', target: 'friend' }],
    },
    // Automated atHour rule: fires daily at 07:00 for every eligible subject, limited to once per day.
    woke_up: {
        roles: { subject: alive },
        triggers: { automated: { rules: [{ atHour: 7 }] } },
        limit: { once: 'perDay' },
        effects: [],
    },
    // Probabilistic certainty, limited to once ever.
    first_steps: {
        roles: { subject: alive },
        triggers: { probabilistic: { perYear: 200000 } },
        limit: { once: 'ever' },
        effects: [],
    },
    // Probabilistic certainty with a cooldown window.
    strolled: {
        roles: { subject: alive },
        triggers: { probabilistic: { perYear: 200000 } },
        limit: { withinTicks: 3 },
        effects: [],
    },
} as unknown as EventManifest;

describe('manual invocation (task 042)', () => {
    test('a manual event commits with the caller source and causation, and returns the seq', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        const { outcome, result } = engine.invoke(state, 'started_working', 'a', 1000, TPY, { source: 'action', causationId: 77 });
        expect(outcome).toEqual({ ok: true, seq: 0 });
        expect(engine.getPersonLog('a')[0]).toMatchObject({ defId: 'started_working', triggerSource: 'action', causationId: 77, tick: 1000 });
        // Signals flow to the caller with the commit as causation.
        expect(result.signals[0]).toMatchObject({ signal: 'hired', eventId: 'started_working', causationId: 0 });
    });

    test('rejections are typed: unknown, not-manual, missing binding, ineligible', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        expect(engine.invoke(state, 'ghost', 'a', 1000, TPY, { source: 'action', causationId: null }).outcome).toEqual({ ok: false, reason: 'unknownEvent' });
        expect(engine.invoke(state, 'first_steps', 'a', 1000, TPY, { source: 'action', causationId: null }).outcome).toEqual({ ok: false, reason: 'notManual' });
        expect(engine.invoke(state, 'gave_gift', 'a', 1000, TPY, { source: 'action', causationId: null }).outcome).toEqual({ ok: false, reason: 'missingBinding' });

        state.people['a']!.deathTick = 900; // dead subjects are ineligible
        expect(engine.invoke(state, 'started_working', 'a', 1000, TPY, { source: 'action', causationId: null }).outcome).toEqual({ ok: false, reason: 'ineligible' });
    });

    test('caller bindings pin roles (and are recorded in the log entry)', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        const { outcome } = engine.invoke(state, 'gave_gift', 'a', 1000, TPY, { source: 'brain', causationId: null }, { recipient: 'b' });
        expect(outcome.ok).toBe(true);
        expect((engine.getPersonLog('a')[0] as EventLogEntry).roles).toEqual({ subject: 'a', recipient: 'b' });
        // A dead pinned target fails role resolution.
        state.people['b']!.deathTick = 900;
        expect(engine.invoke(state, 'gave_gift', 'a', 1001, TPY, { source: 'brain', causationId: null }, { recipient: 'b' }).outcome).toEqual({ ok: false, reason: 'rolesUnresolved' });
    });

    test('an unpinned where-role is resolved by candidate search (invoke builds the agent list)', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        const { outcome, result } = engine.invoke(state, 'found_friend', 'a', 1000, TPY, { source: 'brain', causationId: null });
        expect(outcome.ok).toBe(true);
        // 'b' is the only other living candidate → the search binds it (fails to 'rolesUnresolved' if the
        // living-agent list weren't built for this where-role event).
        expect((engine.getPersonLog('a')[0] as EventLogEntry).roles).toEqual({ subject: 'a', friend: 'b' });
        expect(result.signals[0]).toMatchObject({ signal: 'befriended' });
        // With no other living candidate, the same search finds nobody → typed rejection.
        state.people['b']!.deathTick = 900;
        expect(engine.invoke(state, 'found_friend', 'a', 1001, TPY, { source: 'brain', causationId: null }).outcome).toEqual({ ok: false, reason: 'rolesUnresolved' });
    });
});

describe('automated triggers (task 042)', () => {
    test('afterEvent rules enqueue on commit and fire after the delay with schedule source + causation chain', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        engine.invoke(state, 'started_working', 'a', 1000, TPY, { source: 'action', causationId: null });
        expect(engine.getScheduleState().queue).toHaveLength(1);
        expect(engine.getScheduleState().queue[0]).toMatchObject({ eventId: 'stopped_working', subjectId: 'a', dueTick: 1008, causationId: 0 });

        // Not due yet: nothing fires at 1007.
        engine.simulateTick(state, ['a', 'b'], 1007, TPY, {});
        expect(engine.getHistory()['a']?.['stopped_working']).toBeUndefined();

        // Due at 1008: fires once, queue drains, causation chains to the started_working commit.
        engine.simulateTick(state, ['a', 'b'], 1008, TPY, {});
        const entry = engine.getPersonLog('a').find(e => e.defId === 'stopped_working')!;
        expect(entry).toMatchObject({ triggerSource: 'schedule', causationId: 0, tick: 1008 });
        expect(engine.getScheduleState().queue).toHaveLength(0);
    });

    test('programmatic scheduling works for any event and survives a state round-trip', () => {
        const first = new EventEngine(MANIFEST);
        const state = pool(1000);
        first.scheduleTrigger('started_working', 'b', 1005, null);

        const second = new EventEngine(MANIFEST);
        second.loadScheduleState(JSON.parse(JSON.stringify(first.getScheduleState())));
        second.simulateTick(state, ['a', 'b'], 1005, TPY, {});
        expect(second.getPersonLog('b')[0]).toMatchObject({ defId: 'started_working', triggerSource: 'schedule' });
    });

    test('atHour rules fire at that hour of day only, gated by the perDay limit', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(0);
        engine.simulateTick(state, ['a'], 6, TPY, {}); // 06:00 — not yet
        expect(engine.getHistory()['a']?.['woke_up']).toBeUndefined();
        engine.simulateTick(state, ['a'], 7, TPY, {}); // 07:00 — fires
        expect(engine.getHistory()['a']!['woke_up']!.count).toBe(1);
        engine.simulateTick(state, ['a'], 7, TPY, {}); // same day again — perDay limit blocks
        expect(engine.getHistory()['a']!['woke_up']!.count).toBe(1);
        engine.simulateTick(state, ['a'], 7 + 24, TPY, {}); // next day 07:00 — fires again
        expect(engine.getHistory()['a']!['woke_up']!.count).toBe(2);
    });

    test('coarse stepping still covers atHour rules once per step window', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(0);
        engine.simulateTick(state, ['a'], 0, TPY, {}, 24); // a whole-day step covers 07:00
        expect(engine.getHistory()['a']!['woke_up']!.count).toBe(1);
    });
});

describe('occurrence limits (task 042)', () => {
    test('once-ever blocks re-fire on the probabilistic path', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        engine.simulateTick(state, ['a'], 1000, TPY, {});
        engine.simulateTick(state, ['a'], 1001, TPY, {});
        expect(engine.getHistory()['a']!['first_steps']!.count).toBe(1);
    });

    test('withinTicks re-allows after the window', () => {
        const engine = new EventEngine(MANIFEST);
        const state = pool(1000);
        engine.simulateTick(state, ['a'], 1000, TPY, {}); // fires
        engine.simulateTick(state, ['a'], 1002, TPY, {}); // within 3 ticks — blocked
        expect(engine.getHistory()['a']!['strolled']!.count).toBe(1);
        engine.simulateTick(state, ['a'], 1004, TPY, {}); // window passed — fires
        expect(engine.getHistory()['a']!['strolled']!.count).toBe(2);
    });

    test('limits gate manual invocations too', () => {
        const limited: EventManifest = {
            once_only: { roles: { subject: alive }, triggers: { manual: {} }, limit: { once: 'ever' }, effects: [] },
        } as unknown as EventManifest;
        const engine = new EventEngine(limited);
        const state = pool(1000);
        expect(engine.invoke(state, 'once_only', 'a', 1000, TPY, { source: 'action', causationId: null }).outcome.ok).toBe(true);
        expect(engine.invoke(state, 'once_only', 'a', 1001, TPY, { source: 'action', causationId: null }).outcome).toEqual({ ok: false, reason: 'limited' });
    });
});

describe('determinism', () => {
    test('interleaved manual invocations do not perturb the probabilistic stream', () => {
        const run = (withInvoke: boolean) => {
            const engine = new EventEngine(MANIFEST);
            const state = pool(1000);
            engine.simulateTick(state, ['a', 'b'], 1000, TPY, {});
            if (withInvoke) {
                engine.invoke(state, 'started_working', 'b', 1000, TPY, { source: 'action', causationId: null });
            }
            engine.simulateTick(state, ['a', 'b'], 1001, TPY, {});
            // Compare only probability-sourced entries (the invoke adds its own entries + schedules).
            const probabilistic = Object.values(engine.getLog()).flat().filter((entry): entry is EventLogEntry => entry.kind === 'event' && entry.triggerSource === 'probability');
            return JSON.stringify(probabilistic.map(entry => [entry.defId, entry.roles, entry.tick]));
        };
        expect(run(true)).toBe(run(false));
    });
});
