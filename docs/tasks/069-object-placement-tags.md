# [Framework] Contextual placement tags — objects, buildings & businesses

- **Type:** Framework / Data schema + Content
- **Labels:** `objects`, `buildings`, `data-schema`, `progression-arc`
- **Depends on:** [056](056-progression-arc-discovery-baseline_DONE.md)
- **Blocks:** [070](070-contextual-object-generation.md) (generation consumes the tags), [071](071-building-context-action-requirements.md)

## Goal

A many-to-many **placement-tag** system: object archetypes declare where they plausibly occur
(`toothbrush → bathroom`; `pencil → classroom, office, home-office, school-supplies`), and buildings/businesses
declare which contexts they contain (`house → bedroom, bathroom, kitchen, living-room, …`;
`clinic → reception, exam-room, medical-storage, …`). Tags represent **environmental context inside a
building** — rooms are not simulated and never will be; a tag means "this context exists here," not a
coordinate.

## Background (verified)

`objects.json` archetypes already have a `tags` field — but it is an **activity/interest axis** (22 tags:
`work`, `leisure`, `giftable`, `snack`, …) consumed by `ObjectQuery` matching; placement is a **new, third
axis** and must not collide with it. `businesses.json` blueprints have no tags; **no house/residence data file
exists**. The tag vocabulary input is ready: `docs/planning/settings-and-objects.md` (54 settings) and
`objects-master-list.md`'s `example settings` column (a ready-made object→setting mapping — planning input, not
runtime format; do **not** store runtime data as one-category-per-list documents). Tag values in `objects.json`
are currently validated only as strings — no vocabulary check exists.

## Requirements

### Schema

- **Vocabulary:** a checked-in controlled vocabulary of placement tags (its own small registered data file, or
  a dedicated section — one source of truth), curated from the 54 settings into building-relevant context tags
  (`bedroom`, `bathroom`, `kitchen`, `living-room`, `laundry`, `storage`, `home-office`, `classroom`,
  `staff-room`, `cafeteria`, `playground`, `office`, `reception`, `exam-room`, `medical-storage`,
  `waiting-room`, `bench-area`, `walking-path`, `outdoor`, `school-supplies`, `first-aid`, `workshop`,
  `kitchen-commercial`, …). Public-space settings (street, bus stop) may be deferred — only tags a building or
  business can carry belong now; note deferred ones for the future venue model.
- **Objects:** archetypes gain `placement?: string[]` (separate field from the activity `tags`) plus
  per-object **generation metadata** under `generation?`: `{ weight?, minPerBuilding?, maxPerBuilding?,
  uniquePerBuilding?, kind: 'fixture' | 'consumable' | 'reusable' | 'loose', ownershipDefault?:
  'building' | 'business' | 'household' | 'none', accessibility? }` (070 consumes; keep `accessibility` a
  minimal enum — e.g. `public | staff | private` — with semantics defined in 070/071).
- **Businesses:** blueprints gain `tags: string[]` (the contexts that business type contains).
- **Residences:** houses have no data file — add one (e.g. `json/residences.json`: the house context-tag set,
  plus room for future house-type variety), registered like every other schema. Explicit per-building overrides
  ride the future; blueprint/type-level tags suffice now.
- **Validation** (039 registry, invalid fixtures): every `placement` value and every building/business tag
  exists in the vocabulary; generation metadata bounds sane (`min ≤ max`, weight > 0, unique ⇒ max 1);
  **closed-loop rules** — every vocabulary tag is carried by ≥ 1 object *and* ≥ 1 building/business context
  (no dead tags), and every building/business tag intersects ≥ 1 object's placement (no context that generates
  nothing). Fixtures for each.

### Backfill

- Seed `placement` across the 1,517 archetypes from the master list's `example settings` column (traceability
  preserved: object→setting mapping came from 049). Script-assisted generation is fine (the 049 pattern);
  hand-curate the vocabulary mapping, regenerate rather than hand-edit at scale.
- Tag the ~21 business blueprints and the house from the settings each plausibly contains
  (`businesses-and-jobs.md` has business→setting links).

## Non-goals

Actual instance generation (070). Room simulation, coordinates, per-room capacity — never. Action requirement
backfill (071). Reworking the existing activity-tag axis.

## Testing

- `npm run validate-data` green over the full backfill; vocabulary/closed-loop/metadata fixtures reject.
- Coverage stats test (non-brittle floors): ≥ N% of archetypes carry placement tags; every business blueprint
  and the residence file carry ≥ 1 tag.
- The activity-tag axis is untouched (existing `ObjectQuery`/OAR tests green).
