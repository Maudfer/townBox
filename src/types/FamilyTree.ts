import * as d3 from 'd3';

export interface Node extends d3.SimulationNodeDatum {
    name: string;
    // Genealogy-derived flags (cross-household trees). Optional so the simpler residents-based builder and
    // existing callers still satisfy the type.
    alive?: boolean;
    placed?: boolean; // belongs to a placed household (lives somewhere in the city)
    isSubject?: boolean; // a member of the household whose window this is
    // Generational level relative to the household (LP-10): subjects 0, parents −1, children +1; spouses
    // and siblings share their anchor's level. The renderer pins each level to a horizontal row so the
    // tree reads as generations instead of a force-directed hairball.
    generation?: number;
}

export interface Link extends d3.SimulationLinkDatum<Node> {
    source: number | Node;
    target: number | Node;
    label: string;
}

export interface FamilyTree {
    nodes: Node[];
    links: Link[];
}

export type d3Tag = d3.Selection<d3.BaseType, unknown, HTMLElement, unknown>;
export interface FamilyTreeTags {
    nodesTag: d3Tag;
    linksTag: d3Tag;
    linkLabelsTag: d3Tag;
}