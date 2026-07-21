import * as d3 from 'd3';
import { FC, useEffect, useMemo, useState } from 'react';
import { RndResizeCallback } from 'react-rnd';

import House from 'game/world/House';
import Window from 'hud/Window';
import { createFamilyTree } from 'hud/d3/familyTree';
import { buildGenealogyTree } from 'util/familyGraph';

const TREE_DEPTH = 2;

import { DetailsWindowProps, WindowSize } from 'types/HUD';
import { FamilyTree, FamilyTreeTags } from 'types/FamilyTree';

const INITIAL_WIDTH = 800;
const INITIAL_HEIGHT = 700;

const LINKS_CLASS = 'links';
const LINK_LABELS_CLASS = 'link-labels';
const NODES_CLASS = 'nodes';

const HouseDetails: FC<DetailsWindowProps> = ({ game, index, data, z, onFocus, onClose }) => {
    const initialSize: WindowSize = { width: INITIAL_WIDTH, height: INITIAL_HEIGHT };

    const [size, setSize] = useState<WindowSize>(initialSize);

    const svgSize = { width: size.width * 0.8, height: size.height * 0.8 };

    const house = data as House;
    const household = house?.getHousehold();

    const familyTreeId = `family-tree-${household?.id}`;
    
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

    // Derived (not stored): a snapshot of the tree for the current house/clock. Prefer the genealogy pool
    // (cross-household tree incl. deceased ancestors); fall back to the residents-only tree when no
    // pool/household is available (e.g. legacy saves).
    const familyTree = useMemo<FamilyTree | undefined>(() => {
        if (!house) {
            return undefined;
        }
        const population = game?.population;
        const currentHousehold = house.getHousehold();
        if (population && currentHousehold && currentHousehold.memberIds.length) {
            const placed = new Set(population.getState().placedIds);
            const currentTick = game?.clock?.getCurrentTick() ?? 0;
            return buildGenealogyTree(population.getPeople(), currentHousehold.memberIds, currentTick, placed, TREE_DEPTH);
        }
        return house.getFamilyTree();
    }, [house, game]);

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
        // Lay out against the SVG's actual dimensions (0.8 × window), not the window size — otherwise the
        // centre/bounds are off and the outer nodes clip past the right/bottom edges (task-012 fix).
        const familyTreeGraph = createFamilyTree(nodes, links, { width: size.width * 0.8, height: size.height * 0.8 }, tags);

        return () => {
            familyTreeGraph?.stop();
            familyTreeGraph?.on('tick', null);
        };
    }, [size, familyTree, nodesSelector, linksSelector, linkLabelsSelector]);

    return (
        <Window
            game={game}
            index={index}
            z={z}
            onFocus={onFocus}
            title={`Casa ${house?.getHouseholdName() ?? ''}`}
            testId="window-house"
            initialSize={initialSize}
            onClose={onClose}
            onResize={handleResize}
        >
            <div className="house-details">
                {house && house.getResidents().length > 0 && (
                    <div className="house-residents" style={{ padding: '0 8px 4px' }}>
                        <h4 style={{ margin: '4px 0' }}>Residents</h4>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {house.getResidents().map((resident, residentIndex) => (
                                <li
                                    key={residentIndex}
                                    data-testid="house-resident"
                                    // Content-width so only the NAME is the click target (task 131 follow-up
                                    // #3): a full-width row put the clickable centre mid-window, where a large
                                    // 800px sibling inspector could still cover it. This is also better UX.
                                    style={{ cursor: 'pointer', textDecoration: 'underline', width: 'fit-content' }}
                                    onClick={() => game.emit('PersonSelected', resident)}
                                >
                                    {resident.social.getFullName()} <small>({resident.social.getAge()})</small>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
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