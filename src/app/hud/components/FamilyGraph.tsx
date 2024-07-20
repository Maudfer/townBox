import React, { useRef, useEffect } from 'react';
import d3, { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

interface FamilyNode {
    id: string;
    firstName: string;
    familyName: string;
    age: number;
    gender: string;
    relationships: Record<string, string>;
}

interface FamilyGraphProps {
    nodes: SimulationNodeDatum[];
    links: SimulationLinkDatum<SimulationNodeDatum>[];
}

const FamilyGraph: React.FC<FamilyGraphProps> = ({ nodes, links }) => {
    const svgRef = useRef<SVGSVGElement | null>(null);

    useEffect(() => {
        const width = 400;
        const height = 300;

        const svg = d3.select(svgRef.current)
            .attr("width", width)
            .attr("height", height);

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id((d: any) => d.id).distance(50))
            .force("charge", d3.forceManyBody().strength(-150))
            .force("center", d3.forceCenter(width / 2, height / 2));

        const link = svg.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(links)
            .enter().append("line")
            .attr("stroke-width", 2);

        const node = svg.append("g")
            .attr("class", "nodes")
            .selectAll("circle")
            .data(nodes)
            .enter().append("circle")
            .attr("r", 10)
            .attr("fill", "blue")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        const text = svg.append("g")
            .attr("class", "texts")
            .selectAll("text")
            .data(nodes)
            .enter().append("text")
            .attr("dx", 12)
            .attr("dy", ".35em")
            .text(d => d.firstName);

        simulation
            .nodes(nodes)
            .on("tick", ticked);

        simulation.force("link")
            .links(links);

        function ticked() {
            link
                .attr("x1", d => (d.source as FamilyNode).x)
                .attr("y1", d => (d.source as FamilyNode).y)
                .attr("x2", d => (d.target as FamilyNode).x)
                .attr("y2", d => (d.target as FamilyNode).y);

            node
                .attr("cx", d => d.x)
                .attr("cy", d => d.y);

            text
                .attr("x", d => d.x)
                .attr("y", d => d.y);
        }

        function dragstarted(event: any, d: FamilyNode) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event: any, d: FamilyNode) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event: any, d: FamilyNode) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
    }, [nodes, links]);

    return <svg ref={svgRef}></svg>;
};

export default FamilyGraph;
