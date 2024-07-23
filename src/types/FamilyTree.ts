import * as d3 from 'd3';

export interface Node extends d3.SimulationNodeDatum {
    name: string;
}

export interface Link extends d3.SimulationLinkDatum<Node> {
    source: number | Node;
    target: number | Node;
    label: string;
}

export interface FamilyTreeSelectors {
    nodesSelector: string;
    linksSelector: string;
    linkLabelsSelector: string;
}