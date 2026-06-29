# [Feature] Materials & products production/consumption chain

- **Type:** Feature / Economy + Content
- **Labels:** `feature`, `economy`, `data`, `business`, `framework-followup`
- **Depends on:** 033 (the demand model + per-unit materials this builds on), 020 (business P&L). Pairs with 034.

> **Re-scoped:** the **household demand model** (consumers → per-category demand → demand-driven business
> revenue) moved to [033](033-expand-business-blueprints_DONE.md). This task is now the **B2B supply-chain layer on
> top of it**: businesses *produce* products that are other businesses' input materials, so a business's
> `unitMaterialCost` becomes demand on upstream producers (inter-business demand) in addition to 033's
> household demand. The summary below predates that split — read it as the products/supply-chain half.

## Summary

Turn the materials/products stubs into a real **supply chain**: businesses **produce** goods/services from
input **materials**, households (and other businesses) **consume** them, and that demand drives business
revenue. This deepens the economy from the coarse revenue model (020) into an actual production/consumption
loop, and is the explicit "products" piece deferred in 013.

## Background / current state (verified)

- `json/materials.json` is a stub: `{ label, basePrice }` per material (groceries, medical, school, food,
  building). `BusinessBlueprint.materialsPerMonth` (per-material `qty` `Curve` over size) exists and is bought
  in 020. `BusinessBlueprint.products` exists but is **empty** (reserved in 013).
- 020 models revenue coarsely (units × material cost × markup, capped by capacity). 019 has households spending
  on cost-of-living without choosing specific goods.
- `types/Business.ts` already reserves `products?: Record<string, unknown>` — to be typed by this task.

## Goals / Requirements

1. **Define a products model.** Type `products` in `BusinessBlueprint`: what a business outputs (goods or
   services), at what rate (a `Curve` over size/staff), consuming its `materialsPerMonth`. Add a
   `json/products.json` reference table (label, category, base price) if products need their own identities
   distinct from materials.
2. **Model demand & consumption.** Households consume products as part of cost-of-living (refine 019): map a
   household's spend onto actual product categories (food, healthcare, education, retail goods, …), satisfied
   by local businesses producing them. A business with no nearby demand for its product earns less.
3. **Business-to-business materials.** A business's input materials can be the products of another business
   (e.g. a restaurant buys from a wholesaler/farm), forming a short supply chain. Keep it shallow and
   data-driven; avoid deep recursive resolution at runtime (precompute mappings where possible).
4. **Feed revenue (020).** Replace/augment 020's coarse revenue with product-demand-driven revenue: revenue =
   products sold (bounded by demand and capacity) × price. Keep it tunable in JSON.
5. **Keep it cheap.** This runs city-wide monthly; use aggregate demand per product category per locality, not
   per-household-per-shop transactions, to stay within the Big-O budget.
6. **Validation & determinism.** Cross-check product/material references; deterministic monthly resolution;
   save any new economic state.

## Out of scope

- Logistics/transport of goods on the map (abstract it as locality-based demand).
- Player-set prices / market UI (the business inspector 028 can display, not control).

## Acceptance criteria

- Businesses produce products from materials; households consume products via cost-of-living; product demand
  drives business revenue (replacing/refining 020's coarse model).
- A short business→business supply chain works (one business's product is another's material).
- References validate; monthly resolution is deterministic and within budget; state round-trips.
- `npm test` passes with supply/demand unit tests.

## Notes

- This is what lets "bad prices/wages cause bankruptcies" be *structural* (a business in a saturated market or
  with thin margins fails) rather than just a tuning artifact. Land after 020 so there's a revenue model to
  refine.
