// Demand model data (task 033). Each business `category` has a per-capita monthly consumption, a selling
// price per unit, and a per-employee throughput (how many units one worker can serve). Households generate
// demand from `perCapita`; businesses supply it bounded by `throughputPerEmployee × staffing`. See
// docs/tasks/033-expand-business-blueprints.md.

export interface CategoryDemand {
    perCapita: number; // units one resident consumes per month
    throughputPerEmployee: number; // units one employee can serve per month
    pricePerUnit: number; // base selling price per unit (a blueprint's economics.priceMarkup is a premium on it)
}

export type DemandTable = Record<string, CategoryDemand>;
