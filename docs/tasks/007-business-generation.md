# [Feature] Business generation for work buildings + job/skill data

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `jobs`, `data`

## Summary

When a **work-type building** is placed, generate a **business** for it: a generated **name** and a
**line of work**. Lines of work come from a **JSON file** of business types a city needs (seed it
with examples: hospital, market, etc.). Each business type declares the **jobs it needs** with a
**position multiplier** per job (e.g. a hospital needs more doctors than cleaners). Jobs are defined
in their own **JSON file** with the **skills** they require, wired to the existing person skill
system. When a business is placed, **people get hired**, and the business tracks which **positions
still need filling**. Hiring should be more likely based on **proximity to the candidate's home**
and **matching skills**.

As with the single residential house type today, there is **one** work-building type/visual for now;
this task is about the data and simulation, **not visuals**.

## Background / current state

- **Placement:** the `Work` tool places a `Workplace` (`Field.build()` → `new Workplace(...)`).
  **There is no `workplaceBuilt` event** — `Field.build()` emits `houseBuilt` only for houses, and
  `City` only listens for `houseBuilt` (`City.setupHousehold`). So work buildings currently get **no
  business/jobs generated on placement.**
- **Workplace:** `Workplace.ts` hard-codes 10 identical `Constructor` jobs in its constructor and
  exposes `hire(person)` which matches a job whose `requirements` are all in the person's skills,
  plus `layoff()`, `getEmployees()`, occupant/garage tracking.
- **Jobs/skills:** `types/Work.ts` defines `JobPosition` (`title`, `salary`, `requirements:
  JobRequirement[]`) and the `JobRequirements` enum, which currently has **only**
  `ConstructionSkill`. `WorkLife` (`game/WorkLife.ts`) gives every person a single
  `ConstructionSkill` and stores their `job`.
- **People/addresses:** `Person.social.getHome()` returns the person's `House`; buildings have a
  tile position (`getPosition()`) and entrance, so distance between a candidate's home and a
  workplace is computable.
- **City:** `City.ts` owns the city and population and is the natural owner of business/hiring
  orchestration. Name generation elsewhere uses `@faker-js/faker` (`fakerPT_BR`).
- **Data conventions:** game data lives in `src/json/` (e.g. `assets.json`, `config.json`,
  `input.json`, `toolAssets.json`).

## Goals / Requirements

### Data files

1. **Businesses JSON** (e.g. `src/json/businesses.json`): a list of business types a city needs.
   Each entry defines at least: a type key/name, a display label, and a list of **required jobs**
   with a **position multiplier** per job (relative weighting of how many of each job the business
   needs). Seed with several realistic examples (e.g. hospital, market/grocery, school, restaurant)
   — a hospital should weight doctors/nurses higher than cleaners.
2. **Jobs JSON** (e.g. `src/json/jobs.json`): defines each job (title, base salary, and the
   **skills** it requires). Skills must align with the person **skill system** (`JobRequirements`).
3. **Skills:** expand the `JobRequirements` enum (`types/Work.ts`) beyond `ConstructionSkill` to
   cover the skills referenced by the seeded jobs, and update `WorkLife` so people can have a varied
   set of skills (rather than everyone having only `ConstructionSkill`). Keep it data-driven where
   practical.

### Business generation on placement

4. Add a **`workplaceBuilt`** event (to `types/Events.ts` `EventPayloads`) emitted from
   `Field.build()` when a `Workplace` is placed (mirroring `houseBuilt`).
5. On `workplaceBuilt`, `City` generates a **business**: pick a business type from the JSON, generate
   a **name** (faker), and assign its **line of work**. Build the business's **open positions** from
   its required jobs × position multipliers, replacing the hard-coded 10 `Constructor` jobs in
   `Workplace`. The workplace must **track which positions are filled vs. still open**.
6. Store the business identity (name, type/line of work) on the `Workplace` (and expose it for future
   UI).

### Hiring

7. When a business is placed (and positions are open), **hire people** from the existing population.
   A candidate is eligible if their **skills match** a job's requirements (extend the current
   `Workplace.hire()` skill-matching to the new multi-skill jobs).
8. **Hiring likelihood** must increase with (a) **shorter distance** between the candidate's home and
   the workplace and (b) **better skill match**. Implement a scoring/weighting that combines these so
   nearby, well-matched candidates are preferred.
9. On hire, set the person's job (`WorkLife.setJob`) and add them to the workplace's `employees`;
   decrement the open position. Keep `layoff()` consistent (returns the position to the open pool).

### General

10. The game builds (`npm run dev`) and `npm test` passes. Add unit tests for: business generation
    from JSON (positions expand correctly by multiplier), skill-matching, and the distance+skill
    hiring weighting.

## Out of scope

- Visuals / multiple work-building art (one type for now, like the single house type).
- The commute loop itself (`006-job-commute-pathfinding.md`) — this task only assigns jobs/employers.
- Wages economy, firing/turnover simulation, and business finances.
- Re-running hiring over time as new residents arrive (initial hiring at placement is enough; a
  follow-up can add ongoing recruitment).

## Acceptance criteria

- Placing a work building creates a named business with a line of work and an open-positions list
  derived from JSON business/job definitions and multipliers.
- People are hired based on a weighting that favors proximity (home↔workplace) and skill match; the
  workplace tracks filled vs. open positions.
- Job and skill definitions live in JSON and are wired to the person skill system.
- `npm test` passes with the new unit tests.

## Notes

- Reuse `Building.getPosition()` / tile coordinates (and `GameManager` coordinate helpers) to
  compute home↔workplace distance; Manhattan or Euclidean tile distance is fine — document the
  choice.
- Keep generation deterministic/seedable where feasible to support save reproducibility and tests.
- Coordinate with `003-save-load-system.md` (businesses, jobs, and employment must serialize) and
  `004-household-generation-redesign.md` (skills may be assigned during person generation).
