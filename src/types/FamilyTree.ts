import * as d3 from 'd3';

export interface Node extends d3.SimulationNodeDatum {
    name: string;
    // Genealogy-derived flags (cross-household trees). Optional so the simpler residents-based builder and
    // existing callers still satisfy the type.
    alive?: boolean;
    placed?: boolean; // belongs to a placed household (lives somewhere in the city)
    isSubject?: boolean; // a member of the household whose window this is
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

export type d3Tag = d3.Selection<d3.BaseType, unknown, HTMLElement, any>;
export interface FamilyTreeTags {
    nodesTag: d3Tag;
    linksTag: d3Tag;
    linkLabelsTag: d3Tag;
}