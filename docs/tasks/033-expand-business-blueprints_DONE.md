# [Feature] Demand-driven business revenue + expanded blueprints

- **Type:** Feature / Economy + Content
- **Labels:** `feature`, `economy`, `business`, `data`, `framework-followup`
- **Depends on:** 020 (business P&L it refines), 018 (payroll), 019 (households as consumers), 017 (ledger)
- **Supersedes:** the coarse `revenue = materials × markup` placeholder in `util/businessFinance.ts` (020)
- **Status:** ✅ **Done** (033a + 033b). **033a** (demand-model core): `demand.json`,
  `resolveDemand`/`unitMaterialCost`, refactored `computeBusinessPnl`, `City.runBusinessEconomics` rewired.
  **033b** (bundled with 034): `json/businesses.json` expanded from 5 → **18 blueprints** across **9 demand
  categories** (added retail, leisure, services, hospitality; plus bakery/café/pharmacy/clinic), each tuned with
  per-unit margins over its category price, with matching `demand.json` + `materials.json` entries and a
  `test/contentConsistency.test.ts` cross-check. ⬜ **033c** (Tier-2: locality/catchment + price elasticity)
  remains **optional**, to revisit only if profiling/feel warrants.

## Summary

Replace the placeholder business revenue from 020 with a **demand-driven model**: households *consume*
categories of goods/services each month, businesses *supply* that demand, and they **compete** for it by
capacity (and, later, location and price). Revenue then reflects a real market — a business in a **saturated**
category, an **understaffed** one, or one with **thin margins** loses money and fails (021), while a growing
**population** supports more businesses (growth, 020). This is what makes "bad numbers cause bankruptcies" and
"people lose their homes" *structural* rather than a tuning artifact.

Then **greatly expand `json/businesses.json`** with many more lines of work, each tagged with a demand
**category** and tuned against the model so the city has a believable, mixed economy.

