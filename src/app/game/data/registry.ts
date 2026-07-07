// The central data-schema registry (docs/tasks/039-data-schema-registry-and-validators.md). Every file-based
// data schema (src/json/*) registers a parsed payload plus two validator passes:
//
//  - validateStructure: shape-only — required fields, types, enum values, unknown keys. Runs against the raw
//    imported value, so it must never assume the cast type is honest.
//  - validateSemantics: cross-reference — dangling ids across files, orphan producers, unknown skills/signals.
//    Receives every *other* schema's raw data by name (`peers`), and only runs once the whole registry is
//    structurally sound (a malformed peer would make cross-checks crash or lie).
//
// Registration is data, not side effects: game/data/schemas.ts owns the canonical list. Boot calls
// assertValid() so a bad manifest fails loudly instead of silently no-opping at runtime (the pre-039 behaviour
// for e.g. a typo'd effect kind); test/dataValidation.test.ts runs the same check in CI.

export interface ValidationIssue {
    schema: string; // registration name, e.g. "events"
    path: string; // location inside the file, e.g. "death.effects[1].signal"
    message: string;
}

export interface SchemaRegistration {
    name: string;
    // Bump when the file's shape changes incompatibly (consumed by future save/asset tooling; optional today).
    version?: number;
    data: unknown;
    validateStructure(data: unknown, issues: IssueCollector): void;
    validateSemantics?(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void;
}

// Accumulates issues for one schema, so validators just report paths + messages.
export class IssueCollector {
    constructor(private readonly schema: string, private readonly issues: ValidationIssue[]) {}

    add(path: string, message: string): void {
        this.issues.push({ schema: this.schema, path, message });
    }
}

export function validateRegistrations(registrations: SchemaRegistration[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const names = new Set<string>();
    for (const registration of registrations) {
        if (names.has(registration.name)) {
            issues.push({ schema: registration.name, path: '', message: 'duplicate schema registration' });
        }
        names.add(registration.name);
        registration.validateStructure(registration.data, new IssueCollector(registration.name, issues));
    }

    // Semantic (cross-file) validation only over a structurally sound registry; otherwise the structural
    // errors are the actionable report and cross-checks would just add noise (or throw).
    if (issues.length === 0) {
        const peers: Record<string, unknown> = {};
        for (const registration of registrations) {
            peers[registration.name] = registration.data;
        }
        for (const registration of registrations) {
            registration.validateSemantics?.(registration.data, peers, new IssueCollector(registration.name, issues));
        }
    }
    return issues;
}

export function formatIssues(issues: ValidationIssue[]): string {
    const lines = issues.map(issue => `  [${issue.schema}] ${issue.path ? issue.path + ': ' : ''}${issue.message}`);
    return `Data validation failed with ${issues.length} issue(s):\n${lines.join('\n')}`;
}

// Loud failure: throws with the full per-file report. Wired into game boot and the CI test.
export function assertValid(registrations: SchemaRegistration[]): void {
    const issues = validateRegistrations(registrations);
    if (issues.length > 0) {
        throw new Error(formatIssues(issues));
    }
}
