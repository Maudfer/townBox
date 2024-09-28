import * as d3 from 'd3';

export interface Node extends d3.SimulationNodeDatum {
    name: string;
}

export interface Link extends d3.SimulationLinkDatum<Node> {
    source: number | Node;
    target: number | Node;
    label: string;
}

export type d3Tag = d3.Selection<d3.BaseType, unknown, HTMLElement, any>;
export interface FamilyTreeTags {
    nodesTag: d3Tag;
    linksTag: d3Tag;
    linkLabelsTag: d3Tag;
}