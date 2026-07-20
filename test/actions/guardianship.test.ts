import { guardianshipHook } from 'game/actions/Guardianship';
import { BrainDeps, HookContext } from 'game/actions/Brain';

// The guardianship hook (task 126): the last available adult at home anchors `caring_for_children` when a
// young dependent would otherwise be home alone. Live-only — it reads a host-supplied presence resolver, so
// it is inert off-map (bootstrap/generator never supply it).

function makeCtx(options: {
    unattended?: boolean | undefined;
    activeDefId?: string | null;
}): HookContext {
    const deps = {
        unattendedDependentAtHome: options.unattended === undefined ? undefined : () => options.unattended!,
    } as unknown as BrainDeps;
    const brain = {
        getActionEngine: () => ({ activeInstanceOf: () => (options.activeDefId ? { defId: options.activeDefId } : null) }),
    } as unknown as HookContext['brain'];
    return { personId: 'guardian', deps, brain } as HookContext;
}

describe('guardianshipHook', () => {
    test('proposes caring_for_children when a young dependent is home unattended', () => {
        const intents = guardianshipHook.propose(makeCtx({ unattended: true, activeDefId: null }));
        expect(intents).toHaveLength(1);
        expect(intents[0]!.actionId).toBe('caring_for_children');
        expect(intents[0]!.band).toBe('obligation');
        expect(intents[0]!.necessity).toBe('required');
    });

    test('proposes nothing when no dependent is unattended', () => {
        expect(guardianshipHook.propose(makeCtx({ unattended: false, activeDefId: null }))).toEqual([]);
    });

    test('does not churn when already caring for the children', () => {
        expect(guardianshipHook.propose(makeCtx({ unattended: true, activeDefId: 'caring_for_children' }))).toEqual([]);
    });

    test('is inert off-map (no presence resolver supplied)', () => {
        expect(guardianshipHook.propose(makeCtx({ unattended: undefined, activeDefId: null }))).toEqual([]);
    });
});