> Scope note: the *runtime* demand/consumption was originally sketched for 035. Per maintainer direction it
> lives here (it is inseparable from per-blueprint demand parameters, which are this task's domain). **035 is
> re-scoped** to the products / inter-business **supply chain** that layers on top of this model (one
> business's product is another's input material).

## Background / current state (verified)

- 020 computes revenue in `util/businessFinance.ts` `computeBusinessPnl` as `materialsCost × priceMarkup`,
  where `materialsCost = Σ materialsPerMonth.qty(size) × materials.basePrice`. It ignores customers entirely,
  so revenue depends only on the business's own size — every business of a line of work earns the same
  regardless of how many exist or how many people live nearby. Most seeded blueprints run at a loss because
  fixed costs dominate (acknowledged placeholder).
- `City.runBusinessEconomics` (monthly tick, gated by `Economy.lastEconomyMonth`) calls `computeBusinessPnl`,
  applies the income side to the business balance, records `lastPnl` + `profitStreak`, and grows fully-staffed
  profitable businesses (`Workplace.expandPositions`).
- Consumers exist: materialized residents are `field.getStructures()` → `House` → `getResidents()`, each with a
  pool `personId` and an `Economy` balance (017) and (optionally) an age/employment via the engine context.
- `BusinessBlueprint` (`types/Business.ts`) has `friendlyName`, `size`, `jobs`, `materialsPerMonth`, `products`
  (empty), `economics` (`priceMarkup`, `fixedCostsPerMonth`). `Workplace.getEmployees()` gives filled staffing.

## Part A — The demand model

### A1. Categories

Every blueprint declares a **`category`** (a string): the kind of good/service it sells, e.g. `groceries`,
`dining`, `healthcare`, `education`, `retail`, `leisure`, `services`, `civic`, `construction`. Multiple
blueprints can share a category (a supermarket and a corner shop both serve `groceries`) — they compete in it.

### A2. Demand generation (consumers → demand per category)

Each in-game month, compute **city demand per category** from the materialized population:

```
demand[cat] = Σ over residents of  perCapita[cat] × modifier(cat, resident)
```

- `perCapita[cat]` — base monthly units a person consumes of the category (`json/demand.json`).
- `modifier(cat, resident)` — optional, data-driven multipliers so demand is demographically/financially
  plausible (start simple; all default to 1):
  - **demographic:** `education` only from households with minors; `healthcare` rises with age (a `Curve` over
    `age`); `dining`/`leisure` scale with disposable income.
  - **income elasticity:** wealthier residents consume more of discretionary categories (a `Curve` over the
    resident's `Economy` balance). Necessities (`groceries`) are inelastic.

This is one O(residents) pass per month. Aggregate **city-wide** in v1 (locality is A6).

### A3. Capacity (businesses' ability to serve)

A business can only serve so many customers a month:

```
capacity[b] = filledPositions(b) × throughputPerEmployee[category]
```

- `throughputPerEmployee[cat]` — units one worker serves per month (`json/demand.json`, optional per-blueprint
  override). This ties **staffing → revenue**: an understaffed business has low capacity (caps its revenue),
  an overstaffed one wastes payroll. Hiring (015) and growth (020) raise capacity.

### A4. Allocation (the market — competition)

For each category, split that month's demand among its businesses **proportionally to capacity, capped by
capacity**:

```
totalCapacity[cat] = Σ_b capacity[b]
unitsSold[b] = min( capacity[b],  demand[cat] × capacity[b] / totalCapacity[cat] )
```

Behaviour this produces (the point of the whole task):
- **Oversupplied category** (Σcapacity ≫ demand): every business sells well below capacity → low revenue →
  the weakest (thin margins / high fixed costs) post losses → bankruptcy (021). The market self-corrects.
- **Undersupplied** (demand > Σcapacity): businesses run at full capacity, profitable → they grow (020) and
  new ones placed in that category thrive. Unmet demand is the signal a category is a good investment.
- **Population growth** raises `demand[cat]` → supports more businesses over time.

### A5. Revenue, materials & P&L (replaces 020's coarse revenue)

Materials become **per-unit-of-output** instead of size-based, so cost scales with what's actually sold:

```
unitMaterialCost[b] = Σ_material  materialsPerUnit[material] × materials.basePrice[material]
materialsCost[b]    = unitsSold[b] × unitMaterialCost[b]
revenue[b]          = unitsSold[b] × unitMaterialCost[b] × priceMarkup
pnl[b]              = revenue[b] − materialsCost[b] − fixedCosts(size) − payroll
```

So per-unit gross margin = `unitMaterialCost × (markup − 1)`; net = gross × unitsSold − fixed − payroll. A
business with a healthy markup but low sales (saturated/understaffed) still loses to fixed + payroll.

**Schema migration:** `materialsPerMonth` (qty `Curve` over size) → `materialsPerUnit` (a flat per-unit
amount, or a small map of material→qty per unit). Document and migrate the seeded blueprints.

### A6. Tier-2 refinements (note now, implement later if needed)

- **Locality / catchment.** Replace city-wide demand with demand per coarse map **region**; each business
  serves its region + a catchment radius, competing only locally. Keeps it `O(businesses × catchmentCells)`.
  Makes location matter (a shop far from homes starves). Defer until the city is large enough to warrant it.
- **Price elasticity.** Weight a business's demand share by price (lower `priceMarkup` captures more share) via
  an elasticity `Curve`, so undercutting competitors is a real strategy.

### A7. Special categories

- **`construction`** — demand is **not** household consumption; it comes from building placement (a per-month
  construction backlog seeded when the player places structures). Model as a city-level demand source feeding
  construction businesses; document the simplest version (e.g. each placed structure adds N construction units
  consumed over the following months).
- **`civic`** (police/fire/public school) — population-funded public services, not a consumer market. For now
  either exclude from the market model (flat city subsidy) or treat as inelastic per-capita demand; note the
  decision (a real city budget/taxation is a future task).

## Part B — Expanded blueprints (original scope, tuned to the model)

- **Add many blueprints** across categories — bakery, café, pharmacy, clinic, university, bank, office, factory,
  warehouse, gym, cinema, hardware store, clothing store, hotel, police/fire/civic, etc. Each declares
  `category`, a believable job mix (varied `Curve` shapes), `throughputPerEmployee` (or use the category
  default), `materialsPerUnit`, and `economics`.
- **Tune against the demand model** so the seeded city is mixed: some categories slightly oversupplied (a few
  failures), some undersupplied (room to grow) — not all-profit or all-bankrupt. This is data tuning enabled by
  Part A; it finally makes the placeholder loss-making numbers from 020 realistic.
- Keep job/skill references consistent with 034; every referenced job/skill must exist.

## Integration points (code)

- `json/demand.json` (new): per-category `perCapita`, `throughputPerEmployee`, optional demographic/income
  `Curve` modifiers. `types/Demand.ts` for its shape.
- `types/Business.ts` `BusinessBlueprint`: add `category`; replace `materialsPerMonth` with `materialsPerUnit`
  (+ optional `throughputPerEmployee` override).
- `util/businessFinance.ts`: a pure `resolveDemand(businessesByCategory, demandByCategory) → Map<business,
  unitsSold>` and a refactored `computeBusinessPnl(revenue, materialsCost, fixedCosts, payroll)` (now fed the
  demand-derived revenue/materials rather than computing them from size). Keep both pure + unit-tested.
- `City.runBusinessEconomics`: (1) compute `demand[cat]` from residents once, (2) compute `capacity[b]` from
  `Workplace.getEmployees()`, (3) `resolveDemand`, (4) per business compute revenue/materials → P&L → balance,
  reusing the existing streak/growth logic. A new `City.computeDemand()` helper does the resident pass.
- Surface in UI: `WorkplaceDetails` can show units sold / capacity utilisation alongside the existing P&L; the
  city overview (031) can show per-category supply vs demand.

## Determinism & performance

- No RNG; pure aggregation. Monthly cost ≈ `O(residents + businesses)` for the city-wide tier — cheap even at
  scale. The locality tier (A6) adds a bounded `O(businesses × catchmentCells)`. Demand state needs no new
  save fields (recomputed each month from balances/population, which already persist).

## Implementation phases

1. **033a — Demand model core.** `demand.json` + `types/Demand.ts`; `category` + `materialsPerUnit` on
   blueprints (migrate the 5 seeded ones); `resolveDemand` + refactored `computeBusinessPnl`; rewire
   `City.runBusinessEconomics`. Unit + integration tests. (Code.)
2. **033b — Blueprint expansion.** Add the many new blueprints/categories and tune the seed for a mixed
   economy. (Mostly data.)
3. **033c (optional) — Tier-2:** locality/catchment and/or price elasticity, if profiling/feel warrants.

## Tests

- `resolveDemand`: oversupplied category (all below capacity, shares sum to demand), undersupplied (all at
  capacity), single business (sells `min(capacity, demand)`), zero capacity (no sales). Deterministic.
- `computeBusinessPnl` (refactored): revenue/materials from unitsSold; profit vs loss cases.
- Integration: a city with N residents and competing businesses yields the expected per-business unitsSold and
  P&L sign; adding population raises revenue; adding a competitor lowers each one's share.
- Cross-reference/staffing validation for the expanded blueprints (jobs/skills/categories all resolve).

## Acceptance criteria

- Business revenue is demand-driven: it scales with local population and **falls when a category is
  oversupplied**; understaffing reduces it. The 020 coarse `materials × markup` revenue is removed.
- `businesses.json` is substantially expanded, every blueprint has a `category` and resolvable jobs, and the
  seeded city shows a realistic mix of thriving and failing businesses (feeding 021/022).
- Deterministic; `npm test` passes with the new demand + finance tests.

## Notes / relationship to other tasks

- **020** provides the P&L scaffold (streak, growth, the monthly tick) this slots revenue into; this task
  removes 020's placeholder revenue.
- **021/022** consume the now-meaningful losses (bankruptcy → unemployment → arrears → eviction).
- **035** becomes the supply-chain layer: businesses produce `products` consumed as other businesses' input
  materials, turning `unitMaterialCost` into demand on upstream businesses (B2B demand) on top of this
  household-demand model.
