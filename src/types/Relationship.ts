// The elective social graph (task 083 / proposal B): friendship, rivalry, and romance edges between people.
// FAMILY IS NOT HERE — kinship stays derived from the genealogy (the §4.8 rule); this graph holds only the
// bonds people choose. Edges decay closed-form from lastInteractionTick (no per-tick mutation — the K2
// stride-tolerance rule), and kind transitions are authored policy in json/relationships.json, never code.

export type EdgeKind = 'acquaintance' | 'friend' | 'close_friend' | 'rival' | 'dating' | 'ex_partner';

// What a relationship query can name: a graph edge kind, or one of the derived standings a context resolves
// from the genealogy ('spouse', 'family') or the absence of any tie ('none').
export type RelationshipStanding = EdgeKind | 'spouse' | 'family' | 'none';

export interface SocialEdge {
    kind: EdgeKind;
    // For friendly kinds: warmth (0–100). For rival: heat/intensity (0–100) — positive interaction deltas
    // COOL a rivalry, negative ones heat it. One scale, kind gives it its sign.
    strength: number;
    formedAtTick: number;
    lastInteractionTick: number;
    // seq of the log entry whose consequence created/last re-kinded the edge (the causation convention).
    provenance: number | null;
}

export interface SocialGraphState {
    // Keyed by the unordered pair "idA|idB" (lexicographically sorted).
    edges: Record<string, SocialEdge>;
}

// A read view of the standing between two people (post-decay, derived kinds resolved by the caller/context).
export interface RelationshipView {
    kind: RelationshipStanding;
    strength: number;
}

// The graph surface the engines consult through SimulationMarkets (task 083) — implemented by
// game/population/SocialGraph. An interface here keeps types/Execution.ts free of game imports.
export interface RelationshipGraph {
    edgeBetween(a: string, b: string, tick: number): RelationshipView | null;
    edgesOf(personId: string, tick: number): { otherId: string; view: RelationshipView }[];
    adjust(a: string, b: string, delta: number, tick: number, opts?: { kind?: EdgeKind; provenance?: number | null }): {
        edge: SocialEdge;
        promoted?: { onPromote?: string; to: EdgeKind };
        flipped?: EdgeKind;
    };
    setKind(a: string, b: string, kind: EdgeKind, tick: number, strength?: number, provenance?: number | null): SocialEdge;
    removePerson(personId: string): void;
}

// --- json/relationships.json ------------------------------------------------------------------------------

export interface LadderRung {
    kind: EdgeKind;
    promoteAt?: number;     // strength at/above which the edge becomes `next`
    next?: EdgeKind;
    onPromote?: string;     // manual event invoked (subject = each side) when the promotion happens
    demoteBelow?: number;   // decayed strength below which the edge falls to `downTo`
    downTo?: EdgeKind;
}

export interface RelationshipsConfig {
    // Closed-form decay half-life per kind, in in-game days (ticks = days × 24).
    halfLifeDays: Record<EdgeKind, number>;
    ladder: LadderRung[];
    // A friendly edge driven to 0 by negative deltas flips hostile; a rivalry cooled to 0 reconciles.
    hostility: { to: EdgeKind; strength: number };
    reconciliation: { to: EdgeKind; strength: number };
    // Consent v2 (task 083 / proposal B6): base accept probability per standing + a per-strength-point shift.
    consent: { base: Record<RelationshipStanding, number>; strengthWeight: number };
    // Social-opportunity target weighting: multiplier per standing + per-strength-point bonus.
    socialTargeting: { kindWeight: Record<RelationshipStanding, number>; strengthWeight: number };
    // Edges whose decayed strength falls below this are pruned (memory hygiene; rebuilding is one hello away).
    pruneBelow: number;
}
