// The consent evaluator (task 073; scored policy since task 083 / proposal B6): when an `askFirst` action
// targets another person, the Action engine routes a consent request through the TARGET's decision layer
// before any consequence runs. Architecturally this is Brain territory (Brain re-exposes it as
// `evaluateConsent`); it lives in its own module so the engine can consult it without an import cycle.
//
// The 073 placeholder (a flat 80% yes) is replaced by a RELATIONSHIP-SCORED policy: the accept probability
// is the target's standing toward the asker — authored per standing in json/relationships.json (`consent.
// base`: a stranger ~0.35, a friend 0.8, a spouse 0.95, a rival 0.05) — shifted by the edge's decayed
// strength (`consent.strengthWeight` per point) and clamped. Future inputs (mood — task 091, traits — 087)
// enter the same formula through the optional fields on the request.
//
// Determinism (the hard requirement): the verdict is a pure function of (worldSeed, tick, action, source,
// target, relationship view) on the same salted RNG stream as 073 — independent of execution order,
// identical in live and bootstrap, and never perturbing the event/action/brain streams.

import { MOOD_CONFIG } from 'game/population/Mood';
import { RELATIONSHIPS_CONFIG } from 'game/population/SocialGraph';
import { traitConsentShift } from 'game/population/Traits';
import { PersonId } from 'types/Genealogy';
import { RelationshipView } from 'types/Relationship';
import { Value } from 'types/Simulation';
import { PersonTraits } from 'types/Traits';
import { SeededRandom, hashStringToSeed } from 'util/random';

export const CONSENT_SALT = 0xc0;
const MIN_ACCEPT = 0.02;
const MAX_ACCEPT = 0.98;

export interface ConsentRequest {
    actionId: string;
    params: Record<string, Value>;
    sourcePersonId: PersonId;
    targetPersonId: PersonId;
    tick: number;
    worldSeed: number;
    // The TARGET's standing toward the ASKER (resolveStanding order: spouse > edge > family), or null for
    // strangers / contexts without a graph. Supplied by the Action engine.
    relationship?: RelationshipView | null;
    // The TARGET's temperament (task 087): a sociable person says yes more, a quick temper less.
    targetTraits?: PersonTraits | null;
    // The TARGET's mood (task 091): a low day makes everything a harder ask. 0–100; absent = baseline.
    targetMood?: number | null;
    // What the TARGET knows about the ASKER (task 104 / O3): each remembered negative fact makes a yes
    // harder — the town's memory as social reality, restrained to one read.
    targetKnowsNegative?: number | null;
}

// The scored accept probability — exported so tests (and later the inspector) can read the policy directly.
export function consentProbability(request: ConsentRequest): number {
    const config = RELATIONSHIPS_CONFIG.consent;
    const view = request.relationship ?? null;
    const base = config.base[view?.kind ?? 'none'] ?? config.base.none;
    const strengthShift = (view?.strength ?? 0) * config.strengthWeight;
    const traitShift = request.targetTraits ? traitConsentShift(request.targetTraits) : 0;
    const moodShift = typeof request.targetMood === 'number' ? (request.targetMood - MOOD_CONFIG.baseline) * config.moodWeight : 0;
    // Reputation (task 104 / O3): each negative fact the target REMEMBERS about the asker makes a yes
    // harder — capped so a bad story dents, never damns.
    const reputationShift = -Math.min(3, request.targetKnowsNegative ?? 0) * 0.04;
    return Math.min(MAX_ACCEPT, Math.max(MIN_ACCEPT, base + strengthShift + traitShift + moodShift + reputationShift));
}

export function evaluateConsent(request: ConsentRequest): boolean {
    const rng = new SeededRandom(request.worldSeed)
        .fork(request.tick)
        .fork(CONSENT_SALT)
        .fork(hashStringToSeed(request.sourcePersonId))
        .fork(hashStringToSeed(request.targetPersonId))
        .fork(hashStringToSeed(request.actionId));
    return rng.chance(consentProbability(request));
}
