# Content planning artifacts

Name-level planning material for the **simulation enrichment arc** ([task 038](../tasks/038-simulation-enrichment-architecture_DONE.md)), produced by [task 049](../tasks/049-content-planning-lists_DONE.md). These are **planning inputs, not runtime data**: the data-backfill tasks ([050](../tasks/050-objects-data-backfill.md)–[053](../tasks/053-object-action-relationships-backfill.md), plus [045](../tasks/045-job-shifts-and-work-actions.md)/[052](../tasks/052-events-data-backfill.md)) curate from these lists into validated JSON. Traceability (object→setting, business→setting, job→business, action→job, event→source) is preserved here even where the final JSON won't retain it.

All counts below are script-verified and restated at the top of each artifact.

| Artifact | Contents | Counts |
|---|---|---|
| [`settings-and-objects.md`](settings-and-objects.md) | Settings (locations/rooms/contexts), each filled with the objects found there | **54 settings**, 1,565 raw object entries |
| [`objects-master-list.md`](objects-master-list.md) | Deduped master object list: category, example settings, portability guess | **1,506 unique objects**, 21 categories (782 pocketable / 463 carryable / 158 heavy / 103 fixed) |
| [`businesses-and-jobs.md`](businesses-and-jobs.md) | Business types with demand-category + setting links; per-business jobs; deduped job-title catalog | **163 businesses**, **720 job entries → 213 deduped titles** |
| [`work-actions.md`](work-actions.md) | Shared continuous + discrete work-action catalogs (theme-grouped, with per-job usage) and a per-job mapping (≥5 + ≥5 each) | **505 continuous / 508 discrete** distinct actions across 213 jobs |
| [`events-master-list.md`](events-master-list.md) | Master life-event list: slug, trigger types, category, likely action/system source | **680 unique events** — 531 probabilistic / 518 manual / 369 both, 24 categories |

Notes:

- The settings list doubles as a venue/business vocabulary (business→setting links are in `businesses-and-jobs.md`); keep it until the venue model ([040](../tasks/040-hourly-ticks-and-execution-boundary.md)'s `LogicalLocation`, [055](../tasks/055-history-asset-pipeline.md)'s offline world) has consumed what it needs.
- The events artifact folds "automated" under its **manual** tag (system-fired); the precise `probabilistic | manual | automated` trigger split is decided per event during [048](../tasks/048-events-revision-hourly-migration.md)/[052](../tasks/052-events-data-backfill.md) against the [042](../tasks/042-event-triggers-and-causation.md) schema.
- Lists were generated from single-source datasets + scripts (kept out of the repo); extending them is cheap — regenerate rather than hand-edit large sections.
