import { evaluateCurve } from 'util/curve';
import { BusinessBlueprint } from 'types/Business';
import { JobPosition } from 'types/Work';

// Pure business-finance math (task 020), so the revenue model is unit-testable without a scene. Coarse and
// data-driven: a business buys its monthly materials, sells them at the blueprint's markup, and pays fixed
// costs + payroll. P&L = revenue − materials − fixed − payroll. A richer demand/locality model is task 035.
export interface BusinessPnl {
    revenue: number;
    materialsCost: number;
    fixedCosts: number;
    payroll: number;
    pnl: number;
}

export function computeBusinessPnl(
    blueprint: BusinessBlueprint,
    size: number,
    payroll: number,
    materialPrices: Record<string, number>
): BusinessPnl {
    let materialsCost = 0;
    for (const [material, spec] of Object.entries(blueprint.materialsPerMonth ?? {})) {
        const quantity = evaluateCurve(spec.qty, size);
        materialsCost += quantity * (materialPrices[material] ?? 0);
    }

    const markup = blueprint.economics?.priceMarkup ?? 1;
    const revenue = materialsCost * markup;
    const fixedCosts = blueprint.economics?.fixedCostsPerMonth ? evaluateCurve(blueprint.economics.fixedCostsPerMonth, size) : 0;
    const pnl = revenue - materialsCost - fixedCosts - payroll;

    return { revenue, materialsCost, fixedCosts, payroll, pnl };
}

// The positions a business gains when it grows from one size to the next: the per-title increase, taken from
// the larger establishment. Used to append open slots without disturbing already-filled positions (task 020).
export function positionDelta(current: JobPosition[], grown: JobPosition[]): JobPosition[] {
    const currentByTitle = new Map<string, number>();
    for (const position of current) {
        currentByTitle.set(position.title, (currentByTitle.get(position.title) ?? 0) + 1);
    }

    const running = new Map<string, number>();
    const added: JobPosition[] = [];
    for (const position of grown) {
        const count = (running.get(position.title) ?? 0) + 1;
        running.set(position.title, count);
        if (count > (currentByTitle.get(position.title) ?? 0)) {
            added.push(position);
        }
    }
    return added;
}
