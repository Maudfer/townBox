// The social-opportunity Brain hook (task 072): the target-binding action source that brings the
// person-targeted repertoire to life — until now nothing ever supplied `params.target`, so the 044/053
// social/lending actions were unreachable dead content. It PROPOSES (Brain arbitrates, the engine executes
// and enforces the interaction contract): for an idle person sharing a building with someone, occasionally
// pick a person-targeted action whose requirements pass and bind a co-located target.
//
// Deterministic: forks the world-seed RNG per (tick, person) with a fixed salt (the orchestrator
// convention), sorts candidates before every draw, and consumes RNG identically in both execution modes.
// Modest by design — social actions season free time (a per-tick chance), they don't dominate it.

import { ActionIntent, BrainHook, HookContext, DEFAULT_SELECTION_WEIGHT } from 'game/actions/Brain';
import { RELATIONSHIPS_CONFIG, resolveStanding } from 'game/population/SocialGraph';
import { ActionDefinition, ActionManifest } from 'types/Action';
import { evaluatePredicateCached } from 'util/predicate';
import { SeededRandom, hashStringToSeed } from 'util/random';

export const SOCIAL_SALT = 0x50c;
const SOCIAL_CHANCE_PER_TICK = 0.15;

// The joint activities an invitation may propose (task 085/D3). A code list for now — each must be a
// continuous social/leisure action; a follow-up data pass can move this onto the action schema.
export const JOINT_ACTIVITIES = ['catching_up_over_coffee', 'watching_television', 'hosting_gathering', 'taking_a_walk_together'] as const;

// The person-targeted candidate set (task 079): which actions the social hook can even consider — an
// `interaction` block and a positive base weight — depends only on the manifest, so it is computed once per
// manifest instead of re-scanning all ~260 actions (mostly non-interaction) on every eligible tick. The
// per-call work (target/object binding, cooldown, requirements, modifiers, the seeded pick) is unchanged, so
// selection stays byte-identical. A WeakMap keys on the manifest so tests with custom manifests stay correct.
const socialCandidateCache = new WeakMap<ActionManifest, { actionId: string; def: ActionDefinition }[]>();
function socialCandidates(manifest: ActionManifest): { actionId: string; def: ActionDefinition }[] {
    let cached = socialCandidateCache.get(manifest);
    if (!cached) {
        cached = [];
        for (const [actionId, def] of Object.entries(manifest)) {
            if (def.interaction && (def.selection?.weight ?? DEFAULT_SELECTION_WEIGHT) > 0) {
                cached.push({ actionId, def });
            }
        }
        // Pre-sorted once (perf): the per-proposal pick used to re-sort its filtered candidates with the
        // same comparator every time — filtering a sorted list preserves order, so that sort was a no-op.
        cached.sort((a, b) => a.actionId.localeCompare(b.actionId));
        socialCandidateCache.set(manifest, cached);
    }
    return cached;
}

