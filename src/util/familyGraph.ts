import { PersonId, PersonTable } from 'types/Genealogy';
import { FamilyTree, Node, Link } from 'types/FamilyTree';
import { Genders, Relationships } from 'types/Social';
import { isAliveAt, parentsOf, childrenOf, siblingsOf } from 'util/kinship';

// Builds a family-tree graph from the genealogy pool, starting at a household's members and walking outward
// (parents, children, spouses, siblings) up to `depth` hops. Because the whole population is one graph, the
// result naturally spans households and includes deceased ancestors — each node carries `alive`, `placed`
// (lives in some placed household), and `isSubject` (a member of this window's household) so the renderer
// can style them. Pure and deterministic given its inputs.
export function buildGenealogyTree(
    pool: PersonTable,
    seedIds: PersonId[],
    currentTick: number,
    placedIds: Set<PersonId>,
    depth = 2
): FamilyTree {
    const subjects = new Set(seedIds);
    const index = new Map<PersonId, number>();
    const nodes: Node[] = [];

    const addNode = (id: PersonId): void => {
        if (index.has(id)) {
            return;
        }
        const person = pool[id];
        index.set(id, nodes.length);
        nodes.push({
            name: person ? person.firstName : id,
            alive: person ? isAliveAt(person, currentTick) : false,
            placed: placedIds.has(id),
            isSubject: subjects.has(id),
        });
    };

    // BFS over kinship neighbours, bounded by depth.
    const visited = new Set<PersonId>();
    let frontier: PersonId[] = seedIds.filter(id => pool[id]);
    frontier.forEach(addNode);

    for (let hop = 0; hop < depth && frontier.length; hop++) {
        const next: PersonId[] = [];
        for (const id of frontier) {
            if (visited.has(id)) {
                continue;
            }
            visited.add(id);

            const neighbours = [
                ...parentsOf(pool, id),
                ...childrenOf(pool, id),
                ...siblingsOf(pool, id),
                ...spousePartnerIds(pool, id),
            ];
            for (const neighbour of neighbours) {
                if (!pool[neighbour]) {
                    continue;
                }
                if (!index.has(neighbour)) {
                    addNode(neighbour);
                    next.push(neighbour);
                }
            }
        }
        frontier = next;
    }

    const links: Link[] = [];
    for (const [id, sourceIndex] of index) {
        // Parent links (gender-aware label).
        for (const parentId of parentsOf(pool, id)) {
            const targetIndex = index.get(parentId);
            if (targetIndex !== undefined) {
                const parent = pool[parentId]!;
                links.push({
                    source: sourceIndex,
                    target: targetIndex,
                    label: parent.gender === Genders.Male ? Relationships.Father : Relationships.Mother,
                });
            }
        }
        // Spouse links, de-duplicated so each couple is linked once.
        for (const partnerId of spousePartnerIds(pool, id)) {
            const targetIndex = index.get(partnerId);
            if (targetIndex !== undefined && id < partnerId) {
                links.push({ source: sourceIndex, target: targetIndex, label: Relationships.Spouse });
            }
        }
    }

    return { nodes, links };
}

function spousePartnerIds(pool: PersonTable, id: PersonId): PersonId[] {
    const person = pool[id];
    if (!person) {
        return [];
    }
    return person.partnerships.map(partnership => partnership.partnerId).filter(partnerId => !!pool[partnerId]);
}
