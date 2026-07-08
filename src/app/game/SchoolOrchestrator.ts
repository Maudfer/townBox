// The school-obligation Brain hook (task 058): the student-side counterpart of the Job Orchestrator (047).
// It PROPOSES — a child aged into school with a valid assignment gets the attend_school intent while school
// is in session, and a completion request when the session ends; the Brain arbitrates, the Action engine
// executes. Validity lives in the host's `schoolOf` resolver (City in live mode; the logical world when 055
// builds it; fixtures in tests): a null means no obligation, and the child falls through to normal
// free-time behavior — no silent auto-schooling. RNG-free (nothing to roll).

import { ActionIntent, BrainHook, HookContext } from 'game/Brain';
import { isOnShiftAtTick } from 'util/shifts';

export const ATTEND_SCHOOL_ACTION = 'attend_school';

export const schoolObligationHook: BrainHook = {
    id: 'schoolObligation',
    kind: 'onTick',
    propose({ personId, deps, brain }: HookContext): ActionIntent[] {
        const school = deps.schoolOf?.(personId) ?? null;
        if (!school) {
            return [];
        }
        const engine = brain.getActionEngine();
        const inSession = isOnShiftAtTick(school, deps.tick);
        const active = engine.activeInstanceOf(personId);
        const attending = active?.defId === ATTEND_SCHOOL_ACTION;

        if (!inSession) {
            if (attending && active) {
                // Session over and the instance didn't self-complete (its completeWhen closes the normal
                // day): request completion by interrupting — the same completion-request primitive the Job
                // Orchestrator uses at shift end. Day credit comes from completion/the automated fallback,
                // never from this interrupt (a cut-short day is not a completed day).
                engine.interrupt(active.id, { source: 'brain', causationId: null }, deps, { died: [], born: [], signals: [], committed: [] });
            }
            return [];
        }
        if (attending) {
            return []; // already at their desk
        }
        return [{
            actionId: ATTEND_SCHOOL_ACTION,
            locationOverride: `building:${school.schoolKey}`,
            sourceHook: 'schoolObligation',
            priority: 100,
            necessity: 'required',
            mayInterrupt: true, // obligations displace leisure — same posture as the work obligation
            causationId: null,
        }];
    },
};
