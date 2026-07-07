# [Foundation] Data-schema registry, validators & CI gate

- **Type:** Foundation / Tooling + Framework
- **Labels:** `framework`, `data`, `validation`, `ci`, `enrichment-arc`
- **Depends on:** — (first implementation task of the [038](038-simulation-enrichment-architecture_DONE.md) arc)
- **Blocks:** every schema added by 040–053 must register here on day one.

## Goal

Standardize how every file-based data schema (events, actions, skills, jobs, businesses, objects, object-action relationships, …) is parsed and validated, through **one central data-schema registry**, and make invalid data fail **loudly** in development and CI instead of silently no-opping at runtime.

## Background (verified)

- All `src/json/*` files are direct bundler imports with TypeScript casts and **no runtime structural validation** (see [038 §2](038-simulation-enrichment-architecture_DONE.md) for the full per-file inventory).
- Cross-file consistency exists only in `test/contentConsistency.test.ts` (jobs ↔ skills ↔ businesses ↔ materials ↔ demand) and `test/eventCompiler.test.ts:11` (zero compiler warnings).
- The worst gap: a typo'd effect kind in `events.json` reaches `EventEngine.applyEffect`, falls through the switch, and **returns `true` silently** — the event records to history with no effect applied. `acquireSkill` with an unknown skill id silently no-ops. Nothing catches either.

## Requirements

1. **Registry.** A scene-free module (suggested: `util/data/registry.ts`) where every file-based schema registers:
   - its **parser** (today: the imported JSON value; the hook exists so future formats can normalize),
   - its **structural validator** (required fields, types, enum values, defaults, invalid shape),
   - its **semantic / cross-reference validator** (dangling ids across files, duplicate ids, invalid requirement predicates, invalid effect kinds, invalid parameter bindings, …),
   - its **schema version**, where appropriate.
2. **Register all existing files:** `events.json`, `jobs.json`, `businesses.json`, `materials.json`, `skills.json`, `demand.json`, `economy.json`, `population.json`, `lifeSimulation.json`, `householdDraw.json`, `bootstrap.json` (the scene/HUD manifests — `assets/config/input/toolAssets` — get at least structural checks; keep them cheap).
3. **Basic validators for all existing files**, closing the known silent holes at minimum:
   - `events.json`: every `effects[].type` ∈ `EffectType`; `acquireSkill` values ∈ `skills.json` weights; `setAttr` attrs ∈ the compiler's known-attribute set; `emit` signal names ∈ a declared signal list; compiler warnings promoted to validator errors.
   - `population.json.ticksPerYear` must equal the Clock's `getTicksPerYear()` constant (today 360; changes in 040).
   - Port `contentConsistency.test.ts` assertions into the registry's semantic validators (the test then simply runs the registry).
4. **Loud failure.** A `validateAll()` entry point that throws with a readable per-file error report. Wire it into game boot in development (fail the boot, not skip entries) and into a Jest test so **CI gates on it** (`npm test` and the coverage workflow already run on PRs — no new workflow needed unless a standalone `npm run validate-data` script is cheaper for content-authoring iteration; add the script regardless).
5. **Invalid fixtures.** Representative *invalid* fixture files under `test/fixtures/` exercising each validator class (missing field, bad enum, dangling ref, duplicate id), so validators are tested rather than only run against currently-valid data.
6. **`CLAUDE.md` directive.** Add to §5 (working agreements): *every new file-based data schema must register a parser, structural validator, and semantic validator in the registry, with invalid fixtures*, in the same PR that introduces the schema.

## Non-goals

- No new schemas (objects/actions land in 041/043). No external schema library unless clearly justified (a hand-rolled checker over the existing TS types is fine and dependency-free; justify `zod`/`ajv` in the PR if chosen).

## Testing

- Registry unit tests: valid data passes; each invalid fixture fails with the expected error.
- The shipped `src/json/*` files pass `validateAll()` (this replaces/absorbs `contentConsistency.test.ts` — keep the file as the runner or delete it in favor of the registry test; don't keep two sources of truth).
- `npm test` + `npm run typecheck` green.
