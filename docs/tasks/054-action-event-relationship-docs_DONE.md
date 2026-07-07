# [Docs] Document the Action ↔ Event relationships & lifecycle flows

- **Type:** Documentation
- **Labels:** `docs`, `actions`, `events`, `enrichment-arc`
- **Depends on:** [048](048-events-revision-hourly-migration_DONE.md), [051](051-actions-data-backfill_DONE.md)–[053](053-object-action-relationships-backfill_DONE.md) (the relationships it documents)
- **Status:** ✅ Done — `docs/simulation-relationships.md` is generated from the manifests by `util/simulationDocs.ts` and gated by a checked-diff test (regenerate with `npm run docs:sim`); `docs/simulation-flows.md` carries the four lifecycle Mermaid flows; CLAUDE.md links both and got the arc coherence pass.

## Goal

Actions and Events are tightly coupled at the data level by design ([038 §7](038-simulation-enrichment-architecture_DONE.md)) — coders must manage that relationship deliberately. Produce the artifact(s) that make it manageable: a table / flowchart / diagram set showing existing Action↔Event relationships, trigger sources, and the important lifecycle flows.

## Requirements

- **Generated, not hand-drawn, wherever possible:** the relationships live in validated JSON, so derive the artifact from the data (a small script emitting a Mermaid diagram + markdown tables from `actions.json`/`events.json`/`object-action-relationships.json` is ideal — it can't go stale silently, and can run in CI to refresh or diff).
- Contents at minimum:
  - the Action → triggered-Event map (per lifecycle transition) and the Event → source-Action/system reverse map;
  - trigger-type breakdown per event (probabilistic / manual / automated, with schedule rules);
  - the key lifecycle flows as sequence/flow diagrams: Woke up → obligation → commute (boundary wait) → Work Action → `started_working`; shift end → completion + automated fallback; a cook-and-eat chain with object transformations; a social gift transfer with causation chain.
- Placement: `docs/` (e.g. `docs/simulation-flows.md` + generated includes), linked from `CLAUDE.md` §4 and the tasks README.
- Update `CLAUDE.md`'s architecture sections (§4.13 and the §1 feature summary) to describe the enrichment arc's end state — per directive §5.7 the relevant PRs will have updated pieces incrementally; this task does the coherence pass.

## Testing

- If generated: the generator runs in CI (or as a checked diff) so the artifact matches the shipped data; a unit test over the generator's extraction logic.
