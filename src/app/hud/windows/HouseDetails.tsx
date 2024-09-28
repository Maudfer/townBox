import { FC, useEffect, useState } from 'react';
import { RndResizeCallback } from 'react-rnd';
import * as d3 from 'd3';

import House from 'game/House';
import Window from 'hud/Window';
import { createFamilyTree } from 'hud/d3/familyTree';

import { DetailsWindowProps, WindowSize } from 'types/HUD';
import { Node, Link, FamilyTreeTags } from 'types/FamilyTree';

const INITIAL_WIDTH = 300;
const INITIAL_HEIGHT = 250;

const LINKS_CLASS = 'links';
const LINK_LABELS_CLASS = 'link-labels';
const NODES_CLASS = 'nodes';

const HouseDetails: FC<DetailsWindowProps> = ({ game, index, data, onClose }) => {
    const initialSize: WindowSize = { width: INITIAL_WIDTH, height: INITIAL_HEIGHT };
    const [size, setSize] = useState(initialSize);

    const svgSize = { width: size.width * 0.8, height: size.height * 0.8 };

    const house = data as House;
    const family = house?.getFamily();

    const familyTreeId = `family-tree-${family?.familyId}`;
    
    const linksSelector = `#${familyTreeId} .${LINKS_CLASS}`;
    const linkLabelsSelector = `#${familyTreeId} .${LINK_LABELS_CLASS}`;
    const nodesSelector = `#${familyTreeId} .${NODES_CLASS}`;

    const handleResize: RndResizeCallback = (_event, _direction, ref, _delta, _position) => {
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
        { source: 0, target: 1, label: 'Father' },
        { source: 0, target: 2, label: 'Brother' },
        { source: 0, target: 3, label: 'Brother' },
        { source: 1, target: 6, label: 'Spouse' },
        { source: 3, target: 4, label: 'Spouse' },
        { source: 3, target: 7, label: 'Spouse' },
        { source: 4, target: 5, label: 'Sibling' },
        { source: 4, target: 7, label: 'Sibling' }
    ];

    const links2 = [
        [
            { source: 0, target: 1, label: 'Father' },
            { source: 0, target: 2, label: 'Spouse' },
            { source: 0, target: 3, label: 'Brother' },
            { source: 1, target: 6, label: 'Spouse' },
            { source: 3, target: 4, label: 'Spouse' },
            { source: 3, target: 7, label: 'Spouse' },
            { source: 4, target: 5, label: 'Sibling' },
            { source: 4, target: 7, label: 'Sibling' }
        ],
        [
            { source: 0, target: 1, label: 'Brother' },
            { source: 0, target: 2, label: 'Brother' },
            { source: 0, target: 3, label: 'Brother' },
            { source: 1, target: 6, label: 'Spouse' },
            { source: 3, target: 4, label: 'Spouse' },
            { source: 3, target: 7, label: 'Spouse' },
            { source: 4, target: 5, label: 'Sibling' },
            { source: 4, target: 7, label: 'Sibling' }
        ]
    ];

    function resetD3Containers(tags: FamilyTreeTags) {
        const { nodesTag, linksTag, linkLabelsTag } = tags;

        if (nodesTag) nodesTag.empty();
        if (linksTag) linksTag.empty();
        if (linkLabelsTag) linkLabelsTag.empty();
    }

    useEffect(() => {
        if (!size) {
            return;
        }

        const nodesTag = d3.select(nodesSelector);
        const linksTag = d3.select(linksSelector);
        const linkLabelsTag = d3.select(linkLabelsSelector);
    
        const tags: FamilyTreeTags = {
            nodesTag,
            linksTag,
            linkLabelsTag,
        };

        resetD3Containers(tags);
        const familyTreeGraph = createFamilyTree(nodes, links, size, tags);

        return () => {
            familyTreeGraph?.stop();
            familyTreeGraph?.on('tick', null);
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
                    <svg id={familyTreeId} width={svgSize.width} height={svgSize.height}>
                        <g className={LINKS_CLASS}></g>
                        <g className={LINK_LABELS_CLASS}></g>
                        <g className={NODES_CLASS}></g>
                    </svg>
                </div>
            </div>
        </Window>
    );
};

export default HouseDetails;