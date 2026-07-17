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
const FRIENDLY_KINDS: ReadonlySet<EdgeKind> = new Set(['acquaintance', 'friend', 'close_friend', 'dating', 'engaged', 'ex_partner']);

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

// Whether two people are direct family (parent/child/sibling) — memoized per pool (perf). The relation is
// genealogically IMMUTABLE once both people exist (parentage is set at creation and never reassigned), so a
// computed answer holds for the rest of the run with no invalidation. This matters because the siblingsOf
// leg scans the whole ever-lived pool: the social hook's target weighting calls resolveStanding for every
// co-located companion, which made this O(company × pool) per proposal — one of the offline generator's
// dominant super-linear costs. Both memo legs are symmetric in (a, b), so the unordered pairKey is sound.
// WeakMap keys on the pool object, so distinct pools (tests, save-loads) never cross-contaminate.
const familyMemo = new WeakMap<PersonTable, Map<string, boolean>>();

function isDirectFamily(people: PersonTable, a: PersonId, b: PersonId): boolean {
    let pairs = familyMemo.get(people);
    if (!pairs) {
        pairs = new Map();
        familyMemo.set(people, pairs);
    }
    const key = pairKey(a, b);
    const cached = pairs.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const family = parentsOf(people, a).includes(b) || parentsOf(people, b).includes(a) || siblingsOf(people, a).includes(b);
    pairs.set(key, family);
    return family;
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
    if (isDirectFamily(people, a, b)) {
        return { kind: 'family', strength: 60 };
    }
    return null;
}

export default class SocialGraph implements RelationshipGraph {
    private state: SocialGraphState;
    private config: RelationshipsConfig;
    // Per-person adjacency index (perf): the pairKeys touching each person, so edgesOf/removePerson never
    // scan the GLOBAL edge table — which grows with population and, over a long run, with time (pruning is
    // lazy-on-read, so dust edges linger in the table), making the old whole-table walk one of the offline
    // generator's dominant super-linear costs. Pure bookkeeping: maintained at the create/delete points,
    // rebuilt on load; reads yield the same sorted output, so behavior is byte-identical.
    private byPerson: Map<PersonId, Set<string>>;

    constructor(config: RelationshipsConfig = RELATIONSHIPS_CONFIG) {
        this.state = { edges: {} };
        this.config = config;
        this.byPerson = new Map();
    }

    private indexEdge(key: string, a: PersonId, b: PersonId): void {
        for (const personId of [a, b]) {
            let keys = this.byPerson.get(personId);
            if (!keys) {
                keys = new Set();
                this.byPerson.set(personId, keys);
            }
            keys.add(key);
        }
    }

    private unindexEdge(key: string, a: PersonId, b: PersonId): void {
        this.byPerson.get(a)?.delete(key);
        this.byPerson.get(b)?.delete(key);
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

    // Every live edge of a person at tick (decayed view), sorted by the other id for determinism. Serves
    // from the per-person index — same edge set, same final sort, no whole-table scan.
    edgesOf(personId: PersonId, tick: number): { otherId: PersonId; view: RelationshipView }[] {
        const keys = this.byPerson.get(personId);
        if (!keys || keys.size === 0) {
            return [];
        }
        const results: { otherId: PersonId; view: RelationshipView }[] = [];
        for (const key of keys) {
            const edge = this.state.edges[key];
            if (!edge) {
                continue;
            }
            const strength = this.decayedStrength(edge, tick);
            if (strength < this.config.pruneBelow) {
                continue;
            }
            const [a, b] = key.split('|') as [PersonId, PersonId];
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
            this.indexEdge(key, a, b);
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
            this.unindexEdge(key, a, b);
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
            this.indexEdge(key, a, b);
        } else {
            edge.strength = strength ?? this.decayedStrength(edge, tick);
            edge.kind = kind;
            edge.lastInteractionTick = tick;
            edge.provenance = provenance ?? edge.provenance;
        }
        return edge;
    }

    // Removes the edge between two people (marriage consumes the engagement — spouse standing derives from
    // the genealogy thereafter, task 090).
    removeEdgeBetween(a: PersonId, b: PersonId): void {
        const key = pairKey(a, b);
        delete this.state.edges[key];
        this.unindexEdge(key, a, b);
    }

    // Removes every edge touching a person (death cleanup) — via the index, no whole-table scan.
    removePerson(personId: PersonId): void {
        for (const key of this.byPerson.get(personId) ?? []) {
            delete this.state.edges[key];
            const [a, b] = key.split('|') as [PersonId, PersonId];
            this.byPerson.get(a === personId ? b : a)?.delete(key);
        }
        this.byPerson.delete(personId);
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
        this.byPerson = new Map();
        for (const [key, edge] of Object.entries(state?.edges ?? {})) {
            this.state.edges[key] = { ...edge };
            const [a, b] = key.split('|') as [PersonId, PersonId];
            this.indexEdge(key, a, b);
        }
    }
}
