# [Content prep] Pre-initiative content planning lists

- **Type:** Content planning / Data-name generation
- **Labels:** `content`, `planning`, `data`, `enrichment-arc`
- **Depends on:** [038](038-simulation-enrichment-architecture_DONE.md) (defines what the lists feed)
- **Feeds:** [050](050-objects-data-backfill.md)–[053](053-object-action-relationships-backfill.md) (the JSON backfills), [045](045-job-shifts-and-work-actions.md) (per-job work actions)
- **Status:** ✅ Done — executed alongside the planning pass; artifacts live under [`docs/planning/`](../planning/).

## Goal

Generate the raw *name-level* material — with traceability between entities — that the data backfills will turn into runtime JSON. This is deliberately a planning artifact, not runtime data: the final JSON does not need to retain every planning category, but the planning artifact preserves the relationships (object→setting, business→setting, job→business, action→job, event→action).

## Deliverables (in `docs/planning/`)

1. **`settings-and-objects.md`** — 45+ settings (hospital, classroom, bedroom, kitchen, office, park, beach, …), each filled with ~25–35 objects found there. The settings technique exists to force variety across domains; the setting names are retained because they also inform businesses/venues.
2. **`objects-master-list.md`** — the deduped master object list, **≥ 1,200 unique names**, categorized, with example-setting traceability and a first-pass portability tag (`pocketable`/`carryable`/`heavy`/`fixed`).
3. **`businesses-and-jobs.md`** — **≥ 100 business types** (with demand-category and setting links), **≥ 4 jobs each** (> 400 entries pre-dedupe), plus a deduped job-title catalog with business traceability.
4. **`work-actions.md`** — per deduped job title: **≥ 5 continuous** work Actions (gerund phrases) and **≥ 5 discrete** work Actions (past-tense log lines, including mundane flavor like "Complained about the time", "Misplaced a document"); organized as shared catalogs (actions reused across jobs) plus a per-job mapping.
5. **`events-master-list.md`** — **≥ 500 probabilistic** and **≥ 500 manual** event names post-dedupe (one event may be both), covering the whole life arc plus mundane texture, with category and likely action/system source for manual ones.
6. A categorization/cross-linking pass so entities reference one another consistently.

## Delivered counts (script-verified)

54 settings (1,565 raw object entries) → **1,506 unique objects** in 21 categories; **163 businesses**; **720 job
entries → 213 deduped job titles**; **505 continuous + 508 discrete** work actions (≥5+5 per job); **680 unique
events** (531 probabilistic / 518 manual / 369 both) in 24 categories. See [`docs/planning/README.md`](../planning/README.md).

## Notes

- Counts are verified programmatically (row counts stated at the top of each artifact).
- These lists are *inputs*, not contracts: the backfill tasks curate, prune, and adapt (e.g. an object name that turns out to be un-modelable is dropped, an event that is really an Action moves lists) — see each backfill task's curation requirements.
