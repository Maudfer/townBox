# Task backlog

This folder is TownBox's JIRA-style backlog. **Every file here is a well-defined, self-contained piece of work
that is safe to merge to `main` on its own** — clear goals and requirements with accurate references to real
code (see `CLAUDE.md` §5.1). This README is the index.

## Conventions

- **One task → one file → one branch → one PR.** Files are numbered in roughly the order they were created.
- **Done is marked in the filename.** A completed task's file is renamed to append `_DONE` before `.md` (e.g.
  `005-clock-and-calendar-system_DONE.md`), and its row here flips to ✅. A task replaced by a later one gets
  `_SUPERSEEDED`. Keep this index in sync when a task's status changes.
- **Status legend:** ✅ Done · 🚧 Open · ⛔ Superseded.

## Roughly, the arcs

- **001–013** — foundations: Phaser 4, the 3×3 tile grid, save/load, clock, households/genealogy, the daily
  commute, and the procedural-simulation-framework plan.
- **014–037** — employment, the money economy end-to-end (wages → cost of living → business P&L → bankruptcy →
  eviction/homelessness → recovery, B2B materials), household-lifecycle dynamics, the UI/inspector layer, content
  expansion, and CI.
- **038–054** — the simulation-enrichment arc: hourly ticks + the execution boundary, objects/Possessions, the
  Action system, event triggers/causation, the Brain + Job Orchestrator, and the content backfills.
- **055, 076–079** — the offline history-asset pipeline + logical-economy world + generator perf, and the
  pre-055 audit-remediation hardening.
- **056–075** — the progression & context arc: calendar/weekends, school, skill proficiency + a 335-skill DAG,
  job rank ladders + promotions, placement tags + object generation, and interaction contracts/consent.
- **080–106** — the simulation-aliveness arc (proposal `docs/proposals/simulation-aliveness.md`): needs, the
  social graph, counterpart events & reactions, the planner, the Brain rework (bands + one utility currency +
  pause/resume), traits, object capacity + the real market, mood, illness with teeth, street life, vices/habits/
  depression, city services, employment flow + entrepreneurship, career retcons, crime/police/jail, garbage,
  fire, pets, reputation & gossip, the two-band generator, and the validation keystone. One PR.
- **107–118** — the simulation-visibility arc (proposal `docs/proposals/simulation-visibility.md`, same PR):
  venue grounding, the construction menu & civic placement, the police/fire/hospital/garbage/market end-to-end
  chains, the services nagbar, street pets, fire particles, the observation scaffolding, and the generator perf
  pass.

## Index

