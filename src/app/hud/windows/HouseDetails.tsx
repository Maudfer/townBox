import { FC, useEffect, useState } from 'react';
import { RndResizeCallback } from 'react-rnd';
import * as d3 from 'd3';

import House from 'game/House';
import Window from 'hud/Window';
import { createFamilyTree } from 'hud/d3/familyTree';

import { DetailsWindowProps, WindowSize } from 'types/HUD';
import { Node, Link } from 'types/FamilyTree';

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
    const svgSelector = `#${familyTreeId}`;
    
    const linksSelector = `#${familyTreeId} .${LINKS_CLASS}`;
    const linkLabelsSelector = `#${familyTreeId} .${LINK_LABELS_CLASS}`;
    const nodesSelector = `#${familyTreeId} .${NODES_CLASS}`;

    const selectors = {
        nodesSelector,
        linksSelector,
        linkLabelsSelector,
    };

    const handleResize: RndResizeCallback = (_event, _direction, ref, _delta, _position) => {
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

    function createD3Containers() {
        d3.select(svgSelector).append('g').attr('class', LINKS_CLASS);
        d3.select(svgSelector).append('g').attr('class', LINK_LABELS_CLASS);
        d3.select(svgSelector).append('g').attr('class', NODES_CLASS);
    }

    function deleteD3Containers() {
        d3.select(nodesSelector).remove();
        d3.select(linksSelector).remove();
        d3.select(linkLabelsSelector).remove();
    }

    useEffect(() => {
        console.log("House details", data);
        if (!size) {
            return;
        }

        createD3Containers();
        const familyTreeGraph = createFamilyTree(nodes, links, size, selectors);

        return () => {
            familyTreeGraph.stop();
            familyTreeGraph.on('tick', null);
            deleteD3Containers();
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
                    <svg id={familyTreeId} width={svgSize.width} height={svgSize.height}></svg>
                </div>
            </div>
        </Window>
    );
};

export default HouseDetails;