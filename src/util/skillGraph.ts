// The skill dependency-graph compiler (task 059): flat manifest in, DAG out — the EventCompiler pattern.
// Pure and deterministic; the data validator promotes its errors, and the SkillBook consults the compiled
// graph for dependency gating. Multiple prerequisites are allowed (a DAG, not a tree).

import { SkillManifest, SkillDependency } from 'types/Skill';

export interface CompiledSkills {
    // Every skill id in deterministic topological order (dependencies before dependents).
    topoOrder: string[];
    // skill id -> its declared dependencies (empty array when none).
    dependenciesOf: Record<string, SkillDependency[]>;
    // Structural problems: missing refs, cycles, bad thresholds, basic-with-deps. Non-empty = invalid.
    errors: string[];
}

export function compileSkills(manifest: SkillManifest): CompiledSkills {
    const errors: string[] = [];
    const ids = Object.keys(manifest).sort();
    const dependenciesOf: Record<string, SkillDependency[]> = {};

    for (const id of ids) {
        const definition = manifest[id]!;
        const dependencies = definition.dependencies ?? [];
        dependenciesOf[id] = dependencies;
        if (definition.basic && dependencies.length > 0) {
            errors.push(`${id}: basic skills must have no dependencies`);
        }
        const seen = new Set<string>();
        for (const dependency of dependencies) {
            if (!(dependency.skill in manifest)) {
                errors.push(`${id}: unknown dependency '${dependency.skill}'`);
            }
            if (dependency.skill === id) {
                errors.push(`${id}: depends on itself`);
            }
            if (seen.has(dependency.skill)) {
                errors.push(`${id}: duplicate dependency '${dependency.skill}'`);
            }
            seen.add(dependency.skill);
            if (!(dependency.minProficiency > 0 && dependency.minProficiency <= 100)) {
                errors.push(`${id}: dependency '${dependency.skill}' minProficiency must be in (0, 100], got ${dependency.minProficiency}`);
            }
        }
    }

    // Kahn's algorithm over sorted ids for a deterministic topo order; leftovers = cycles.
    const indegree = new Map<string, number>(ids.map(id => [id, 0]));
    for (const id of ids) {
        for (const dependency of dependenciesOf[id]!) {
            if (dependency.skill in manifest) {
                indegree.set(id, (indegree.get(id) ?? 0) + 1);
            }
        }
    }
    const dependents = new Map<string, string[]>();
    for (const id of ids) {
        for (const dependency of dependenciesOf[id]!) {
            if (!(dependency.skill in manifest)) {
                continue;
            }
            const list = dependents.get(dependency.skill) ?? [];
            list.push(id);
            dependents.set(dependency.skill, list);
        }
    }
    const queue = ids.filter(id => (indegree.get(id) ?? 0) === 0);
    const topoOrder: string[] = [];
    while (queue.length > 0) {
        queue.sort();
        const id = queue.shift()!;
        topoOrder.push(id);
        for (const dependent of dependents.get(id) ?? []) {
            const remaining = (indegree.get(dependent) ?? 0) - 1;
            indegree.set(dependent, remaining);
            if (remaining === 0) {
                queue.push(dependent);
            }
        }
    }
    if (topoOrder.length !== ids.length) {
        const cyclic = ids.filter(id => !topoOrder.includes(id)).sort();
        errors.push(`dependency cycle involving: ${cyclic.join(', ')}`);
    }

    return { topoOrder, dependenciesOf, errors };
}