| Task | Status | Title |
| --- | --- | --- |
| [001](001-upgrade-phaser-4_DONE.md) | ✅ | [Maintenance] Upgrade Phaser 3 → Phaser 4 |
| [002](002-tile-placement-granularity-3x3_DONE.md) | ✅ | [Feature] Subdivide each tile into a 3×3 sub-tile grid |
| [003](003-save-load-system_DONE.md) | ✅ | [Feature] Save & load system |
| [004](004-household-generation-redesign_DONE.md) | ✅ | [Planning] Redesign family generation → household + cross-household genealogy |
| [005](005-clock-and-calendar-system_DONE.md) | ✅ | [Feature] Clock & calendar system |
| [006](006-job-commute-pathfinding_DONE.md) | ✅ | [Feature] Wire jobs to pathfinding — daily work commute loop |
| [007](007-business-generation_SUPERSEEDED.md) | ⛔ | [Feature] Business generation for work buildings + job/skill data |
| [008](008-test-suites-unit-integration_DONE.md) | ✅ | [Test] Integration (Playwright) suite — the browser-level test layer |
| [009](009-github-actions-ci_DONE.md) | ✅ | [Test] GitHub Actions CI pipeline |
| [010](010-marriage-formation-over-time_DONE.md) | ✅ | [Feature] Marriage / partnership formation over time |
| [011](011-emergent-rehousing_DONE.md) | ✅ | [Feature] Emergent re-housing of household survivors |
| [012](012-live-app-verification-clock-population_DONE.md) | ✅ | [Task] Live-app verification pass — clock, population & general gameplay QA |
| [013](013-procedural-simulation-framework_DONE.md) | ✅ | [Planning] File-based procedural simulation framework — blueprints + life events |
| [014](014-people-skills-model_DONE.md) | ✅ | [Feature] People skills model & assignment |
| [015](015-skill-matched-hiring_DONE.md) | ✅ | [Feature] Skill-matched hiring as resource-slot events |
| [016](016-retire-debug-spawning_DONE.md) | ✅ | [Feature] Retire debug/random spawning; source all spawning from the simulation |
| [017](017-money-model_DONE.md) | ✅ | [Feature] Money model: wallets & ledger |
| [018](018-wages-and-payroll_DONE.md) | ✅ | [Feature] Wages & payroll |
| [019](019-cost-of-living_DONE.md) | ✅ | [Feature] Cost of living & household spending |
| [020](020-business-economics_DONE.md) | ✅ | [Feature] Business economics: revenue, materials, P&L & size dynamics |
| [021](021-business-bankruptcy_DONE.md) | ✅ | [Feature] Business bankruptcy & closure |
| [022](022-eviction-and-homelessness_DONE.md) | ✅ | [Feature] Household insolvency: eviction & homelessness |
| [023](023-newlywed-cohabitation_DONE.md) | ✅ | [Feature] Newlywed cohabitation & household merging |
| [024](024-adult-children-move-out_DONE.md) | ✅ | [Feature] Adult children move out / new-household formation |
| [025](025-structure-teardown_DONE.md) | ✅ | [Feature] Structure teardown on bulldoze (residents & businesses) |
| [026](026-entity-selection-model_DONE.md) | ✅ | [Feature] Entity selection model (people & buildings) |
| [027](027-person-inspector-window_DONE.md) | ✅ | [Feature] Person inspector window (with event log) |
| [028](028-workplace-inspector-window_DONE.md) | ✅ | [Feature] Workplace / business inspector window |
| [029](029-city-event-feed_DONE.md) | ✅ | [Feature] City event feed / notifications |
| [030](030-toolbar-and-tools_DONE.md) | ✅ | [Feature] Toolbar wiring & tool selection |
| [031](031-city-overview-window_DONE.md) | ✅ | [Feature] City overview / dashboard window |
| [032](032-expand-life-events_DONE.md) | ✅ | [Feature] Expand the life-event manifest |
| [033](033-expand-business-blueprints_DONE.md) | ✅ | [Feature] Demand-driven business revenue + expanded blueprints |
| [034](034-expand-jobs-and-skills_DONE.md) | ✅ | [Feature] Expand jobs & skills reference tables |
| [035](035-materials-and-products_DONE.md) | ✅ | [Feature] Materials & products production/consumption chain |
| [036](036-pregame-history-bootstrap_DONE.md) | ✅ | [Feature] Pre-game history bootstrap (detailed fast-forward simulation) |
| [037](037-bankrupt-lot-reoccupancy_DONE.md) | ✅ | [Feature] Bankrupt-lot re-occupancy (vacant buildings attract new businesses) |
| [038](038-simulation-enrichment-architecture_DONE.md) | ✅ | [Planning] Simulation enrichment & the execution boundary — architecture proposal + discovery baseline |
| [039](039-data-schema-registry-and-validators_DONE.md) | ✅ | [Foundation] Data-schema registry, validators & CI gate |
| [040](040-hourly-ticks-and-execution-boundary_DONE.md) | ✅ | [Foundation] Hourly ticks, shared tick lifecycle & the simulation execution boundary |
| [041](041-objects-and-possessions_DONE.md) | ✅ | [Core] Objects & Person Possessions |
| [042](042-event-triggers-and-causation_DONE.md) | ✅ | [Core] Event triggers (`manual` / `probabilistic` / `automated`) & causation logging |
| [043](043-actions-core_DONE.md) | ✅ | [Core] Actions: definitions, parameters, shared requirements, lifecycle, pools & sequences |
| [044](044-action-consequences-and-object-action-relationships_DONE.md) | ✅ | [Core] Action Consequences (bounded DSL) & `object-action-relationships.json` |
| [045](045-job-shifts-and-work-actions_DONE.md) | ✅ | [Integration] Job shift schedules & work-Action declarations |
| [046](046-brain-and-hooks_DONE.md) | ✅ | [Integration] Brain & the Hooks pattern |
| [047](047-job-orchestrator_DONE.md) | ✅ | [Integration] The Job Orchestrator |
| [048](048-events-revision-hourly-migration_DONE.md) | ✅ | [Migration] Revise & backfill all existing Events for triggers, hourly ticks & Action links |
| [049](049-content-planning-lists_DONE.md) | ✅ | [Content prep] Pre-initiative content planning lists |
| [050](050-objects-data-backfill_DONE.md) | ✅ | [Content] Objects data backfill (1,200+ archetypes) |
| [051](051-actions-data-backfill_DONE.md) | ✅ | [Content] Actions data backfill (general-purpose + per-job) |
| [052](052-events-data-backfill_DONE.md) | ✅ | [Content] Events data backfill (500 probabilistic + 500 manual) |
| [053](053-object-action-relationships-backfill_DONE.md) | ✅ | [Content] `object-action-relationships.json` backfill |
| [054](054-action-event-relationship-docs_DONE.md) | ✅ | [Docs] Document the Action ↔ Event relationships & lifecycle flows |
| [055](055-history-asset-pipeline_DONE.md) | ✅ | [Feature] Offline history-asset pipeline + asset-fed new game |
| [056](056-progression-arc-discovery-baseline_DONE.md) | ✅ | [Planning] Progression & context arc — discovery and migration baseline |
| [057](057-calendar-weekdays-and-weekends_DONE.md) | ✅ | [Framework] Calendar weekday & weekend support |
| [058](058-school-assignments-and-scheduling_DONE.md) | ✅ | [Feature] School assignments, scheduling & weekend behavior |
| [059](059-skill-proficiency-schema-and-store_DONE.md) | ✅ | [Framework] Skill rework — proficiency schema, dependency graph & central store |
| [060](060-basic-skills-backfill_DONE.md) | ✅ | [Content] Basic skills — definition & backfill |
| [061](061-specific-skills-backfill-and-migration_DONE.md) | ✅ | [Content] Specific skills — replace the generic skill families & migrate all references |
| [062](062-skill-initialization-and-early-childhood_DONE.md) | ✅ | [Feature] Person skill initialization & early-childhood seeding |
| [063](063-school-day-skill-progression_DONE.md) | ✅ | [Feature] School-day skill progression |
| [064](064-job-ranks-and-training-grants_DONE.md) | ✅ | [Framework] Job ranks & entry-level training grants |
| [065](065-job-skill-progression-and-promotion_DONE.md) | ✅ | [Feature] Job skill progression & rank promotion |
| [066](066-jobs-ranks-data-backfill_DONE.md) | ✅ | [Content] Jobs backfill — ranks, skill requirements & progression declarations |
| [067](067-parameterized-requirements-and-event-payloads_DONE.md) | ✅ | [Framework] Parameterized requirements, object refs & event payloads |
| [068](068-generalize-actions-and-events_DONE.md) | ✅ | [Migration] Generalize Actions & Events |
| [069](069-object-placement-tags_DONE.md) | ✅ | [Framework] Contextual placement tags — objects, buildings & businesses |
| [070](070-contextual-object-generation_DONE.md) | ✅ | [Feature] Deterministic contextual object generation |
| [071](071-building-context-action-requirements_DONE.md) | ✅ | [Content] Backfill Action requirements from building context |
| [072](072-person-targeted-action-contracts_DONE.md) | ✅ | [Framework] Person-targeted Action interaction contracts |
| [073](073-consent-and-action-failure_DONE.md) | ✅ | [Feature] Consent evaluation & Action failure handling |
| [074](074-person-targeted-actions-backfill_DONE.md) | ✅ | [Content] Person-targeted Actions backfill — contracts, consent flags & decline events |
| [075](075-progression-arc-validation-and-docs_DONE.md) | ✅ | [Test/Docs] Progression & context arc — end-to-end validation and documentation |
| [076](076-audit-remediation_DONE.md) | ✅ | [Audit] Consumption & closed-loop remediation (pre-055 hardening) |
| [077](077-offline-logical-economy-world_DONE.md) | ✅ | [Feature] Offline logical-economy world — off-map jobs/schools/objects during history generation |
| [078](078-offline-generator-perf-optimization_DONE.md) | ✅ | [Perf] Offline history-generator — per-agent step-cost optimization |
| [079](079-offline-generator-perf-brain-actions_DONE.md) | ✅ | [Perf] Offline history-generator — the brain/actions per-agent pass |
| [080](080-aliveness-quickwins-and-decode-diagnostic_DONE.md) | ✅ | [Data/Tooling] Aliveness quick-wins + the person-history decode diagnostic |
| [081](081-legibility-inspector-and-feed_DONE.md) | ✅ | [Feature/HUD] Legibility — inspector "Now:" line, day strip & feed filters |
| [082](082-reciprocity-counterpart-events_DONE.md) | ✅ | [Core] Reciprocity — counterpart events & fake-double rewires |
| [083](083-social-graph-and-consent-v2_DONE.md) | ✅ | [Framework] The social graph & consent v2 |
| [084](084-needs-engine_DONE.md) | ✅ | [Framework] The needs engine — the motivational substrate |
| [085](085-planner-routines-and-joint-plans_DONE.md) | ✅ | [Framework] The planner, routines & joint plans |
| [086](086-arbitration-v2-bands_DONE.md) | ✅ | [Core] Arbitration v2 — priority bands & the one utility currency |
| [087](087-pause-resume-and-traits_DONE.md) | ✅ | [Core/Framework] Pause & resume + traits |
| [088](088-object-capacity-and-stow-fetch_DONE.md) | ✅ | [Feature] Object capacity, stow/fetch & the curiosity hook |
| [089](089-retail-materialization-and-spoilage_DONE.md) | ✅ | [Feature] Retail materialization + spoilage & stock ceilings |
| [090](090-romance-arc_DONE.md) | ✅ | [Feature] The romance arc — courtship, dating, proposal |
| [091](091-mood-and-valence_DONE.md) | ✅ | [Feature] Mood + the event-valence pass |
| [092](092-illness-with-teeth_DONE.md) | ✅ | [Feature] Illness with teeth |
| [093](093-street-life-and-map-bubbles_DONE.md) | ✅ | [Feature] Street life — ambulatory actions & map activity bubbles |
| [094](094-reactions-and-witnesses_DONE.md) | ✅ | [Feature] Reactions & witnesses |
| [095](095-vices-habits-and-depression_DONE.md) | ✅ | [Feature] Vices, habits & depression arcs |
| [096](096-city-services-ledger_DONE.md) | ✅ | [Feature] The city-services coverage ledger |
| [097](097-employment-flow-and-entrepreneurship_DONE.md) | ✅ | [Feature] Employment flow — seeking, matching & entrepreneurship |
| [098](098-career-retcons-at-hydration_DONE.md) | ✅ | [Feature] Career retcons at hydration |
| [099](099-crime-incidents-and-police-chase_DONE.md) | ✅ | [Feature] Crime, incidents, police & the visible chase |
| [100](100-jail-and-detention_DONE.md) | ✅ | [Feature] Jail & detention as a lived state |
| [101](101-garbage-service_DONE.md) | ✅ | [Feature] The garbage service — litter, collection rounds, the depot |
| [102](102-building-condition-and-fire_DONE.md) | ✅ | [Feature] Building condition, fire & the fire service |
| [103](103-pets_DONE.md) | ✅ | [Feature] Pets — small companions |
| [104](104-reputation-and-gossip_DONE.md) | ✅ | [Feature] Reputation & gossip — the town remembers |
| [105](105-generator-two-band-and-regeneration_DONE.md) | ✅ | [Perf/Feature] Generator two-band recording + logical venues |
| [106](106-aliveness-validation-keystone_DONE.md) | ✅ | [Test] The aliveness validation keystone |
| [107](107-venue-grounding_DONE.md) | ✅ | [Foundation] Venue grounding — `venue:*` resolves to real placed buildings |
| [108](108-construction-menu-and-civic-placement_DONE.md) | ✅ | [Feature/HUD] The construction menu & civic placement |
| [109](109-police-end-to-end_DONE.md) | ✅ | [Feature] Police, end to end — dispatch, arrest, sentence, visits |
| [110](110-fire-end-to-end_DONE.md) | ✅ | [Feature] Fire, end to end — dispatch to the blaze, arrival-scaled outcomes |
| [111](111-hospitals-end-to-end_DONE.md) | ✅ | [Feature] Hospitals, end to end — treatment as lived behavior |
| [112](112-household-garbage_DONE.md) | ✅ | [Feature] Household garbage — produce, take out, collect, dispose |
| [113](113-market-end-to-end_DONE.md) | ✅ | [Feature] The market, end to end — the shelf is the truth |
| [114](114-services-nagbar_DONE.md) | ✅ | [Feature/HUD] The services nagbar |
| [115](115-pets-on-the-street_DONE.md) | ✅ | [Feature] Pets on the street — the dog trails the walk |
| [116](116-fire-particles_DONE.md) | ✅ | [Feature] Fire particles |
| [117](117-observation-and-balancing-pass_DONE.md) | ✅ | [Task] The observation & balancing pass |
| [118](118-generator-perf-pass_DONE.md) | ✅ | [Perf] Generator perf pass — the hot band runs 2× faster |
| [119](119-generator-extinction-fix_DONE.md) | ✅ | [Fix] Generator extinction — off-map courtship + the extinct-warm-up bail |
| [120](120-generator-perf-byte-identical-pass_DONE.md) | ✅ | [Perf] Byte-identical generator perf pass — flatten the super-linear costs |
| [121](121-headless-city-systems_DONE.md) | ✅ | [Fix] Headless city systems — the off-map world stops dropping live play's loops |
| [122](122-live-moved-out-signal-orphan_DONE.md) | ✅ Done | [Fix] Live move-out is orphaned — nothing emits the `movedOut` signal |
| [123](123-business-draw-coherence.md) | 📋 Planned | [Feature] Business draw coherence — no beach downtown, no duplicate schools |
| [124](124-evacuation-as-a-scene.md) | ✅ Done (core) | [Feature] Evacuation as a scene — a rally, a conclusion, and kin who notice |
| [125](125-deferred-venue-needs.md) | ✅ Done | [Feature] Deferred venue needs — a closed door is a plan, not a shrug |
| [126](126-guardianship-depth.md) | 📋 Planned | [Feature] Guardianship depth — accompaniment, home-alone care, dependent fan-outs |
| [127](127-homeless-day-shape-and-domestic-locations.md) | 📋 Planned | [Feature] Homeless day-shape + domestic home-locations — no resting at the rubble |
| [128](128-street-wander-graph-and-seeded-wander.md) | ✅ Done | [Feature] Street wander graph + seeded wander — walks that end somewhere |
| [129](129-persistent-household-cars.md) | 📋 Planned | [Feature] Persistent household cars — park it, don't conjure it |

## Open work

- **The simulation-aliveness-4 deferred follow-ups (tasks 123–129)** — the workstream remainders the arc
  consciously held back, several with asset-regeneration/determinism coupling. **124 & 125 landed** on the
  `task/simulation-aliveness-4` branch (PR #103). The rest (123, 126, 127, 128, 129) are focused follow-ups:
  126/128 are live-only; **129 wants a live browser for the W8 sprite-invariant check**; **123 & 127**
  perturb the generator/economy stream and best ride the **asset regeneration**.
- The recommended balancing tunings from [`docs/proposals/visibility-balancing-notes.md`](../proposals/visibility-balancing-notes.md)
  (task 117), to be applied and validated against a full asset regeneration — the maintainer's pre-merge pass.

