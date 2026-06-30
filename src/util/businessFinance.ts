import { BusinessBlueprint } from 'types/Business';
import { JobPosition } from 'types/Work';

// Pure business-finance + demand math (task 033), so the revenue model is unit-testable without a scene.
// Households generate per-category demand; businesses supply it bounded by capacity (staffing × throughput),
// competing for a category's demand in proportion to capacity. Revenue = unitsSold × price; P&L = revenue −
// materials − fixed − payroll.

export interface BusinessPnl {
    revenue: number;
    materialsCost: number;
    fixedCosts: number;
    payroll: number;
    pnl: number;
}

// Cost of the input materials to produce one unit of output.
export function unitMaterialCost(blueprint: BusinessBlueprint, materialPrices: Record<string, number>): number {
    let cost = 0;
    for (const [material, amount] of Object.entries(blueprint.materialsPerUnit ?? {})) {
        cost += amount * (materialPrices[material] ?? 0);
    }
    return cost;
}

export function computeBusinessPnl(revenue: number, materialsCost: number, fixedCosts: number, payroll: number): BusinessPnl {
    return { revenue, materialsCost, fixedCosts, payroll, pnl: revenue - materialsCost - fixedCosts - payroll };
}

// One competitor in a category's market: its key and how many units it can serve this month.
export interface DemandBusiness {
    key: string;
    category: string;
    capacity: number;
}

// Distributes each category's monthly demand among its businesses in proportion to capacity, capped by each
// business's capacity (an oversupplied category leaves everyone below capacity; an undersupplied one runs them
// at capacity with demand to spare). Returns units sold per business key. Pure/deterministic.
export function resolveDemand(businesses: DemandBusiness[], demandByCategory: Record<string, number>): Map<string, number> {
    const capacityByCategory = new Map<string, number>();
    for (const business of businesses) {
        capacityByCategory.set(business.category, (capacityByCategory.get(business.category) ?? 0) + business.capacity);
    }

    const unitsSold = new Map<string, number>();
    for (const business of businesses) {
        const totalCapacity = capacityByCategory.get(business.category) ?? 0;
        const demand = demandByCategory[business.category] ?? 0;
        const share = totalCapacity > 0 ? (demand * business.capacity) / totalCapacity : 0;
        unitsSold.set(business.key, Math.min(business.capacity, share));
    }
    return unitsSold;
}

// Aggregate B2B material demand (task 035): the total units of each input material the operating businesses
// need this month — each business needs `unitsSold × materialsPerUnit[material]` of each of its inputs. This
// is the demand local producers compete to supply (their products are these materials). Pure/deterministic.
export function aggregateMaterialDemand(consumers: { unitsSold: number; materialsPerUnit?: Record<string, number> }[]): Record<string, number> {
    const demand: Record<string, number> = {};
    for (const consumer of consumers) {
        for (const [material, perUnit] of Object.entries(consumer.materialsPerUnit ?? {})) {
            demand[material] = (demand[material] ?? 0) + consumer.unitsSold * perUnit;
        }
    }
    return demand;
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
