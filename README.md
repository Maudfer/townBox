# TownBox

A 2D, top-down **city-builder prototype** built on **Phaser 4** + **React 18** in **TypeScript** — but the
city is only the stage. TownBox is really a **high-fidelity simulation of individual lives**: a deterministic
genealogy of thousands of people who are born, form families, learn skills, get jobs, earn and spend money,
fall ill, marry, move out, go broke, lose their homes, recover — and whose intertwined stories you can inspect
one person at a time.

![townbox](https://github.com/RunoFawkes/townBox/assets/118758876/cbaf1c38-cd21-461b-ab87-3888de5c1c9c)

> This is a personal project being refactored from a pile of isolated experiments into a real game with a real
> simulation loop. The design philosophy, current state, and working agreements live in
> [`CLAUDE.md`](CLAUDE.md); the granular backlog lives in [`docs/tasks/`](docs/tasks/README.md).

---

## Table of contents

- [What makes it interesting](#what-makes-it-interesting)
- [Architecture](#architecture)
- [The simulation loop](#the-simulation-loop)
- [Simulated systems in detail](#simulated-systems-in-detail)
- [Determinism & save/load](#determinism--saveload)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Status & roadmap](#status--roadmap)

---

## What makes it interesting

TownBox is **not** a "grow the biggest metropolis" game like SimCity or Cities: Skylines. The unit of interest
is the **person**, not the skyline. Everything below is a mechanism for producing rich, believable individual
life stories, then surfacing them.

- **A real genealogy.** A new world generates a deterministic pool of **thousands** of `GenPerson` records
  spanning many generations — mostly deceased ancestors plus a living cohort — carrying parents, partnerships,
  and birth/death ticks. Family trees span households because everyone shares one bloodline graph.
- **Households as living arrangements.** Placing a house draws a *coherent* household from the pool — a nuclear
  family, a single occupant, adult siblings, a multigenerational home, a minor living with a guardian because
  their parents died, or unrelated roommates — and materializes its living members onto the map.
- **A data-driven life-event engine.** Death, marriage, divorce, pregnancy & birth, illness/injury/recovery,
  education that grants real skills, retirement, friendships and arguments — all defined as **flat JSON** with
  eligibility predicates and probability gradients. A load-time compiler derives their dependency/exclusivity
  graph (NPM-style); mutual exclusivity is *derived, never authored*.
- **A generative business economy.** Work buildings spawn businesses from **blueprints** (≈39 lines of work
  across 9 demand categories — from supermarkets and hospitals to bars, libraries, parks and cemeteries), each
  with job positions that scale with size via declarative curves. Households generate demand; businesses compete
  for it by capacity; revenue, wages, cost of living, and P&L are all simulated, with the total money supply
  **conserved** against an external sector so a long run can't silently inflate or deflate.
- **An emergent bad-numbers cascade.** Oversupply → business losses → **shrink-via-layoffs** or **bankruptcy** →
  layoffs → unemployment → household **arrears** → **eviction → homelessness** → recovery through re-employment.
  Vacated shops and homes heal over time (re-occupancy, move-out). Nobody scripted these outcomes; they fall out
  of the numbers.
- **People with an inner life.** Every person carries **needs** (hunger, rest, company, fun…), a **mood** that
  grief and joy move, **traits** that make two neighbors in the same circumstances live differently, an elective
  **social graph** (friends, rivals, partners — beyond kinship), **habits**, and an **agenda** of plans and
  routines — all read by a reworked **Brain** that arbitrates by priority bands. Behavior stops being a dice roll
  and becomes rhythm: hungry people cook and eat, the lonely visit friends, courtship grows into marriage, a
  death in the family can spiral into drinking, and none of those chains is scripted — they emerge from data
  multipliers. Interactions are **reciprocal** (the receiver logs and reacts; bystanders witness and gossip), and
  the town has **services** with teeth: no doctor means the sick recover slower and die more; crime gates on
  desperation and police **chase suspects down the street**; fires need firefighters to *arrive*; jail is a place
  you live, not a flag. A **construction menu** lets you place the civic buildings the town is missing, and a
  **services nagbar** tells you when it lacks them.
- **Inspect any life.** A universal Select tool opens inspectors for a person (identity, age, job, skills,
  relationships, and a dated **life-event log**), a business (positions, employees, balance, P&L), or a
  household (an interactive family tree). A city dashboard and a live event feed narrate the emergent story.

---

## Architecture

Three cleanly separated layers, plus persistence. The hard rule: **the simulation core never imports React, and
the GUI never reaches into simulation internals** — they communicate *only* through a custom event bus.

```text
┌───────────────────────────────────────────────────────────────────────┐
│  React HUD  (src/app/hud/)                                             │
│  windows · inspectors · toolbar · clock · city feed · overview        │
└───────────────▲───────────────────────────────────────────┬──────────┘
                │  events (PersonSelected, cityEvent, …)     │  emits (saveGameRequest, toolSelected, …)
┌───────────────┴───────────────────────────────────────────▼──────────┐
│  GameManager  (event bus + orchestrator + coordinate math)            │
│  on / off / emit / emitSingle  ·  owns the Clock                      │
└───────────────▲───────────────────────────────────────────┬──────────┘
                │                                             │
┌───────────────┴─────────────────────────┐   ┌──────────────▼──────────┐
│  Simulation core  (src/app/game/)        │   │  Phaser scene            │
│  Field · Population · City · EventEngine  │   │  MainScene: input,       │
│  BusinessGen · Economy · Clock · markets  │   │  camera, grid, rendering │
└───────────────────────────────────────────┘   └─────────────────────────┘
                │
        ┌───────▼────────┐
        │  Save / load    │  id-based WorldSnapshot → deflate (pako) → base64 → pluggable provider
        └────────────────┘
```

- **Simulation core (`src/app/game/`)** — pure(ish) TypeScript, unit-testable without a live scene: the tile
  `Field`, the genealogy `Population`, the `City` orchestrator, the life-event `EventEngine` + `EventCompiler`,
  business generation (`BusinessGen`), the `Economy` ledger, the `Clock`, and the adapter "markets"
  (`JobMarket`, `HousingMarket`, `SkillRegistry`) that let the scene-free engine touch the materialized world.
- **Event bus (`GameManager`)** — a small custom emitter (**not** Phaser's): `on`/`off`/`emit` (async fan-out)
  and `emitSingle` (one handler, returns a value). Every cross-system signal and its payload type is declared in
  `types/Events.ts` first, then wired. This is the single seam between simulation and UI.
- **React HUD (`src/app/hud/`)** — a windowing system (drag/resize via `react-rnd`), the toolbar, a persistent
  clock and city event feed, and the inspector/dashboard windows. It talks to the game **only** through the bus.
- **Save/load** — the entire world (tiles, the genealogy pool, households, people & relationships, vehicles,
  businesses, money, event history) serializes to an **id-based** snapshot, deflated and base64-encoded, behind
  a pluggable `SaveProvider` (localStorage today). The id-based model lets the cyclic relationship/ownership
  graph survive a JSON round-trip.

---

## The simulation loop

Time comes from one `Clock` (**1 in-game day = 1 real hour**, on a 30-day-month / 360-day-year calendar). The
canonical simulation tick is the **in-game hour** (24 ticks/day); the clock emits `timeChanged` (per minute),
`newTick` (per hour), and `newDay` (per rollover). Three cadences ride on top:

- **Per hour (tick)** — the life-event engine (Engine B) resolves detailed events over every materialized
  person through a shared tick lifecycle that live play and the offline history generator both run, behind a
  formal live/bootstrap **execution boundary**; every commit lands in an append-only per-person log with
  sequence numbers and causation ids.
- **Per minute** — the commute scheduler moves employees between home and work.
- **Per month** — the economic tick runs payroll → demand-driven business P&L → producer (B2B) revenue →
  growth / shrink-via-layoffs / bankruptcy → vacant-lot re-occupancy → household cost-of-living → eviction →
  homeless recovery.

Everything feeds back into everything. The diagram below ties the simulated aspects — **people, skills, jobs,
businesses, materials, money, life events** — into one loop:

```mermaid
graph TD
    CLOCK([Clock · hour / day / month cadences])

    subgraph society [People and society]
        POOL[Genealogy pool<br/>deterministic generation]
        HH[Households<br/>living arrangements]
        PPL[People<br/>age · gender · relationships]
        SKILL[Skills · proficiency 0–100<br/>335-skill dependency DAG]
        SCHOOL[School<br/>weekdays · ages 7–17]
        OBJ[Objects & context<br/>placement tags → generated instances]
        EVT{{Life-event engine<br/>Engine B · per hour}}
    end

    subgraph economy [Economy]
        JOB[Jobs and hiring<br/>skill + distance match]
        BIZ[Businesses<br/>Engine A blueprints]
        MONEY[(Money · balances<br/>+ ledger)]
        DEM[Household demand<br/>per category]
        MAT[Materials and producers<br/>B2B supply chain]
    end

    POOL -->|draw on house placement| HH -->|materialize living members| PPL
    PPL --> SKILL
    CLOCK -->|weekday school days| SCHOOL -->|basics → 60 at 18| SKILL
    HH -->|context tags fill homes| OBJ
    BIZ -->|context tags fill venues| OBJ
    OBJ -->|action requirements<br/>cook · clean · shower| PPL
    CLOCK -->|newTick| EVT
    CLOCK -->|monthly| MONEY

    EVT -->|births| PPL
    EVT -->|deaths → despawn and re-house| HH
    EVT -->|marriage → cohabit · move-out| HH
    EVT -->|education grants| SKILL
    EVT -->|illness / injury / recovery| PPL
    EVT -->|retirement| JOB

    SKILL -->|rank ladders + entry grants| JOB --> BIZ
    JOB -->|work days progress skills · promotions| SKILL
    BIZ -->|wages| MONEY -->|income| PPL
    PPL -->|cost of living| MONEY
    PPL -->|consume goods/services| DEM
    DEM -->|revenue, capped by staffing capacity| BIZ
    BIZ -->|buy input materials| MAT
    MAT -->|B2B revenue to producers| BIZ

    BIZ -->|profit + fully staffed → grow| JOB
    BIZ -->|sustained losses → shrink or bankruptcy → layoffs| PPL
    BIZ -->|vacated lot → re-occupancy| BIZ
    MONEY -->|household arrears too long → eviction| HH
    HH -->|homeless → recovers funds → re-home| PPL

    BIZ -. product output feeds other industries · unimplemented .-> MAT
```

**Reading the loop.** A household is drawn from the pool and its living members become `People` on the map, each
with a deterministic set of `Skills`. The **life-event engine** runs every in-game hour, aging the world forward: it
marries people (who then move in together), grows families (births), ends lives (deaths, which trigger orphan
re-housing), grants skills through education, and toggles health via illness/injury/recovery. Children attend **school**
on weekdays, landing every basic skill at exactly 60 by 18 (perfect attendance); **proficiency** (0–100, on a
335-skill dependency DAG) gates hiring — jobs carry full **rank ladders** with entry training grants, and
completed work days progress skills until a deterministic **promotion**. Placement **tags** on homes and
businesses generate real **object instances**, and what people can *do* somewhere (cook, clean, shower, grab,
lend) follows from what's there. Skills make a person **hireable**; the **job market** matches them to open positions at **businesses** (generated from
blueprints, their job counts scaling with size). Businesses pay **wages** into the money ledger; people spend on
**cost of living** and generate per-category **demand**; businesses compete for that demand by staffing capacity,
earning **revenue** and buying **input materials** — which become **B2B demand** on local producers (farms,
factories, warehouses) who earn by supplying it. The monthly **P&L** decides fates: profitable, fully-staffed
businesses **grow**; a solvent business that stays unprofitable **shrinks** — shedding a size step and laying off
its surplus back into the job market; and a business that sinks below the debt floor for too long goes
**bankrupt**, lays everyone off, and leaves a vacant lot that later attracts a *different* business. On the
household side, too many months of unpaid **cost of living** ends in **eviction** and **homelessness**, escapable
when someone finds work again and the family can afford a vacant home (or move in with relatives if the town is
full). The one dotted edge — a business's **product output** feeding *downstream industries* as more than
just raw materials — is **not yet implemented** (see [task 035](docs/tasks/035-materials-and-products_DONE.md)
for the materials/B2B layer that exists, and the roadmap for where it goes next).

---

## Simulated systems in detail

### Population & genealogy

A pure `generatePopulation(seed, params)` forward-simulates founders → generations of intertwined families →
lifespans, producing a flat, serializable table of people (deceased ancestors + a living cohort). **Kinship and
age are never stored** — siblings, grandparents, cousins, and current age are derived on demand from the graph
and the live clock, so people genuinely get older as time passes. A coarse yearly off-map sim advances mortality
and fertility for people who aren't on the map. Population is kept **stable, not exponential**: every person
carries an innate maximum number of children they are willing to have (a distribution mounding on 2–4).

### Offline history & new-game world

Rather than simulate a starting world on every new game, the deep simulation runs **once, offline**
(`npm run generate-history`) and is captured as a versioned **history asset**. A new game then *selects* a slice
of it — a random present-tick window, rebased to tick 0, with re-randomized (lineage-coherent) identities — so
drawn people arrive with **real event histories** and no loading wait; when no asset is committed the game
cold-starts a plain generated pool. The generator runs the same simulation engines over an off-map
**logical-economy world** (logical homes, schools, jobs, and generated objects), so the asset carries **lived
skills, real careers-as-history, and possessions**, not just demographics — skills are stored as a per-person
**timeline** so selection installs each person's proficiency *as of the chosen window* (matching their windowed
age). Generation **streams to sharded files** (RAM-bounded) and the asset is a **directory** of chunks the game
loads on demand (only the shards up to the window), so a multi-GB asset stays git-friendly without LFS. During
generation an AC-style **thermostat** on a global fertility multiplier holds the population at a target
headcount. This retires the earlier per-load history bootstrap.

### Life events (Engine B)

`json/events.json` is a flat manifest: each event declares its **roles** (a subject plus co-participants bound by
relation or found by a candidate search), a per-year **probability** with `Curve` factors (e.g. mortality rises
with age; a `health` attribute raises death probability), and a closed, typed **effects** vocabulary
(`setDeath`, `marry`, `birth`, `setAttr`, `acquireSlot`, `acquireSkill`, `adjustMoney`, `emit`, …). A compiler
derives the dependency/exclusivity graph; the runtime resolves it per hour over materialized people, records a
per-person history, and queues signals the `City` turns into world changes (re-housing, cohabitation, move-out)
and feed entries. Adding an event is **pure data**; adding a new attribute or effect primitive is a deliberate,
tested code change.

### Skills, jobs & businesses (Engine A)

Skills (335 — 15 basics + 320 specific abilities on a dependency DAG, each held as a 0–100 **proficiency** with
provenance) and jobs (≈33, each with a full authored **rank ladder** and an explicit entry training grant) are
JSON reference tables kept internally consistent by validators — including the CI-enforced reachability rule (a
fresh 18-year-old with school basics can reach every job's entry rank), the self-climbing rule (no ladder
silently stalls), and the consumption rule (every non-basic skill is required or progressed by some job rank, so
none is inert data). Business
**blueprints** (≈39, across groceries, dining, healthcare, education, construction, retail, leisure, services,
hospitality, plus civic/leisure venues and B2B producers) describe how to generate a business of a given size: each job's position count
is a `Curve` over size, so a big supermarket has proportionally more clerks than janitors. Hiring is a real
event (`get_job`) resolved through a **`JobMarket`** adapter that scores candidates by skill fit minus
home↔work distance and hires into the highest rank strictly met (else the entry rank via its grant) — so school,
education and work experience genuinely unlock better jobs and promotions.

### Money & the economy

A serializable `Economy` holds per-person and per-business balances behind one ledger primitive (`transfer`). A
monthly tick runs **wages** (businesses → employees), **cost of living** (households → suppliers, accruing
`arrears` when they can't pay), and **demand-driven P&L**: `revenue = unitsSold × price` (units capped by
`staffing × throughput` and split among competitors by capacity), minus materials, fixed costs, and payroll.
Sustained profit + full staffing → **growth**; sustained losses while still solvent → **shrink-via-layoffs**
(a size step shed, surplus staff back on the market); a balance below the debt floor for too long → **bankruptcy
& closure** (staff laid off, lot vacated, debt written off), after which a cooldown lets a new business move in.
Every one-sided flow (revenue, cost of living, materials, starting capital, write-offs) is balanced against an
**external sector** account, so the grand total (people + businesses + external) is **conserved** — a long run
neither mints nor burns money.

### Materials & the B2B supply chain

A business's input **materials** become demand on local **producers** whose `products` are those materials —
farms produce food, factories produce building/hardware/electronics stock, warehouses produce retail/office
goods (and medical/school supplies and auto parts). The same demand-resolution machinery runs a second time
keyed by material, so producers earn B2B revenue by supplying downstream shops; a validator guarantees every
consumed material is produced by some blueprint. (Deeper multi-tier product chains and business product *output*
beyond raw materials are future work.)

### Household lifecycle dynamics

Households aren't frozen at placement. Death re-houses orphaned minors with a living relative; marriage triggers
**cohabitation** (newlyweds move in together); grown, employed adults **move out** into a vacant home to start
their own household; insolvency drives **eviction → homelessness**, with recovery once funds return — into a
vacant home, or, if the town is full, in with a relative or as roommates in any home with a spare room. All of it
runs through one shared relocation helper.

### Movement & commute

A shared A\* pathfinder routes people over sidewalks/crosswalks and cars in their lanes. Employed residents run a
daily **commute** state machine: exit home → walk to car → drive → walk to work → enter, and back at shift end.

---

## Determinism & save/load

Determinism is a first-class constraint: the population pool, household draws, skill assignment, business
generation, and every day of the event engine are **seeded** from the world seed, so the same world reproduces
identically and survives a save/load round-trip. Saves are a versioned, id-based `WorldSnapshot` (migrations
carry old saves forward), deflated with `pako` and base64-encoded behind a pluggable `SaveProvider`.

---

## Tech stack

| Concern     | Choice |
| ----------- | ------ |
| Engine      | Phaser `^4.1` |
| UI          | React `^18` + `react-dom`, windows via `react-rnd` |
| Language    | TypeScript `^6.0` (strict) |
| Bundler     | Parcel `^2.12` |
| Tests       | Jest `^30` + `ts-jest` (unit); Playwright `^1` (browser-level integration suite) |
| Data viz    | D3 `^7` (family-tree graph) |
| Fake data   | `@faker-js/faker` (`pt_BR` locale) |
| CI          | GitHub Actions — typecheck, per-module concurrent test checks, production build, per-module coverage gate, ESLint + markdownlint |

---

## Getting started

```bash
npm install
npm run dev          # copy images, Parcel watch, and serve with browser-sync
```

Other scripts:

```bash
npm test               # fast unit suite (Jest + ts-jest)
npm run test:coverage  # unit suite with coverage reporting (CI gates it per module — see below)
npm run typecheck      # strict tsc --noEmit
npm run build-prod     # production Parcel build
```

CI (`.github/workflows/ci.yml`) splits the checks into **separate concurrent jobs**: the type check, the
production build, and one `test (<module>)` job per affected module (a `changes` job path-filters which modules a
PR touched; foundational/shared changes fan out to all). Each `test` job emits its own coverage report, and a
`coverage` job reads them all and fails if any module's owned-file statement coverage is under **80%** (measured
per module — the gate filters each report to the files that module owns). Lint (ESLint + markdownlint), the
offline-generator perf gates, and coverage are all **blocking** required checks; a dependency `audit` (production
deps only) is advisory. A single `ci-success` job aggregates the required checks — make that the required status
check.

---

## Project layout

```text
src/
  app/
    main.tsx            # React entry; boots GameManager, mounts <HUD>
    game/               # simulation core (no React), grouped by responsibility:
      GameManager.ts    #   global orchestrators kept at the root (also City.ts, Clock.ts)
      scene/            #   Phaser scene + render glue
      world/            #   tile grid, structures, placement
      agents/           #   people, vehicles, pathfinding
      population/       #   genealogy pool, households, identity
      events/           #   Engine B life events + shared log & consequences
      actions/          #   Action system + Brain decision layer
      execution/        #   shared tick spine + live/bootstrap boundary
      economy/          #   money, markets, business generation
      skills/           #   skills + school
      objects/          #   object instances + building object generation
      history/          #   offline history-asset pipeline
      data/  save/      #   schema-validation registry; save/load
    hud/                # React GUI: window manager, toolbar, clock, feed, inspector windows
  json/                # tunable data: events, businesses, jobs, skills, demand, economy, …
  types/               # shared TypeScript types (Events, Genealogy, Business, LifeEvent, Save, …)
  util/                # curves, predicates, kinship, random, time, compression, …
test/<module>/         # Jest projects, one folder per module (mirrors src/app/game/<group>; util/ for
                       # pure utils) — each an independent, concurrent CI check
docs/generated/        # generated, checked-diff-gated docs (simulation-relationships, event-classification)
docs/tasks/            # the JIRA-style backlog (each file is a self-contained, mergeable task)
```

For a much deeper, source-verified walkthrough of every subsystem — including the simulation flows and
the module/CI layout — read [`CLAUDE.md`](CLAUDE.md).

---

## Status & roadmap

The **014–037** arc is complete: employment & movement, the full economy cascade (wages → cost of living →
business P&L → bankruptcy → eviction/homelessness → recovery, with a B2B supply chain), household-lifecycle
dynamics, the UI/inspector layer, content expansion, and CI. (This arc's per-load history bootstrap has since
been retired in favor of the offline history asset — see *Offline history & new-game world* above.)

The **039–054 simulation-enrichment arc** is complete (architecture in
[task 038](docs/tasks/038-simulation-enrichment-architecture_DONE.md)): hourly ticks (24/day), object archetypes
& per-person **Possessions**, the data-driven **Action** system, event **triggers** with causation-chained logs,
the per-person **Brain**, job shifts & the **Job Orchestrator** — all behind the live/bootstrap **execution
boundary**. So is the **056–075 progression & context arc**: the weekday/weekend calendar, **school** (ages
7–17, weekdays), **skill proficiency** (0–100 on a 335-skill dependency DAG, school basics landing at exactly
60 by 18), **job rank ladders** with entry training grants and deterministic **promotions**, **placement tags**
and deterministic **building object generation**, context-grounded action requirements, and person-targeted
interaction **contracts** with a deterministic **consent** flow and typed action failure — validated end-to-end
(live ↔ bootstrap equivalence, tick-budget re-pins) by task 075.

A post-arc **audit-remediation pass (076)** then closed the consumption gaps the arcs left behind: contextual
objects generate **at placement** (not only on save/load); **all authored content is now consumed** — orphaned
skills wired into job progression, the deferred venues promoted to real blueprints so every object can spawn, the
generic object verbs proposed by the inventory hook, and computable milestone events (born, became-parent,
widowed, homeless, moved-out…) fired from the transitions the sim already performs — each guarded by a CI
reachability test; businesses **shrink-via-layoffs** as well as grow; and **money is conserved** via an explicit
external sector.

The **Playwright integration suite (008)** now exists: a browser-level layer (`test/integration/`) that boots the
real production build and drives the React HUD + Phaser canvas through a test-only `window.__townbox` determinism
hook — covering start/save/load, the toolbar, inspector windows, the feed and clock, road/building placement and
bulldozing, commute engagement, and end-to-end scenarios — plus browser coverage of the scene/HUD gap. It runs
as a separate, **non-blocking** CI job.

The **080–106 simulation-aliveness arc** then rewired the corpus so systems *feed* each other (proposal:
[`docs/proposals/simulation-aliveness.md`](docs/proposals/simulation-aliveness.md)): **needs** driving selection,
an elective **social graph** with consent v2, **counterpart events & reactions**, the **planner/agenda** with
routines and joint plans, the **Brain rework** (priority bands, one utility currency, pause/resume), **traits**,
object **capacity & the real market**, **mood**, **illness with teeth**, **street life**, **vices/habits/
depression**, the **city-services ledger**, **employment flow & entrepreneurship**, **career retcons**,
**crime/police/the chase**, **jail**, **garbage**, **fire**, **pets**, **reputation & gossip**, a **two-band
generator**, and a validation keystone. The **107–118 simulation-visibility arc** (bundled into the same PR;
proposal [`docs/proposals/simulation-visibility.md`](docs/proposals/simulation-visibility.md)) put the **player's
hands on the levers** (a construction menu, civic placement, a services nagbar) and **grounded the glue
physically** — venues resolve to real buildings, officers *drive* to crimes, firefighters *arrive* at fires, the
sick *go* to the hospital, garbage *leaves* the house, groceries come from *that* supermarket — closed with a
generator perf pass. Both arcs are broken down file-by-file in [`docs/tasks/`](docs/tasks/README.md) (080–118).

**In flight / planned** (see [`docs/tasks/`](docs/tasks/)):

- **117** — the observation & balancing pass: the debug scaffolding (a time-throttle + vitals overlay) shipped;
  the human playtest, its balancing-notes deliverable, and the one full asset regeneration remain.
- **033c** — optional tier-2 demand (locality/catchment, price elasticity).
- Business **product output** into downstream industries (beyond raw materials).

---

*Not affiliated with any commercial product; a personal simulation-first experiment.*
