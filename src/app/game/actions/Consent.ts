// The consent evaluator (task 073): when an `askFirst` action targets another person, the Action engine
// routes a consent request through the TARGET's decision layer before any consequence runs. Architecturally
// this is Brain territory (Brain re-exposes it as `evaluateConsent`); it lives in its own module so the
// engine can consult it without an import cycle.
//
// THIS IS A PLACEHOLDER POLICY: a deterministic 80% yes. Future work replaces the roll with contextual
// logic — relationship quality, personality, mood, past events, current activity, risk, and the action
// type — using the same request shape (which is why the request carries more than the roll needs).
//
// Determinism (the hard requirement): the verdict is a pure function of (worldSeed, tick, action, source,
// target) on its own salted RNG stream — independent of execution order, identical in live and bootstrap,
// and never perturbing the event/action/brain streams (the JobOrchestrator salt convention).


import { PersonId } from 'types/Genealogy';
import { Value } from 'types/Simulation';
import { SeededRandom, hashStringToSeed } from 'util/random';

export const CONSENT_SALT = 0xc0;
const PLACEHOLDER_ACCEPT_PROBABILITY = 0.8;

export interface ConsentRequest {
    actionId: string;
    params: Record<string, Value>;
    sourcePersonId: PersonId;
    targetPersonId: PersonId;
    tick: number;
    worldSeed: number;
}

export function evaluateConsent(request: ConsentRequest): boolean {
    const rng = new SeededRandom(request.worldSeed)
        .fork(request.tick)
        .fork(CONSENT_SALT)
        .fork(hashStringToSeed(request.sourcePersonId))
        .fork(hashStringToSeed(request.targetPersonId))
        .fork(hashStringToSeed(request.actionId));
    return rng.chance(PLACEHOLDER_ACCEPT_PROBABILITY);
}
