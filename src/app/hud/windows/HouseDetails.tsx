import { FC, useEffect, useRef, useState } from 'react';
import { RndResizeCallback } from 'react-rnd';
import * as d3 from 'd3';

import Window from 'hud/Window';
import House from 'game/House';

import { DetailsWindowProps, WindowSize } from 'types/HUD';

interface Node extends d3.SimulationNodeDatum {
    name: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
    source: number | Node;
    target: number | Node;
    label: string;
}

const INITIAL_WIDTH = 300;
const INITIAL_HEIGHT = 250;

const HouseDetails: FC<DetailsWindowProps> = ({ game, index, data, onClose }) => {
    const initialSize: WindowSize = { width: INITIAL_WIDTH, height: INITIAL_HEIGHT };
    const [size, setSize] = useState(initialSize);

    const svgSize = { width: size.width * 0.8, height: size.height * 0.8 };

    const house = data as House;
    const family = house?.getFamily();

    const handleResize: RndResizeCallback = (e, direction, ref, delta, position) => {
        console.log("Resizing", ref.offsetWidth, ref.offsetHeight);
        setSize({
            width: ref.offsetWidth,
            height: ref.offsetHeight,
        });
    };

    const nodes: Node[] = [
        { name: 'Pedro' },
        { name: 'Felipe' },
        { name: 'Jack' },
        { name: 'Howard' },
        { name: 'Juliana' },
        { name: 'Heloisa' },
        { name: 'Thais' },
        { name: 'Chris' },
    ];

    const links: Link[] = [
        { source: 0, target: 1, label: 'Brother' },
        { source: 0, target: 2, label: 'Brother' },
        { source: 0, target: 3, label: 'Brother' },
        { source: 1, target: 6, label: 'Spouse' },
        { source: 3, target: 4, label: 'Spouse' },
        { source: 3, target: 7, label: 'Spouse' },
        { source: 4, target: 5, label: 'Sibling' },
        { source: 4, target: 7, label: 'Sibling' }
    ];

    useEffect(() => {
        console.log("House details", data);
        if (!size) {
            return;
        }

        d3.select('svg').append('g').attr('class', 'links');
        d3.select('svg').append('g').attr('class', 'link-labels');
        d3.select('svg').append('g').attr('class', 'nodes');

        console.log("Creating simulation", size.width / 2, size.height / 2);

        const simulation = d3.forceSimulation(nodes)
            .force('charge', d3.forceManyBody().strength(-100))
            .force('center', d3.forceCenter(size.width / 2, size.height / 2))
            .force('link', d3.forceLink<Node, Link>().links(links))
            .on('tick', ticked);

        const drag = d3.drag<SVGTextElement, Node>()
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

        function updateLinks() {
            d3.select('.links')
                .selectAll('line')
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

        function updateLinkLabels() {
            d3.select('.link-labels')
                .selectAll('text')
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

        function updateNodes() {
            d3.select('.nodes')
                .selectAll('text')
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
                .call(drag);
        }

        function ticked() {
            updateLinks();
            updateLinkLabels();
            updateNodes();
        }

        return () => {
            simulation.stop();
            simulation.on('tick', null);
            d3.select(".nodes").remove();
            d3.select(".links").remove();
            d3.select(".link-labels").remove();
        };

    }, [size]);

    return (
        <Window
            game={game}
            index={index}
            title={`Casa ${family?.familyName}`}
            initialSize={initialSize}
            onClose={onClose}
            onResize={handleResize}
        >
            <div className="house-details">
                <div id="family-tree">
                    <svg width={svgSize.width} height={svgSize.height}></svg>
                </div>
            </div>
        </Window>
    );
};

export default HouseDetails;