// The elective social graph (task 083 / proposal B1): friendship, rivalry and romance edges, serialized in
// the save (v15) and read by consent, target selection, and relationship predicates. Family stays derived
// from the genealogy — this store never duplicates kinship.
//
// Decay is CLOSED-FORM (the proposal's K2 stride-tolerance rule): an edge's effective strength at tick T is
// strength × 0.5^((T − lastInteractionTick) / halfLife). Nothing mutates per tick; `adjust` materializes the
// decayed value before applying its delta, so live hourly play and the generator's day strides agree exactly.
//
// Kind transitions are authored policy (json/relationships.json): the promotion ladder (acquaintance →
// friend → close_friend) with per-rung events, decay demotions, the hostile flip (a friendly edge driven to
// 0 turns rival) and reconciliation (a rivalry cooled to 0 becomes acquaintance). `adjust` returns any
// transition so the CALLER (the action-consequence path) can invoke the authored event — the graph itself
// never touches the event engine.

import relationshipsConfig from 'json/relationships.json';
import { PersonId, PersonTable } from 'types/Genealogy';
import {
    EdgeKind,
    LadderRung,
    RelationshipGraph,
    RelationshipsConfig,
    RelationshipView,
    SocialEdge,
    SocialGraphState,
} from 'types/Relationship';
import { isAliveAt, parentsOf, siblingsOf, spouseAt } from 'util/kinship';

export const RELATIONSHIPS_CONFIG = relationshipsConfig as unknown as RelationshipsConfig;

const TICKS_PER_DAY = 24;
const FRIENDLY_KINDS: ReadonlySet<EdgeKind> = new Set(['acquaintance', 'friend', 'close_friend', 'dating', 'ex_partner']);

export function pairKey(a: PersonId, b: PersonId): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface AdjustResult {
    edge: SocialEdge;
    // A ladder promotion that happened during this adjust (the caller fires the authored event).
    promoted?: { onPromote?: string; to: EdgeKind };
    // The edge flipped hostile (friendly → rival) or reconciled (rival → friendly).
    flipped?: EdgeKind;
}

// Resolves the STANDING between two people (task 083): a living genealogy spouse outranks any edge; then the
// elective graph edge; then direct family (parent/child/sibling — derived, never stored); else null. This is
// the one resolution rule the contexts (action + event), consent, and target weighting all share.
export function resolveStanding(people: PersonTable, graph: RelationshipGraph | null, a: PersonId, b: PersonId, tick: number): RelationshipView | null {
    if (a === b || !people[a] || !people[b]) {
        return null;
    }
    const spouse = spouseAt(people, a, tick);
    if (spouse === b && isAliveAt(people[b]!, tick)) {
        const edge = graph?.edgeBetween(a, b, tick) ?? null;
        return { kind: 'spouse', strength: edge?.strength ?? 75 };
    }
    const edge = graph?.edgeBetween(a, b, tick) ?? null;
    if (edge) {
        return edge;
    }
    if (parentsOf(people, a).includes(b) || parentsOf(people, b).includes(a) || siblingsOf(people, a).includes(b)) {
        return { kind: 'family', strength: 60 };
    }
    return null;
}

export default class SocialGraph implements RelationshipGraph {
    private state: SocialGraphState;
    private config: RelationshipsConfig;

    constructor(config: RelationshipsConfig = RELATIONSHIPS_CONFIG) {
        this.state = { edges: {} };
        this.config = config;
    }

    // --- Reads -------------------------------------------------------------------------------------------

    // The decayed, demotion-resolved view of the edge between two people, or null. Pure — never mutates.
    edgeBetween(a: PersonId, b: PersonId, tick: number): RelationshipView | null {
        const edge = this.state.edges[pairKey(a, b)];
        if (!edge) {
            return null;
        }
        const strength = this.decayedStrength(edge, tick);
        if (strength < this.config.pruneBelow) {
            return null;
        }
        return { kind: this.demotedKind(edge.kind, strength), strength };
    }

    // Every live edge of a person at tick (decayed view), sorted by the other id for determinism.
    edgesOf(personId: PersonId, tick: number): { otherId: PersonId; view: RelationshipView }[] {
        const results: { otherId: PersonId; view: RelationshipView }[] = [];
        for (const [key, edge] of Object.entries(this.state.edges)) {
            const [a, b] = key.split('|') as [PersonId, PersonId];
            if (a !== personId && b !== personId) {
                continue;
            }
            const strength = this.decayedStrength(edge, tick);
            if (strength < this.config.pruneBelow) {
                continue;
            }
            results.push({ otherId: a === personId ? b : a, view: { kind: this.demotedKind(edge.kind, strength), strength } });
        }
        results.sort((x, y) => x.otherId.localeCompare(y.otherId));
        return results;
    }

    // --- Mutations ---------------------------------------------------------------------------------------

