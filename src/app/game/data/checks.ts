// Small shape-checking helpers shared by the schema validators (game/data/validators/*). Each check reports
// through the IssueCollector and returns whether the value passed, so validators can guard deeper descent.
// Hand-rolled on purpose: the shapes are simple, and a schema library would be a new dependency for little gain.

import { IssueCollector } from 'game/data/registry';

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkRecord(issues: IssueCollector, path: string, value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) {
        issues.add(path, `expected an object, got ${describe(value)}`);
        return false;
    }
    return true;
}

export function checkArray(issues: IssueCollector, path: string, value: unknown): value is unknown[] {
    if (!Array.isArray(value)) {
        issues.add(path, `expected an array, got ${describe(value)}`);
        return false;
    }
    return true;
}

export interface NumberOptions {
    min?: number;
    max?: number;
    integer?: boolean;
}

export function checkNumber(issues: IssueCollector, path: string, value: unknown, options: NumberOptions = {}): value is number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.add(path, `expected a number, got ${describe(value)}`);
        return false;
    }
    if (options.integer && !Number.isInteger(value)) {
        issues.add(path, `expected an integer, got ${value}`);
        return false;
    }
    if (options.min !== undefined && value < options.min) {
        issues.add(path, `expected >= ${options.min}, got ${value}`);
        return false;
    }
    if (options.max !== undefined && value > options.max) {
        issues.add(path, `expected <= ${options.max}, got ${value}`);
        return false;
    }
    return true;
}

export function checkString(issues: IssueCollector, path: string, value: unknown, nonEmpty = true): value is string {
    if (typeof value !== 'string') {
        issues.add(path, `expected a string, got ${describe(value)}`);
        return false;
    }
    if (nonEmpty && value.length === 0) {
        issues.add(path, 'expected a non-empty string');
        return false;
    }
    return true;
}

export function checkBoolean(issues: IssueCollector, path: string, value: unknown): value is boolean {
    if (typeof value !== 'boolean') {
        issues.add(path, `expected a boolean, got ${describe(value)}`);
        return false;
    }
    return true;
}

export function checkEnum(issues: IssueCollector, path: string, value: unknown, allowed: readonly string[]): value is string {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        issues.add(path, `expected one of [${allowed.join(', ')}], got ${describe(value)}`);
        return false;
    }
    return true;
}

// Unknown keys are almost always typos ("trigger" for "triggers"); reject them so bad data fails loudly
// instead of being silently ignored by the consumer.
export function checkUnknownKeys(issues: IssueCollector, path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            issues.add(path ? `${path}.${key}` : key, `unknown key (allowed: ${allowed.join(', ')})`);
        }
    }
}

export function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function describe(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'an array';
    }
    return typeof value;
}
