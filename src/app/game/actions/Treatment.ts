// Treatment hooks (task 111 / proposal simulation-visibility §111): hospitals as lived behavior. A sick
// person (the same health threshold the 092 fitness gate uses) whose town HAS a hospital travels there and
// runs `receiving_treatment` — obligation band, urgency-scaled priority, so severe illness pushes past the
// stay-in-bed default and even interrupts it. No hospital → no proposal — they keep the 092 resting
// behavior and the slower ledger-only recovery, never a hardcoded outcome. On the other side, an on-duty
// doctor with a patient-in-treatment co-located binds `treating_patient` to them (the 074 return-side
// coherence pattern): its counterpart lands `was_treated_by_doctor` on the patient, which the `recovered`
// hazard reads as the personal ×2 multiplier (the recentlyTreated attribute). A hospital with no doctor on
// duty treats nobody — the building alone heals nothing.

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';
import { SICK_HEALTH_THRESHOLD } from 'game/actions/JobOrchestrator';
import { isOnShiftAtTick } from 'util/shifts';

const DOCTOR_JOB_KEY = 'doctor';
// One treatment per patient per day: the doctor's rounds move on to the untreated.
const RETREAT_COOLDOWN_TICKS = 24;
// Patient-side re-seek guard (LP-5 quick fix; the 117 balancing notes' #1 flag): a treatment session is
// short (4 ticks), and without a cooldown a sick person re-entered treatment the moment it ended — camping
// at the hospital in a rapid re-fire loop (18,201 starts against ~210 illness onsets in the 117 cohort).
// One session per day mirrors the doctors' own rounds cadence; between sessions the 092 rest behavior holds.
export const SEEK_COOLDOWN_TICKS = 24;

export const treatmentHook: BrainHook = {
    id: 'treatment',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        const world = deps.ctx.world;
        if (!world) {
            return [];
        }
        // Health first (the memoized context) — only the sick (rare) pay the venue lookup, which in live
        // mode scans placed buildings.
        const engine = ctx.brain.getActionEngine();
        const health = engine.contextFor(personId, deps).getAttr('health');
        if (typeof health !== 'number' || health >= SICK_HEALTH_THRESHOLD) {
            return [];
        }
        if (!world.hasVenue('hospital')) {
            return []; // no hospital in this town — the 092 resting behavior stands, unchanged
        }
        const active = engine.activeInstanceOf(personId);
        if (active?.defId === 'receiving_treatment') {
            return [];
        }
        if (engine.hasAction(personId, 'receiving_treatment', deps.tick, { withinTicks: SEEK_COOLDOWN_TICKS })) {
            return []; // treated recently — rest at home until tomorrow's session (the re-seek guard)
        }
        // Urgency-scaled: barely under the threshold edges out the sick-rest proposal (90); severe illness
        // clears the interruption hysteresis and pulls the person out of bed and into the car.
        const priority = Math.min(145, 90 + Math.round(((SICK_HEALTH_THRESHOLD - health) / SICK_HEALTH_THRESHOLD) * 60));
        return [{
            actionId: 'receiving_treatment',
            sourceHook: 'treatment',
            priority,
            necessity: 'required',
            band: 'obligation',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};

export const doctorRoundsHook: BrainHook = {
    id: 'doctorRounds',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        const world = deps.ctx.world;
        if (!world) {
            return [];
        }
        const job = deps.jobOf?.(personId);
        if (job?.jobKey !== DOCTOR_JOB_KEY || !isOnShiftAtTick(job, deps.tick)) {
            return [];
        }
        const engine = ctx.brain.getActionEngine();
        const active = engine.activeInstanceOf(personId);
        if (active?.defId === 'treating_patient') {
            return [];
        }
        // Live: the ward is the doctor's workplace BUILDING (the venue resolved to it); bootstrap: the
        // abstract hospital VENUE. Both are real co-location scopes for the rounds.
        const here = world.locationOf(personId);
        if (here.kind !== 'building' && here.kind !== 'venue') {
            return [];
        }
        // The rounds: the first co-located patient-in-treatment who hasn't been seen today. Deterministic
        // by id; a patient treated this morning waits for tomorrow's rounds (or another doctor's).
        const patient = world.peopleAt(here)
            .filter(otherId => otherId !== personId && engine.activeInstanceOf(otherId)?.defId === 'receiving_treatment')
            .find(otherId => !deps.eventEngine
                || !deps.eventEngine.contextFor(deps.state, otherId, deps.tick, deps.ticksPerYear)
                    .hasEvent('was_treated_by_doctor', { withinTicks: RETREAT_COOLDOWN_TICKS }));
        if (!patient) {
            return [];
        }
        return [{
            actionId: 'treating_patient',
            params: { target: patient },
            sourceHook: 'doctorRounds',
            priority: 130, // above the ward routine — a waiting patient IS the job
            necessity: 'required',
            band: 'obligation',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};
