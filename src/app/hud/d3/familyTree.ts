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

            // == null (not falsy): 0 is a legitimate coordinate.
            if (source.x == null || target.x == null) {
                return 0;
            }
            return (source.x + target.x) / 2;
        })
        .attr('y', function (d: Link) {
            const source = d.source as Node;
            const target = d.target as Node;

            if (source.y == null || target.y == null) {
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
            // Mark the deceased so cross-household trees read clearly (e.g. orphans' late parents).
            return d.alive === false ? `${d.name} †` : d.name;
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
        // Deceased people are dimmed; members of this household are emphasised.
        .attr('opacity', function (d: Node) {
            return d.alive === false ? 0.45 : 1;
        })
        .attr('font-weight', function (d: Node) {
            return d.isSubject ? 'bold' : 'normal';
        })
        .attr('font-style', function (d: Node) {
            return d.alive === false ? 'italic' : 'normal';
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- d3 .call() typing friction with the DragBehavior overload
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

    // Keep every node inside the SVG (with a margin for the text label): without this the simulation pushes
    // outer generations past the viewport edge, clipping their names (task-012 live-verification fix).
    const PADDING = 28;
    const clampToBounds = () => {
        for (const node of nodes) {
            node.x = Math.max(PADDING, Math.min(size.width - PADDING, node.x ?? size.width / 2));
            node.y = Math.max(PADDING, Math.min(size.height - PADDING, node.y ?? size.height / 2));
        }
    };

    const tickUpdate = () => {
        clampToBounds();
        updateLinks(tags.linksTag, links);
        updateLinkLabels(tags.linkLabelsTag, links);
        updateNodes(tags.nodesTag, nodes, dragHandler);
    }

    // Generational layout (LP-10): nodes carry a `generation` level from the graph builder — each level is
    // pinned hard to its own horizontal row (grandparents above, children below), with the force sim left
    // to spread nodes WITHIN a row (x repulsion + collide + links pulling couples/parents together). Dense
    // asset genealogies rendered as a force hairball before; rows make the structure legible at a glance.
    // Nodes without a generation (the legacy residents-based builder) fall back to the vertical centre.
    const generations = nodes.map(node => node.generation).filter((generation): generation is number => generation !== undefined);
    const minGeneration = generations.length ? Math.min(...generations) : 0;
    const maxGeneration = generations.length ? Math.max(...generations) : 0;
    const rows = Math.max(1, maxGeneration - minGeneration + 1);
    const rowHeight = (size.height - 2 * PADDING) / Math.max(1, rows);
    const rowY = (node: Node): number => node.generation === undefined
        ? size.height / 2
        : PADDING + rowHeight * (node.generation - minGeneration + 0.5);

    const simulation = d3.forceSimulation(nodes)
        .force('charge', d3.forceManyBody().strength(-120))
        .force('link', d3.forceLink<Node, Link>().links(links).distance(60))
        .force('collide', d3.forceCollide<Node>(26))
        .force('x', d3.forceX(size.width / 2).strength(0.06))
        .force('y', d3.forceY<Node>(rowY).strength(0.9)) // the generational row pin
        .on('tick', tickUpdate);

    return simulation;
}

