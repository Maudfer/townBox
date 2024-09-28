import * as d3 from 'd3';

import { Node, Link, FamilyTreeTags, d3Tag } from 'types/FamilyTree';
import { WindowSize } from 'types/HUD';

type DragBehavior = d3.DragBehavior<SVGTextElement, Node, Node | d3.SubjectPosition>;

function updateLinks(linksTag: d3Tag, links: Link[]) {
    linksTag.selectAll('line')
        .data(links)
        .join('line')
        .attr('x1', function (d: Link) {
            return (d.source as Node).x ?? 0;
        })
        .attr('y1', function (d: Link) {
            return (d.source as Node).y ?? 0;
        })
        .attr('x2', function (d: Link) {
            return (d.target as Node).x ?? 0;
        })
        .attr('y2', function (d: Link) {
            return (d.target as Node).y ?? 0;
        });
}

function updateLinkLabels(linkLabelsTag: d3Tag, links: Link[]) {
    linkLabelsTag.selectAll('text')
        .data(links)
        .join('text')
        .text(function (d: Link) {
            return d.label;
        })
        .attr('x', function (d: Link) {
            const source = d.source as Node;
            const target = d.target as Node;

            if (!source.x || !target.x) {
                return 0;
            }
            return (source.x + target.x) / 2;
        })
        .attr('y', function (d: Link) {
            const source = d.source as Node;
            const target = d.target as Node;

            if (!source.y || !target.y) {
                return 0;
            }
            return (source.y + target.y) / 2;
        })
        .attr('dy', '-5');
}

function updateNodes(nodesTag: d3Tag, nodes: Node[], dragHandler: DragBehavior) {
    nodesTag.selectAll('text')
        .data(nodes)
        .join('text')
        .text(function (d: Node) {
            return d.name;
        })
        .attr('x', function (d: Node) {
            return d.x ?? 0;
        })
        .attr('y', function (d: Node) {
            return d.y ?? 0;
        })
        .attr('dy', function () {
            return 5;
        })
        .call(dragHandler as any);
}


export function createFamilyTree(nodes: Node[], links: Link[], size: WindowSize, tags: FamilyTreeTags): d3.Simulation<Node, Link> {
    const dragHandler = d3.drag<SVGTextElement, Node>()
        .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
        })
        .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        });

    const tickUpdate = () => {
        updateLinks(tags.linksTag, links);
        updateLinkLabels(tags.linkLabelsTag, links);
        updateNodes(tags.nodesTag, nodes, dragHandler);
    }

    const simulation = d3.forceSimulation(nodes)
        .force('charge', d3.forceManyBody().strength(-100))
        .force('center', d3.forceCenter(size.width / 2, size.height / 2))
        .force('link', d3.forceLink<Node, Link>().links(links))
        .on('tick', tickUpdate);

    return simulation;
}
