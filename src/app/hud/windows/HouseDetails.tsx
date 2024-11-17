import { FC, useEffect, useState } from 'react';
import { RndResizeCallback } from 'react-rnd';
import * as d3 from 'd3';

import House from 'game/House';
import Window from 'hud/Window';
import { createFamilyTree } from 'hud/d3/familyTree';

import { DetailsWindowProps, WindowSize } from 'types/HUD';
import { FamilyTree, FamilyTreeTags } from 'types/FamilyTree';

const INITIAL_WIDTH = 600;
const INITIAL_HEIGHT = 600;

const LINKS_CLASS = 'links';
const LINK_LABELS_CLASS = 'link-labels';
const NODES_CLASS = 'nodes';

const HouseDetails: FC<DetailsWindowProps> = ({ game, index, data, onClose }) => {
    const initialSize: WindowSize = { width: INITIAL_WIDTH, height: INITIAL_HEIGHT };

    const [size, setSize] = useState<WindowSize>(initialSize);
    const [familyTree, setFamilyTree] = useState<FamilyTree>()

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

    function resetD3Containers(tags: FamilyTreeTags) {
        const { nodesTag, linksTag, linkLabelsTag } = tags;

        if (nodesTag) nodesTag.empty();
        if (linksTag) linksTag.empty();
        if (linkLabelsTag) linkLabelsTag.empty();
    }

    useEffect(() => {
        if (!family) {
            return;
        }

        setFamilyTree(family.getFamilyTree());
    }, [family]);

    useEffect(() => {
        if (!size || !familyTree) {
            return;
        }

        const { nodes, links } = familyTree;
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
    }, [size, familyTree]);

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