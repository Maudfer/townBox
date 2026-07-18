// Entity resolution for log rendering (LP-14 / proposal simulation-aliveness-2 M5). Log entries carry
// typed entity params (target: 'p37', object: 'cream_jar', destination: 'building:9-9') that the HUD used
// to render as raw id suffixes — or not at all for action entries, where most of the social targets live.
// This resolves each param to a display name at RENDER time (never baked into the log: ids survive the
// asset re-identification, and a name can grow its † when its bearer dies) plus, for people, the
// materialized Person instance so the chip can open their inspector.

import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Workplace from 'game/world/Workplace';
import House from 'game/world/House';
import { isAliveAt } from 'util/kinship';

export interface ResolvedParam {
    key: string;
    text: string; // display name (never a raw id when we can do better)
    person?: Person; // materialized referent — chip click opens their inspector
}

// One piece of a templated label (LP-14 layer 3): plain text, or a resolved param rendered inline —
// "Hugged {target}" becomes [text "Hugged ", param(Ana Souza)]. Person params stay clickable inline.
export interface LabelSegment {
    text: string;
    param?: ResolvedParam;
}

// Renders a (possibly templated) label against resolved params. Placeholders consume their param;
// unreferenced params are returned as leftovers so the caller can append them as chips — an untemplated
// label degrades to exactly the pre-template rendering.
export function renderLabelSegments(label: string, resolved: ResolvedParam[]): { segments: LabelSegment[]; leftovers: ResolvedParam[] } {
    const segments: LabelSegment[] = [];
    const used = new Set<string>();
    const parts = label.split(/\{(\w+)\}/g); // odd indices are placeholder keys
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!;
        if (index % 2 === 0) {
            if (part.length > 0) {
                segments.push({ text: part });
            }
            continue;
        }
        const param = resolved.find(candidate => candidate.key === part);
        if (param) {
            used.add(param.key);
            segments.push({ text: param.text, param });
        } else {
            segments.push({ text: part.replace(/_/g, ' ') }); // undeclared placeholder (validator-guarded) — degrade readably
        }
    }
    return { segments, leftovers: resolved.filter(param => !used.has(param.key)) };
}

// Person ids in params come from person-typed parameters ('target') and counterpart sources ('from',
// 'with'). Anything whose value matches a pool person resolves as one.
export function resolveLogParams(game: GameManager, params: Record<string, string | number | boolean>): ResolvedParam[] {
    const resolved: ResolvedParam[] = [];
    const pool = game.population?.getPeople() ?? {};
    const tick = game.clock?.getCurrentTick() ?? 0;
    for (const [key, raw] of Object.entries(params)) {
        const value = String(raw);
        // A pool person: full name, † when deceased, chip when materialized.
        const genPerson = pool[value];
        if (genPerson) {
            const dead = !isAliveAt(genPerson, tick);
            const name = `${genPerson.firstName} ${genPerson.familyName}${dead ? ' †' : ''}`;
            const materialized = game.field?.getPeople().find(person => person.social.getPersonId() === value);
            resolved.push({ key, text: name, ...(materialized ? { person: materialized } : {}) });
            continue;
        }
        // A location key ('building:9-9', 'home', 'outside', 'venue:bar'): name the place.
        if (value.startsWith('building:')) {
            const building = game.field?.getTile?.(...keyToRowCol(value.slice('building:'.length)) as [number, number]);
            if (building instanceof Workplace && building.getBusiness()) {
                resolved.push({ key, text: building.getBusiness()!.name });
                continue;
            }
            if (building instanceof House) {
                resolved.push({ key, text: 'a house' });
                continue;
            }
            resolved.push({ key, text: 'a building' });
            continue;
        }
        if (value === 'home' || value === 'outside' || value.startsWith('venue:')) {
            resolved.push({ key, text: value.startsWith('venue:') ? `the ${value.slice('venue:'.length).replace(/_/g, ' ')}` : value });
            continue;
        }
        // An object archetype: its authored label.
        const archetype = game.inventory?.getArchetype(value);
        if (archetype) {
            resolved.push({ key, text: archetype.label ?? value.replace(/_/g, ' ') });
            continue;
        }
        resolved.push({ key, text: value });
    }
    return resolved;
}

function keyToRowCol(key: string): [number, number] {
    const [row, col] = key.split('-').map(Number);
    return [row ?? 0, col ?? 0];
}