export const socialOpportunityHook: BrainHook = {
    id: 'socialOpportunity',
    kind: 'onTick',
    propose({ personId, deps, brain, sub }: HookContext): ActionIntent[] {
        // --profile segment timers (task 079 pass 2). Null clock outside profiled runs.
        const clock = sub ? () => performance.now() : null;
        const addSeg = (key: string, t0: number): void => {
            if (sub && clock) {
                sub.brainHooks[key] = (sub.brainHooks[key] ?? 0) + (clock() - t0);
            }
        };

        const tStatus = clock ? clock() : 0;
        const status = brain.statusOf(personId).status;
        addSeg('social:status', tStatus);
        if (status !== 'idle' && status !== 'performing_action') {
            return []; // never during work/school/sleep/commute; discrete socials season leisure time
        }
        const world = deps.ctx.world;
        if (!world) {
            return [];
        }
        // The chance gate rolls BEFORE the co-location query (task 079 pass 2): `peopleAt` was the single
        // hottest function of a generator run (~10% — sorted-copy per idle person per tick), and 85% of those
        // calls were discarded by this roll. Byte-identical: the RNG stream is a private per-(tick, person)
        // fork nobody else reads — a person with no company returns [] either way (the extra draw dies with
        // the fork), and a person WITH company consumes the exact same draw sequence as before (chance first,
        // then the pick draws below).
        const tRng = clock ? clock() : 0;
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId)).fork(SOCIAL_SALT);
        const rolled = rng.chance(SOCIAL_CHANCE_PER_TICK);
        addSeg('social:rng', tRng);
        if (!rolled) {
            return [];
        }
        const tCompany = clock ? clock() : 0;
        const company = world.peopleAt(world.locationOf(personId)).filter(id => id !== personId);
        addSeg('social:company', tCompany);
        if (company.length === 0) {
            return [];
        }

        const engine = brain.getActionEngine();

        // Target FIRST (task 083 / proposal B): weight companions by relationship standing — a spouse or
        // close friend is the likely counterpart, a stranger merely possible — so intimacy-gated actions
        // evaluate their requirements against the actual would-be target. Deterministic: company arrives
        // sorted from peopleAt, weights are pure functions of the graph.
        const tTarget = clock ? clock() : 0;
        const targeting = RELATIONSHIPS_CONFIG.socialTargeting;
        const social = deps.ctx.markets?.social ?? null;
        const weightedCompany = company.map(id => {
            const view = resolveStanding(deps.state.people, social, personId, id, deps.tick);
            const kindWeight = targeting.kindWeight[view?.kind ?? 'none'] ?? 1;
            return { id, weight: Math.max(0.01, kindWeight + (view?.strength ?? 0) * targeting.strengthWeight) };
        });
        const totalTargetWeight = weightedCompany.reduce((sum, candidate) => sum + candidate.weight, 0);
        let targetRoll = rng.next() * totalTargetWeight;
        let pickedTarget = weightedCompany[weightedCompany.length - 1]!.id;
        for (const candidate of weightedCompany) {
            targetRoll -= candidate.weight;
            if (targetRoll <= 0) {
                pickedTarget = candidate.id;
                break;
            }
        }
        addSeg('social:target', tTarget);

        const tLoop = clock ? clock() : 0;
        // Bind the picked target into the evaluation context so relationship-gated requirements resolve.
        const context = engine.contextFor(personId, deps, { target: pickedTarget });

        // AskFirst pricing (W6 / proposal simulation-aliveness-3 Part 4.4): the proposer reads the SAME
        // standing the target's consent policy will — intimacy toward weak edges dampens sharply, so people
        // mostly stop asking those who'd say no. The decoded asset carried ~39% lifetime hug-decline rates
        // (1,142 rejected hugs in 30 lifetimes) purely from under-priced proposals. Strong/kin bonds stay
        // full weight; strangers ×~0.2; rivals near-zero.
        const pickedStanding = resolveStanding(deps.state.people, social, personId, pickedTarget, deps.tick);
        const strongKinds = new Set(['family', 'spouse', 'dating', 'engaged', 'close_friend']);
        const askFirstFactor = pickedStanding && strongKinds.has(pickedStanding.kind)
            ? 1
            : pickedStanding?.kind === 'rival'
                ? 0.05
                : Math.min(1, 0.2 + (pickedStanding?.strength ?? 0) / 40);

        // Return-side coherence (task 074): a carried instance OWNED by a co-located other person is a
        // borrowed object whose return-target is knowable — the ownership-vs-possession split identifies it.
        // Deterministic: first by instance id. When a return-style action wins the pick, its target is the
        // OWNER (overriding the weighted pick), so lending loops still genuinely close.
        const borrowed = (deps.inventory?.carriedInstances(personId) ?? [])
            .filter(instance => instance.owner.kind === 'person' && instance.owner.personId !== personId
                && company.includes(instance.owner.personId))
            .sort((a, b) => a.id.localeCompare(b.id));

        const candidates: { actionId: string; weight: number; objectParam: string | null; activityParam: string | null }[] = [];
        for (const { actionId, def } of socialCandidates(engine.getManifest())) {
            // The hook can bind the target, (for return-style actions) ONE borrowed object instance, and
            // (for invitations, task 085) an 'activity' string from the joint-activity list; any other
            // required parameter is unbindable here — never propose an unstartable intent.
            let objectParam: string | null = null;
            let activityParam: string | null = null;
            let bindable = true;
            for (const [name, spec] of Object.entries(def.parameters ?? {})) {
                if (!spec.required || name === def.interaction!.targetParam) {
                    continue;
                }
                if (spec.type === 'objectInstance' && objectParam === null && borrowed.length > 0) {
                    objectParam = name;
                } else if (spec.type === 'string' && name === 'activity' && activityParam === null) {
                    activityParam = name;
                } else {
                    bindable = false;
                }
            }
            if (!bindable) {
                continue;
            }
            let weight = def.selection?.weight ?? DEFAULT_SELECTION_WEIGHT;
            if (def.interaction?.askFirst) {
                weight *= askFirstFactor; // W6: don't keep asking people who'd say no
            }
            if (def.selection?.cooldownTicks !== undefined && engine.hasAction(personId, actionId, deps.tick, { withinTicks: def.selection.cooldownTicks })) {
                continue;
            }
            if (def.requirements && !evaluatePredicateCached(def.requirements, context)) {
                continue; // e.g. nothing giftable carried → no gift intents
            }
            for (const modifier of def.selection?.modifiers ?? []) {
                if (evaluatePredicateCached(modifier.when, context)) {
                    weight *= modifier.multiply;
                }
            }
            // Needs urgency (task 084): a lonely person leans into company; a socially sated one less so.
            const needsLedger = deps.ctx.markets?.needs ?? null;
            if (needsLedger && def.satisfies) {
                weight *= needsLedger.selectionMultiplier(personId, def.satisfies, deps.tick, deps.state.worldSeed);
            }
            // Trait affinity (task 087): the gregarious lean in, the solitary hang back.
            const traitsReader = deps.ctx.markets?.traits ?? null;
            if (traitsReader && def.affinity) {
                weight *= traitsReader.affinityMultiplier(personId, def.affinity);
            }
            if (weight > 0) {
                candidates.push({ actionId, weight, objectParam, activityParam });
            }
        }
        addSeg('social:loop', tLoop);
        if (candidates.length === 0) {
            return [];
        }
        // No sort needed (perf): filtered from the actionId-pre-sorted socialCandidates() — order preserved.
        const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = rng.next() * total;
        let picked = candidates[candidates.length - 1]!;
        for (const candidate of candidates) {
            roll -= candidate.weight;
            if (roll <= 0) {
                picked = candidate;
                break;
            }
        }
        const targetParam = engine.getManifest()[picked.actionId]!.interaction!.targetParam;
        // Return-style pick: the object names its own target (the owner). Otherwise: the weighted pick.
        const params: Record<string, string> = {};
        if (picked.objectParam !== null) {
            const instance = borrowed[0]!;
            params[targetParam] = (instance.owner as { kind: 'person'; personId: string }).personId;
            params[picked.objectParam] = instance.id;
        } else {
            params[targetParam] = pickedTarget;
        }
        // Invitations (task 085): bind a seeded joint-activity pick.
        if (picked.activityParam !== null) {
            params[picked.activityParam] = JOINT_ACTIVITIES[rng.nextInt(0, JOINT_ACTIVITIES.length - 1)]!;
        }
        return [{
            actionId: picked.actionId,
            params,
            sourceHook: 'socialOpportunity',
            priority: 20,
            necessity: 'optional',
            band: 'opportunity',
            mayInterrupt: false,
            causationId: null,
        }];
    },
};