    // Applies an interaction delta between two people: materializes decay (+ any decay demotion), applies the
    // delta with the friendly/rival sign convention, resolves the hostile flip / reconciliation / promotion
    // policies, refreshes lastInteractionTick, and prunes dust. Deterministic; pure function of its inputs.
    adjust(a: PersonId, b: PersonId, delta: number, tick: number, opts: { kind?: EdgeKind; provenance?: number | null } = {}): AdjustResult {
        const key = pairKey(a, b);
        let edge = this.state.edges[key];
        if (!edge) {
            edge = {
                kind: opts.kind ?? 'acquaintance',
                strength: 0,
                formedAtTick: tick,
                lastInteractionTick: tick,
                provenance: opts.provenance ?? null,
            };
            this.state.edges[key] = edge;
        } else {
            // Materialize decay (and any decay demotion) before touching the value.
            const decayed = this.decayedStrength(edge, tick);
            edge.kind = this.demotedKind(edge.kind, decayed);
            edge.strength = decayed;
            edge.lastInteractionTick = tick;
            if (opts.kind && opts.kind !== edge.kind) {
                edge.kind = opts.kind;
                edge.provenance = opts.provenance ?? edge.provenance;
            }
        }

        const result: AdjustResult = { edge };
        // Sign convention: on friendly edges, positive deltas warm; on rival edges, positive deltas COOL the
        // rivalry (they reduce its heat) and negative ones heat it.
        const applied = edge.kind === 'rival' ? -delta : delta;
        const raw = edge.strength + applied;

        if (raw <= 0) {
            if (FRIENDLY_KINDS.has(edge.kind) && delta < 0) {
                // Driven to zero by hostility: the friendship dies and a rivalry starts (authored policy).
                edge.kind = this.config.hostility.to;
                edge.strength = this.config.hostility.strength;
                result.flipped = edge.kind;
            } else if (edge.kind === 'rival') {
                // A rivalry cooled to nothing reconciles into a plain acquaintance.
                edge.kind = this.config.reconciliation.to;
                edge.strength = this.config.reconciliation.strength;
                result.flipped = edge.kind;
            } else {
                edge.strength = Math.max(0, raw);
            }
        } else {
            edge.strength = Math.min(100, raw);
        }

        // Ladder promotion (friendly kinds only; explicit kinds like dating never auto-promote). Loops so the
        // kind always matches the strength thresholds even across a large single delta; the REPORTED
        // transition is the last rung climbed (its event is the one worth telling).
        for (;;) {
            const rung = this.rungOf(edge.kind);
            if (rung?.next === undefined || rung.promoteAt === undefined || edge.strength < rung.promoteAt) {
                break;
            }
            edge.kind = rung.next;
            edge.provenance = opts.provenance ?? edge.provenance;
            result.promoted = { to: rung.next, ...(rung.onPromote ? { onPromote: rung.onPromote } : {}) };
        }

        if (edge.strength < this.config.pruneBelow) {
            delete this.state.edges[key];
        }
        return result;
    }

    // Explicitly re-kinds an edge (romance transitions, task 090; breakups → ex_partner). Creates the edge
    // when absent.
    setKind(a: PersonId, b: PersonId, kind: EdgeKind, tick: number, strength?: number, provenance: number | null = null): SocialEdge {
        const key = pairKey(a, b);
        let edge = this.state.edges[key];
        if (!edge) {
            edge = { kind, strength: strength ?? 30, formedAtTick: tick, lastInteractionTick: tick, provenance };
            this.state.edges[key] = edge;
        } else {
            edge.strength = strength ?? this.decayedStrength(edge, tick);
            edge.kind = kind;
            edge.lastInteractionTick = tick;
            edge.provenance = provenance ?? edge.provenance;
        }
        return edge;
    }

    // Removes every edge touching a person (death cleanup).
    removePerson(personId: PersonId): void {
        for (const key of Object.keys(this.state.edges)) {
            const [a, b] = key.split('|');
            if (a === personId || b === personId) {
                delete this.state.edges[key];
            }
        }
    }

    // --- Internals ----------------------------------------------------------------------------------------

    private decayedStrength(edge: SocialEdge, tick: number): number {
        const elapsed = Math.max(0, tick - edge.lastInteractionTick);
        if (elapsed === 0) {
            return edge.strength;
        }
        const halfLifeTicks = (this.config.halfLifeDays[edge.kind] ?? 300) * TICKS_PER_DAY;
        return edge.strength * Math.pow(0.5, elapsed / halfLifeTicks);
    }

    // Applies decay demotions (a close_friend faded below its floor reads as a friend, and so on) without
    // mutating — the same rule `adjust` materializes.
    private demotedKind(kind: EdgeKind, strength: number): EdgeKind {
        let current = kind;
        for (;;) {
            const rung = this.rungOf(current);
            if (rung?.demoteBelow !== undefined && rung.downTo !== undefined && strength < rung.demoteBelow) {
                current = rung.downTo;
                continue;
            }
            return current;
        }
    }

    private rungOf(kind: EdgeKind): LadderRung | undefined {
        return this.config.ladder.find(rung => rung.kind === kind);
    }

    // --- Persistence --------------------------------------------------------------------------------------

    serialize(): SocialGraphState {
        return { edges: Object.fromEntries(Object.entries(this.state.edges).map(([key, edge]) => [key, { ...edge }])) };
    }

    loadState(state: SocialGraphState | undefined): void {
        this.state = { edges: {} };
        for (const [key, edge] of Object.entries(state?.edges ?? {})) {
            this.state.edges[key] = { ...edge };
        }
    }
}
