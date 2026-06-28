import { JobPosition } from 'types/Work';

// Per-job-title staffing summary for the workplace inspector (task 028). Pure so it is unit-testable without
// React: `all` is the business's full establishment, `open` the still-unfilled positions; filled = total − open.
export interface PositionSummary {
    title: string;
    total: number;
    open: number;
    filled: number;
}

export function summarizePositions(all: JobPosition[], open: JobPosition[]): PositionSummary[] {
    const totals = new Map<string, number>();
    for (const position of all) {
        totals.set(position.title, (totals.get(position.title) ?? 0) + 1);
    }
    const opens = new Map<string, number>();
    for (const position of open) {
        opens.set(position.title, (opens.get(position.title) ?? 0) + 1);
    }

    const summary: PositionSummary[] = [];
    for (const [title, total] of totals) {
        const openCount = opens.get(title) ?? 0;
        summary.push({ title, total, open: openCount, filled: total - openCount });
    }
    return summary.sort((a, b) => a.title.localeCompare(b.title));
}
