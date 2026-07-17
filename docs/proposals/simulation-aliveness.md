# Simulation Aliveness — a proposal for making TownBox people look alive

**Status: proposal, v2 (not yet broken into tasks).** v2 extends v1 with the Brain rework stated plainly
(Workstream L — arbitration v2, interruption & resumption), traits (M), pets (N), reputation & gossip (O),
full plans for jail (G5) and fire (H4), a six-phase sequencing, and a closing gripe-by-gripe traceability
matrix (Part 8). This document is the outcome of a full audit of the
simulation's *behavioral output* — the decoded history asset, the action/event manifests, the Brain and its
hooks, the social machinery, and the HUD — against one question: *why do the people not feel alive yet, and
what would make them?*

The frameworks are done and they are genuinely powerful: two engines over a shared substrate, a real action
lifecycle, causation-chained logs, consent contracts, deterministic everything. What is missing is almost
entirely **glue and feedback**: the systems produce output, but the output of one system is rarely the *input*
of another. People act, but nothing they do changes what they will do next; people interact, but the other
person doesn't notice; events happen, but nothing downstream cares. The proposals below are organized to fix
exactly that, workstream by workstream, from engine primitives down to individual data entries.

**One binding constraint, stated up front:** nothing here reduces or streamlines the content corpus. No
action, event, or object is deleted. Where an entry is incoherent today, the fix is *rewiring* (a changed
trigger, an added gate, a new counterpart) — never removal. Most workstreams **add** substantial new content.

---

## Table of contents

- [Part 0 — What the audit found (evidence)](#part-0--what-the-audit-found-evidence)
- [Part 1 — Diagnosis: seven structural gaps](#part-1--diagnosis-seven-structural-gaps)
- [Part 2 — The workstreams](#part-2--the-workstreams)
  - [A. Needs & drives — the motivational substrate](#a-needs--drives--the-motivational-substrate)
  - [B. The social fabric — a relationship graph beyond kinship](#b-the-social-fabric--a-relationship-graph-beyond-kinship)
  - [C. Reciprocity — bilateral logging, counterpart events, reactions](#c-reciprocity--bilateral-logging-counterpart-events-reactions)
  - [D. Plans & appointments — intentionality across ticks](#d-plans--appointments--intentionality-across-ticks)
  - [E. Street life — getting people out of buildings](#e-street-life--getting-people-out-of-buildings)
  - [F. Objects with purpose — acquisition, capacity, consumption, a real market](#f-objects-with-purpose--acquisition-capacity-consumption-a-real-market)
  - [G. Consequence — mood, illness that matters, vices, crime & police](#g-consequence--mood-illness-that-matters-vices-crime--police)
  - [H. City services & the needs ledger](#h-city-services--the-needs-ledger)
  - [I. Employment flow, business matching & malleable histories](#i-employment-flow-business-matching--malleable-histories)
  - [J. Legibility — showing what people are doing](#j-legibility--showing-what-people-are-doing)
  - [K. Generator fidelity — hourly texture in the history asset](#k-generator-fidelity--hourly-texture-in-the-history-asset)
  - [L. The Brain rework — stateful inputs, arbitration v2, interruption & resumption](#l-the-brain-rework--stateful-inputs-arbitration-v2-interruption--resumption)
  - [M. Traits & temperament — why people differ](#m-traits--temperament--why-people-differ)
  - [N. Pets — small companions, big lore](#n-pets--small-companions-big-lore)
  - [O. Reputation & gossip — the town remembers](#o-reputation--gossip--the-town-remembers)
- [Part 3 — Engine expressive-power changes (consolidated)](#part-3--engine-expressive-power-changes-consolidated)
- [Part 4 — The data audit passes](#part-4--the-data-audit-passes)
- [Part 5 — Quick wins (pure data, land this week)](#part-5--quick-wins-pure-data-land-this-week)
- [Part 6 — Sequencing, task breakdown & dependency map](#part-6--sequencing-task-breakdown--dependency-map)
- [Part 7 — Cross-cutting engineering notes](#part-7--cross-cutting-engineering-notes)
- [Part 8 — Gripe-by-gripe traceability](#part-8--gripe-by-gripe-traceability)

---

## Part 0 — What the audit found (evidence)

I decoded four person files from the committed asset (`src/history/person-<id>.tbz`, format v2) and
cross-read the manifests, the Brain, and the hooks. Every claim below is measured, not guessed. The decode
script lives outside the repo (scratchpad); a permanent `scripts/decodePersonHistory.ts` diagnostic is
proposed in Part 6.

**Subject p108 — a 94.2-year life, 83,742 log entries (79,497 actions, 4,245 events):**

- **84% of all life events are `had_sex`** (3,560 of 4,245). The event's rate is `perYear: 60` while
  everything else sits at 0.01–24. The next most common events: `recovered` (289), `fell_ill` (228),
  `injury` (71). Three marriages, two divorces, 18 jobs, 17 layoffs, 5 promotions, 1 retirement — the
  *narratively interesting* events are drowned 100:1 by one rate outlier.
- **Every one of 24,819 sleeps lasted exactly 24 hours.** The offline generator steps in day strides
  (`daysPerStep: 1` → `runTick` once per 24 ticks, always at midnight — `HistoryAsset.ts:280`), so the Brain
  only ever decides at 00:00: sleep restarts each midnight and the diurnal layer (shifts, school hours,
  mealtimes, evenings) simply does not exist in the asset. ~73% of p108's logged life is one repeated entry.
- **Zero work actions across an 18-job career.** No `started_working`, no on-duty flavor, no workplace
  discretes — shift checks never fire at midnight. Skill/promotion progression happens through
  `LogicalWorld.runDaily`'s direct accrual instead, so careers *advance* without ever being *lived* in the log.
- **`bake_cake` was attempted 206 times and blocked 206 times.** Not once in 94 years did the ingredient
  chain line up. The flagship 044/053 transformation chain is effectively unreachable in generated lives.
- **228 illnesses with zero behavioral consequence.** `fell_ill` sets `health: 0.5` and a feed signal;
  nothing gates work, school, or leisure on it; `recovered` restores at a flat `perYear: 24` regardless of
  rest, care, or a doctor existing. Illness is a log line, not an experience.

**The reciprocity fake-out (manifest-level):**

- `gave_object_to_person` really moves the object and fires `gave_gift` — on the **giver's** log only. The
  receiver logs nothing. Meanwhile `received_gift` *exists* — and fires **probabilistically at random**
  (`perYear: 2`), unconnected to any actual gift, giver, or object. The manifest contains both halves of the
  interaction and they never touch. The same pattern repeats across the texture corpus: `became_pregnant`
  (texture) is a separate random event from `pregnancy` (vital); `argued_with_partner` fires without checking
  for a partner; per `docs/generated/event-classification.md`, **521 of 707 events are free-rolling texture**
  narrating things no system did, while the systems that *do* things narrate only one side.
- `socialOpportunityHook` picks its target as **"a random companion"** (`SocialOpportunity.ts:151`) — the one
  exception is the borrowed-object return. Nothing distinguishes a spouse from a stranger for a hug, a gift,
  or an argument.
- The social graph **is** the family tree: `types/Social.ts` has no friend, acquaintance, rival, or
  dating relationship — `made_friend` and `argument` emit a feed string and mutate nothing.

**Possessions (asset `objects.tbz`, 55,561 instances):**

- The **median person carries 553 objects**; the top carrier holds 1,413. Globally: 12,185 `baked_dough`,
  11,942 `bread_loaf` (work production with no sales sink), 6,709 wristwatches, 1,512 coins, 1,404 pebbles
  (the `inventoryOpportunityHook` pockets forever; its only dedup is per-archetype-carried, and there is no
  capacity check anywhere in `Inventory.ts`). Acquisition has no *reason*; retention has no *cost*.

**Pacing & the city layer:**

- `get_job` rolls at `perYear: 4` → an unemployed person with a reachable open slot waits **~3 in-game
  months on average** to take it. That is the "place two houses and a shop and nothing happens" experience.
- Business blueprints are drawn seed-random at placement with no regard to the local workforce or to what
  the town lacks (the unmet-demand weighting exists but only for post-bankruptcy re-occupancy, task 037).
- There is no representation anywhere of "this town has no doctor / no police / no garbage collection," and
  no consequence for it.

**Legibility:**

- `Brain.statusOf()` exists and is queried by hooks — but no HUD surface reads it. Nothing in
  `src/app/hud/` references a current activity; `PersonDetails` renders the historical log only. The richest
  layer of the sim is invisible while it happens.

---

## Part 1 — Diagnosis: seven structural gaps

Each gripe in the brief traces to one (usually) of these root causes. The workstreams in Part 2 map onto
them.

1. **No motivational state.** The Brain is deliberately stateless; free-time selection is a weighted dice
   roll per (tick, person). With no persistent needs, goals, or appetites, *randomness is structural* — the
   data can shape the dice but nothing links this hour's pick to the last one or the next one.
   → Workstreams **A** (needs), **D** (plans), **L** (the Brain rework that lets them coexist).
2. **No social fabric beyond kinship.** Without friendship/romance/rivalry edges carrying strength and
   history, there is no way to prefer targets, gate intimate actions, or grow relationships from repeated
   interaction. → Workstream **B**.
3. **One-sided interactions.** The log is actor-only; targets neither record nor react; the texture corpus
   papers over the gap with free-rolling fictions that contradict the ground truth.
   → Workstream **C**, data pass **P2**.
4. **No feedback from state to behavior.** Health, wealth, employment, and life events barely modulate what
   people do (a handful of hand-authored modifiers aside). Illness, grief, and poverty must *reshape the
   day*, not just append a log line. → Workstream **G**.
5. **Objects lack an economy of use.** No acquisition-by-need, no capacity, no consumption pressure, no
   sales sink for production. → Workstream **F**.
6. **No city-level demand signals.** Job pacing, business matching, service coverage — the town has no
   ledger of what it needs, so neither the sim nor the player can respond to gaps.
   → Workstreams **H**, **I**.
7. **The instrument panel is missing.** Even where behavior is rich, nobody can see it (no current-activity
   surface, no street presence for most actions, day-stride asset histories with no diurnal texture).
   → Workstreams **E**, **J**, **K**.

---

## Part 2 — The workstreams

Each workstream states its goal, the design, what is engine (code) vs. data, and how it lands under the
repo's directives (determinism, live/bootstrap equivalence, validators, save migrations, tests). Sizes are
rough: **S** ≈ one task PR, **M** ≈ 2–3, **L** ≈ 3–5.

### A. Needs & drives — the motivational substrate

**Size: L. Gripes addressed:** "people do a lot of random things", "maybe we're missing wants and needs",
"eating not connected to cooking not connected to buying food".

The single highest-leverage change. Give every person a small, closed set of **need meters** whose urgency
continuously reshapes action selection. Variety stops being noise and becomes *rhythm*: hungry people cook or
go out to eat, tired people head home, lonely people seek company, bored people seek fun — and because
satisfaction is delivered *through existing actions*, the entire 260-action corpus instantly gains purpose
without a single action being removed.

**A1. The need set (code — Context attributes are a closed vocabulary).** Start with six:

| Need | Satisfied by (examples from the existing corpus) | Starved consequence |
|---|---|---|
| `food` | `ate_a_meal`, `shared_a_meal`, `bought_a_snack`, restaurant visits | mood ↓, health drift ↓ |
| `rest` | `sleep`, `rest`, `took_a_nap`, `dozed_off` | mood ↓, work-quality events |
| `social` | the whole social category (61 actions) | mood ↓, withdrawal loop risk (G) |
| `fun` | the leisure category (54 actions) | mood ↓ |
| `hygiene` | `took_a_shower`, `cleaning_house` children | social weight ↓ (people keep distance) |
| `purpose` | work days, `working_on_hobby`, `gardening`, teaching, caring for children | mood ↓, retirement malaise stories |

**A2. State & determinism (code).** A serialized `NeedsState` per person: for each need, `{ level,
updatedAtTick }`. Decay is **closed-form** — `levelAt(tick) = f(level, updatedAtTick, tick)` with authored
per-need decay curves — never per-tick mutation. This matters twice: (a) lazy evaluation costs nothing for
off-screen people; (b) the offline generator's day-stride integrates *exactly* (no drift between hourly live
play and daily generation — the seam Workstream K needs). Save version bump (v15) with a deterministic
backfill (seed-derived initial levels) for existing saves; the same backfill initializes asset-drawn people
at hydration.

**A3. Authoring surface (data — `json/needs.json` + a new `satisfies` field on actions).** Actions declare
what they restore: `"satisfies": { "food": 45, "fun": 10 }`. Discrete children contribute small amounts
(eating the meal is what fills `food`, not the cooking wrapper — which is what finally makes cooking→eating a
real chain, see F). The needs file declares decay curves (per age band — children's `fun` decays faster,
elders' `rest`), urgency thresholds, and the urgency→weight gradient. The existing `Curve` substrate covers
all of it; the data-schema registry gets a `needs` validator (every `satisfies` key is a declared need; every
need is satisfiable by ≥5 actions — a reachability rule in the 076 tradition).

**A4. Selection integration (code, one place).** In `Brain.computeFreeTimeAction` and the social hook,
multiply each candidate's weight by `urgency(need)` for the needs it satisfies (urgency = the authored
gradient of the person's current level; level 100 → ×~0.2, level 15 → ×~6). Authored modifiers still apply on
top — data keeps the last word. Above a *critical* threshold, a new `needsHook` (registered before
`idleFallback`) proposes a `required`-necessity intent (a starving person interrupts leisure to eat; an
exhausted person goes home to sleep). All selection remains the same deterministic seeded pick — needs only
move the weights, so live/bootstrap equivalence holds structurally.

**A5. What this unlocks immediately.**

- The **day acquires a shape**: sleep at night because `rest` peaks then (today's ×250 hour hack becomes a
  real drive), meals at meal hours (hunger period ≈ 5–6 ticks naturally lands 3 meals/day), socializing in
  the evening. The quirky picks still happen — as *seasoning between* need-driven behavior, exactly the
  balance the brief asks for.
- **Illness/grief/poverty get a lever**: G modulates decay rates and satisfaction multipliers instead of
  inventing separate machinery (sick people's `rest` drains fast → they stay in bed *because of the same
  selection math*).
- **Eating chains to cooking chains to shopping** (with F closing the object loop): `food` urgency raises
  `cooking_meal` (requires carried ingredients) *and* `eat_out` variants; missing ingredients push the
  planner (D) to enqueue a shopping trip. `bake_cake` stops being blocked 206/206 times because pantries are
  now *stocked on purpose*.

### B. The social fabric — a relationship graph beyond kinship

**Size: L. Gripes addressed:** "you'd only kiss someone you are in a relationship with", "is the person
chosen smartly?", targets for important actions, consent needing an upgrade.

**B1. The graph (code).** A new serialized `SocialGraph` (module `game/population/SocialGraph.ts`), keyed by
the unordered person-id pair: `{ kind, strength: 0–100, formedAtTick, lastInteractionTick, provenance }`.
Kinds: `acquaintance`, `friend`, `close_friend`, `rival`, `dating`, `ex_partner`. **Family stays derived** —
the genealogy remains the sole source of kinship; the graph holds only *elective* bonds (the repo's
"kinship is derived, never stored" rule is untouched). Deterministic decay: strength is closed-form-decayed
from `lastInteractionTick` (same lazy pattern as needs), so neglected friendships genuinely fade and the
generator strides over it exactly. Save v15; asset people get graph edges at hydration (see B5).

**B2. Mutation surface (code primitives, then pure data).** A new event effect `adjustRelationship { role,
otherRole, kind?, delta }` and an equivalent action-consequence op. Kind transitions are declared in
`json/relationships.json` (thresholds: acquaintance→friend at strength 30 with ≥N interactions,
friend→close_friend at 65; dating requires a `romance` flag both ways; rival forms from repeated negative
deltas) — the *policy is data*, the primitive is code.

**B3. Predicate & context integration (code).** A new predicate node `relationship: { role: 'target',
kind: ['dating','spouse'], minStrength?: 40 }` (with `spouse`/`family` resolving through the genealogy so
authors get one uniform gate), plus context attributes `relationshipToTarget`, `strengthToTarget`. Now
person-targeted actions can *finally* say who they are for, as data:

- `hugged_person`: requires `kind: ['friend','close_friend','dating','spouse','family']`.
- A new `kissed_partner`: requires `dating|spouse`. (Note: it doesn't exist today — the audit found no
  romantic action at all between the manifests' 260 actions.)
- `argued_with_person`: weight ×3 toward `rival`, allowed with anyone (arguments with strangers are life).
- `asked_someone_out` (today a free-rolling texture event): becomes the **action** that creates a `dating`
  edge on consent — see B4.

**B4. The romance pipeline (data + one wired handler).** Today marriage is a probabilistic event over any
eligible pair. Rebuild the arc as stages, each gated on the graph — *all existing events kept, retriggered*:

1. Repeated positive interactions between compatible singles grow an `acquaintance→friend` edge (automatic,
   from C's interaction deltas).
2. `asked_someone_out` (action, askFirst) → consent → `dating` edge; decline → the existing
   `action_declined` machinery, a cooldown, and a strength dent.
3. Dating couples get planner dates (D) — co-located leisure that grows strength; `had_sex` becomes gated on
   `dating|spouse` **through the same relationship predicate** (fixing both the rate outlier's incoherence
   and its magnitude, see Part 5).
4. `proposed_marriage` (new action, askFirst, planner-placed at a nice venue — the brief's example) →
   `engaged`; the existing `marriage` event keeps Engine-B ownership but its eligibility gains
   `relationship: dating/engaged, minStrength` — it stops marrying strangers.
5. Divorce hazard shaped by sustained low strength + rival edges + mood (G) — sad marriages end more often;
   good ones don't. `ex_partner` edges persist and season future logs (awkward encounters are free lore).

**B5. Asset & hydration.** The generator (K) runs the same graph off-map, so drawn people arrive with
friends — and when a drawn person's friend is *also* materialized later, the edge reconnects (ids are stable
within the window). For pre-graph assets and cold starts, a deterministic backfill synthesizes edges from
existing log co-occurrences (people who share `visiting_friends` ticks) — imperfect but coherent.

**B6. Consent upgrade (the brief flags it).** `evaluateConsent` keeps its shape and stream isolation, but the
placeholder 80% roll becomes a scored policy: base by action posture (authored), shifted by edge
kind/strength, mood (G), recent declines (the log), and traits (M). Deterministic, same salt
discipline. A spouse's hug ~always lands; a stranger's rarely; a rival's never — and *declines now mean
something* because they dent strength.

### C. Reciprocity — bilateral logging, counterpart events, reactions

**Size: M. Gripes addressed:** "the other person should receive an Apple, both as an event log and as a
practical consequence", "people do things to other people that other people don't react to".

**C1. Counterpart events (code: one engine extension; then a data sweep).** Extend the action `events` block:

```jsonc
"events": {
  "onComplete": "gave_gift",
  "onCompleteTarget": { "event": "received_gift", "params": { "object": "$params.object", "from": "$subject" } }
}
```

The engine fires the target-side event through the existing `EventEngine.invoke` with **subject = the
target**, the same `causationId`, and a typed payload — so the receiver's inspector shows "Received a gift —
a paring knife, from Ana Souza" chained to the same seq as Ana's "Gave a gift". Zero new logging machinery:
it reuses invoke, params (067), and causation. The object *already* moves (the `transferObject` consequence
works today); what was missing was purely the second half of the story.

**C2. Demote the fake doubles (data pass P2, the flagship case).** Every texture event that narrates the
receiving/witnessing side of something a real action now produces loses its `probabilistic` trigger and
becomes manual-only, fired from C1 links: `received_gift`, `became_pregnant` (texture double),
`helped_a_neighbor_move`, etc. **No event is deleted** — each gains a *true* source instead of a dice roll.
The event-classification generator gets a new disposition column (`counterpart`) so the checked-diff doc
tracks the rewiring.

**C3. Reactions (code: one dispatch extension; data: `reactions` on events).** Brain already dispatches
`onEventCommitted` per person; extend commit fan-out so **role-bound participants** (not just the subject)
receive the hook. Then a data-authored reaction table on events:

```jsonc
"received_gift": { "reactions": [
  { "action": "thanked_person", "chance": 0.8, "target": "$from" },
  { "action": "hugged_person", "chance": 0.25, "target": "$from", "requires": { "relationship": { "kind": ["friend","close_friend","dating","spouse","family"] } } }
] }
```

Reactions are one level deep (the decline-dispatch precedent from 073 — structurally no loops), same-tick,
deterministic rolls on the person's forked stream. An argument begets a retort or a walk-away; a gift begets
thanks; a joke begets laughter *from the person it was told to*. This is where co-located scenes start
reading as scenes.

**C4. Witnesses (small, optional, high lore-per-cost).** Co-located third parties may log a witnessed entry
(rate-limited, e.g. ≤1/day): "Saw Ana and Bruno argue at the bakery." Implemented as one more C3 fan-out with
a `witness` role. Cheap Dwarf-Fortress-grade texture — and the substrate Workstream O (reputation & gossip)
turns into town memory.

### D. Plans & appointments — intentionality across ticks

**Size: M–L. Gripes addressed:** "no logic to plan and go where that person is to do important stuff",
"contextual importance evaluation", cadence ("some things you do on a schedule"), joint activities.

**D1. The agenda (code).** A persisted per-person `Agenda`: entries `{ id, intent (actionId+params+location),
window (earliest/latest tick), prerequisites (predicate), onExpire, causationId }` — deliberately shaped like
the event engine's persisted schedule queue (042), which proved the pattern. A `plannerHook` (between the
obligation hooks and the social hook) proposes due entries at `required` necessity; unmet prerequisites defer;
expired entries log a typed abandonment (a broken plan is *also* story). Save v15.

**D2. Producers (each its own small feature, all riding one mechanism).**

- **Needs restocking (with A/F):** pantry below threshold → enqueue `shopping_trip` with a shopping list
  parameter, before the cooking urge peaks.
- **Social visits (with B):** high `social` urgency + a `close_friend` not seen in N days → enqueue a visit
  **at the friend's location** — the planner resolves the friend's home/venue through the world adapter and
  the normal transition machinery walks/drives there. This is the general answer to "go to where that person
  is": location-of-person becomes a first-class intent target (`locationOverride: person:<id>` resolved at
  execution).
- **Milestones (with B):** `proposed_marriage` gets planned — venue chosen (park/restaurant via placement
  tags), partner invited (D3), ring optionally bought first (F). A proposal is a *project*, and the log reads
  like one: bought a ring → invited her to the park → proposed. Causation chains the whole arc.
- **Cadence:** weekly groceries, visiting elderly parents on weekends, hobby nights — authored as
  `routine` templates in `json/routines.json` (trait-weighted — see M — deterministic assignment) so people have
  *habits*, the mid-frequency layer between hourly needs and rare milestones.

**D3. Joint plans / invitations (the couple-walk mechanism).** A new `invite` interaction pattern: an
askFirst discrete (`invited_person_over` exists; generalize with an `activity` parameter) that on-consent
installs **mirrored agenda entries** in both people's agendas (same window, same venue, linked ids). When
both arrive, each runs the shared continuous action (`taking_a_walk_together`, `having_dinner_together`, a
date). No true multi-person action instance is needed — two linked instances + co-location requirements get
100% of the visible behavior for ~20% of the engine complexity; the linkage id lets children reference the
companion for counterpart events (C). Declines ride the existing consent machinery. This single mechanism
delivers: couple strolls, dinner guests, playdates, double-shifts of lore.

### E. Street life — getting people out of buildings

**Size: M. Gripes addressed:** "people mostly do things inside buildings; the simulation is visually dull;
jogging, sidewalk cleaning, couple walks, skateboarding, walks alone".

**E1. Ambulatory continuous actions (code: LiveWorld + Person).** Today `location: 'outside'` exists but
outdoor continuous actions don't *move* anyone. Add an `ambulatory` field to action definitions:
`{ "ambulatory": "stroll" | "jog" | "loop" }`. In `LiveWorld`, an ambulatory instance generates a walking
route over the existing curb/crosswalk network (the A* + waypoint machinery is already there) and keeps the
person visibly walking it while the instance runs, at a pace per kind; `BootstrapWorld` treats it as any
other immediate transition (no `if bootstrap` — the adapter seam holds). Children (pool discretes) commit
as they stroll — "greeted a neighbor" happens *at the moment they pass someone* when co-location allows,
which C's reactions then make mutual.

**E2. The outdoor repertoire (data — new actions, ~35–45).** All with proper requirement gates (this is
also data pass P1's model case):

- `jogging` (ambulatory: jog; satisfies `fun`/`purpose`; morning/evening modifiers; health gate),
  `walking_the_dog` (requires a dog — see N), `riding_skateboard` (**requires
  `carries: { archetype: skateboard }`** — the brief's example, and the audit confirms the archetype exists
  while nothing gates on it), `bicycle_ride` (same pattern).
- `cleaning_the_sidewalk` (home-adjacent, requires carried cleaning supplies, ties into H's litter),
  `tending_the_front_yard` (house with garden tag).
- `taking_a_walk_together` / `evening_stroll_with_partner` (joint plans, D3 — the couple's walk, both
  sprites walking the same route).
- Kids: `street_games`, `chalk_drawing`, `riding_bikes_with_friends` (weekend/after-school windows —
  the calendar gates exist).
- Errand texture: `window_shopping` (ambulatory along shop-fronted roads), `feeding_pigeons_in_the_square`.

**E3. Presence & visibility.** Outdoor performers stay visible (not `indoors`-hidden), the activity label
(J) floats over them, and suddenly the streets *narrate themselves*. No new art needed — the brief is
explicit that movement + label is enough for now.

### F. Objects with purpose — acquisition, capacity, consumption, a real market

**Size: L. Gripes addressed:** "people hold much more than makes sense, no intentionality grabbing objects",
"we don't even have a market", the 12k-dough problem, cooking↔buying disconnect.

**F1. Carry capacity (code, small).** `Inventory` already computes carried weight (`Inventory.ts:404`);
nothing consumes it. Add per-person carry budgets (weight + a slot count for non-pocketables, tunable in
`json/objects`-adjacent config); `grab`/`pocket` intents and the acquisitive hooks respect it; exceeding
budget is a typed plan failure like any other. The inventory-opportunity hook gets demoted from "always
pocket anything" to a *curiosity* behavior: low chance, capacity-gated, novelty-biased (prefer archetypes
never carried — the pebble/seashell charm stays, the 6,709 wristwatches don't).

**F2. Home storage & fetching (code + data).** People **stow at home**: a `stow`/`fetch` pair of discretes
(new) moving instances between person and their house's location inventory (the per-building object location
from 070/076 already exists — this is pure reuse). A homecoming sweep behavior (planner routine) deposits
non-essentials. Planned actions that need tools *fetch first* (D prerequisite): repair fetches the toolbox;
cooking checks the pantry — which is simply *food objects located at the house*. The "household pantry" needs
no new storage system at all; it's the house location inventory plus a query.

**F3. Retail materialization — the actual market (code seam + data).** The abstract monthly demand economy
stays authoritative for P&L; this workstream gives it a **concrete object face**: shopping actions at a venue
convert *business-owned stock instances* (which production recipes already create — the 12k doughs!) into
household-owned objects with a real `adjustMoney` micro-transaction. Buying groceries at the supermarket
consumes supermarket stock; the bakery's `bread_loaf` mountain finally has an outlet. Reconciliation keeps
double-counting away: micro-purchases accumulate into a per-business counter that the monthly economics
*nets out* of the abstract demand resolution (the monthly tick treats materialized sales as part of
`unitsSold`, not in addition to it). Stock ceilings on production recipes (a business stops baking into a
full shelf) + perishables (`expiresAfterTicks` on consumable archetypes, a daily decay sweep, `spoiled` state
→ discard/discount) close the loop: production → shelf → purchase → pantry → cooking → eating → `food` need.
Every step already has actions; they finally *connect*.

**F4. Ownership norms (feeds G).** Free-to-take remains for genuinely loose public objects, but shop stock
and other people's possessions are *not grabbable* — taking them without the purchase/gift/lend path becomes
structurally distinguishable, which is exactly the hook crime (G4) needs.

### G. Consequence — mood, illness that matters, vices, crime & police

**Size: XL (split into G1–G4 as separate tasks). Gripes addressed:** "a lot of Events have no consequence",
"getting sick doesn't prevent working", "no concept of bad stuff — depression, alcohol, stealing; police
should chase; coherent causes".

**G1. Mood (code primitive + valence data pass).** A per-person `mood` (0–100), serialized, closed-form
mean-reverting toward a baseline (from need satisfaction, A) with **event impulses**: every event may declare
`valence: -3..+3` (data pass P2 tags all 707 — most texture events get ±1, which retroactively gives the
whole texture corpus *mechanical meaning* without touching their probability). Big impulses decay slowly:
a spouse's death is a −3 with a months-long half-life (grief is a *state*, not a line). Mood feeds selection
exactly like needs do (multipliers via the same gradient machinery), feeds consent (B6), feeds the divorce
and job-performance hazards, and displays in the inspector.

**G2. Illness with teeth (mostly data + two small code hooks).** `fell_ill` gains severity variants (data:
mild/serious via effect-set `health` levels) and a **minimum duration** (an occurrence limit window on
`recovered` keyed to the illness commit — engine already supports `hasEvent` recency; a `recovered`
requirement of `fell_ill within > N ticks` inverts today's instant-cure). While `health < 0.6`:
`bedridden`-band behavior via selection gates (rest need decays fast, outdoor/leisure weights collapse) and —
the crucial one — the **JobOrchestrator checks fitness**: a sick person doesn't start the shift; a new
`called_in_sick` event (manual, fired by the orchestrator's skip) notifies the log, feeds absence counters
(too many absences raise the layoff hazard — honest, cruel, Dwarf-Fortress-appropriate), and G2 ties recovery
speed to rest + healthcare coverage (H): a town with a hospital and doctors genuinely recovers faster —
measured, not scripted.

**G3. Vices with coherent causes (data-first).** Coping behaviors gated on mood/grief: `at_the_bar` (exists)
gains mood-low multipliers ×4; new `drank_alone`, `stayed_in_bed_all_day`, `skipped_the_gathering` (social
withdrawal). A small serialized `habits` map (per-vice counter with closed-form cooling) escalates: repeated
coping raises the habit's own selection weight (addiction as a positive-feedback loop in the same selection
math — no bespoke system), and high habit + high mood generates recovery arcs (`cut_back_on_drinking`
event, texture today, becomes wired to the habit dropping). The brief's causal chain — *death in the family →
grief → drinking → maybe trouble* — emerges from G1's grief impulse × G3's mood gates, with **zero scripting
of the chain itself**. Depression gets the same honest treatment: mood held below a threshold for N
consecutive days commits a wired `depressive_episode` — a *state*, not a line — that deepens the withdrawal
gates (social/fun weights collapse, oversleeping rises) until lifted by a recovery arc whose hazard reads
social support (close-friend/family interaction frequency, B), healthcare coverage (H), and time. Someone
whose friends keep visiting genuinely climbs out sooner — measured through the same selection math as
everything else.

**G4. Crime, police & the chase (code + data + one new registry).**

- **Property crime:** `shoplifted_an_item`, `pickpocketed_someone` (askFirst: no! — these use the
  interaction contract *without* consent, a new `covert: true` posture where the target's brain instead
  rolls *detection*), `burgled_a_house`. Gated hard on desperation: arrears + low money + low mood + (later)
  traits — the brief's "stealing should result from financial struggle" is literally the selection gate.
  Stolen instances keep their true owner (the ownership/possession split was built for this) + a `stolen`
  provenance flag.
- **Incidents (new small registry):** crimes enqueue `Incident` records in a serialized `CityIncidents`
  (id, kind, location, suspect, witnesses via C4, status). It is deliberately the JobMarket/HousingMarket
  adapter pattern: engine-agnostic, scene-free, serialized.
- **Police work:** the police-station blueprint (076) gets a real repertoire: `patrolling` (ambulatory, E —
  visible beat walks; presence lowers the local crime gate), `investigating_incident` (assigned via the Job
  Orchestrator's rotation from open incidents; resolution odds scale with witness count), and **the chase**:
  when an officer and a wanted suspect co-locate, a `pursuit` pair of linked ambulatory actions (D3
  machinery, adversarial flavor) — suspect flees toward home, officer follows at higher pace; outcome
  resolved by a deterministic event roll weighted by distance/age/health. **Visually it is two sprites
  running down the street** — the exact scene the brief asks for, built from E's ambulatory + D3's linkage,
  no new movement tech.
- **Consequences:** caught → `fined` (ledger transfer, money-conserving) or `detained` (a `detained` state
  suspending job/school/agenda — served at the police station until G5's jail lands) + a `criminal_record`
  log entry that JobMarket scoring reads (harder hiring — which feeds back into desperation: a real
  recidivism loop, emergent not scripted).

**G5. Jail & detention (the gripe list names it — make it a place, not a flag).**

- **The building:** a `jail` blueprint (civic, alongside the police/fire stations promoted in 076) with
  `corrections_officer` jobs and placement tags generating cell/canteen objects (data pass P4). Until a town
  builds one, short detentions serve at the police station (G4's stopgap); sentences above a severity
  threshold *require* jail capacity — a town without one visibly cannot hold anyone, and the coverage
  ledger (H) says so.
- **Detention as a lived state:** a sentenced person relocates to the jail — materialized, visible,
  inspectable like anyone. Their agenda suspends (D), job/school assignments pause with the honest absence
  consequences (G2/I flags), and their days run a constrained repertoire (new actions: `paced_the_cell`,
  `ate_prison_food`, `worked_in_the_laundry` — jail work progresses a skill slowly; the lore writes itself).
  Family can visit (`visited_person_in_jail`, planner-driven, both sides logged via C1).
- **Release & reintegration:** a `released_from_jail` event restores the agenda and re-enters housing
  through the existing relocation helper (if the household moved on, the homelessness machinery catches
  them — grim, honest); the `criminal_record` weights JobMarket scoring down over a decaying window.
  Recidivism needs no scripting: the same desperation gates that caused the first offense are now harder to
  escape.
- **Sizing:** M. Code: the detention state + relocation + suspension seams. Data: blueprint, tags,
  repertoire, events.

### H. City services & the needs ledger

**Size: M. Gripes addressed:** "no concept of public services and people don't miss them", "no tracking of
city needs".

**H1. The coverage ledger (code, read-only derivation).** A `CityServices` module computing, from data that
already exists (businesses, jobs, assignments): healthcare coverage (practicing doctors/nurses per capita,
hospital/clinic presence), police coverage (officers per capita, station presence), education (seat surplus —
already computed by SchoolRegistry), garbage (H3), fire (declared but stubbed — see H4). Ratios, not
booleans; recomputed on the day cadence; serialized nowhere (pure derivation).

**H2. Coverage has consequences (wiring, mostly data).** Each service publishes a *factor* the existing
engines consume: recovery hazard × healthcare factor (G2), crime gate × police factor (G4), plus feed/advisor
surfacing (J): "Nobody in Vila Nova has seen a doctor in years." The city dashboard (`CityDetails`) gets a
services panel with the ratios and trend arrows — the player's town-building decisions finally push person-
level outcomes through measured paths.

**H3. Garbage (the visible service).** Outdoor/venue activity generates `litter` objects (data: new
archetypes, tiny weights, `generation` via activity children — `dropped_a_wrapper` etc. at low rates);
accumulating litter at a location lowers mood there (a location-mood factor) and weights `cleaning_the_
sidewalk` (E). A `sanitation` blueprint (new) with `garbage_collector` jobs whose work repertoire is
**collection rounds** — ambulatory work actions visiting litter-heavy locations and consuming litter objects.
Streets that are cared for *look* cared for in the log and feed, and neglect visibly compounds.

**H4. Fire — the damage model & the fire service (promoted from stub to full plan).** The gripe list names
firemen; fire needs one prerequisite no other service does — things that can burn:

- **Building condition (code, small):** a per-building `condition` (0–100, serialized) — slow closed-form
  wear, restored by repairs/maintenance (repairs generate construction-category demand, feeding the existing
  economy). Condition is fire's substrate and independently useful: shabby vs. kept-up houses, a
  location-mood factor (with H3's litter), a landlord's worry.
- **Ignition (data + one hazard):** a tiny per-building fire hazard factored by kitchen/equipment activity
  (stove-usage entries already exist in the log), condition, and — later — weather. A commit creates a
  `fire` incident in `CityIncidents` (G4's registry: one registry for all emergencies).
- **Response:** a `fire_station` blueprint + `firefighter` job whose orchestrator repertoire answers open
  fire incidents — an emergency-pace ambulatory rush (the pursuit tech of G4 at "run" pace; pure E reuse),
  visible on the street. The outcome (extinguished-minor / damaged / destroyed) resolves on a curve over
  response time × fire coverage (H1): a town without a station watches buildings burn — the ledger made
  consequence.
- **Aftermath:** damage lowers condition (capacity/comfort penalties until a `repaired` arc completes);
  destruction vacates the lot through the 037 re-occupancy machinery. Occupants **evacuate** — the
  survival-band showcase (L2): leisure interrupted, everyone out, resumable activities paused (L5) — then
  rehouse through the existing homelessness/relative paths. A small injury/death hazard during the fire
  feeds G's grief arcs honestly.
- **Sizing:** M–L. Code: condition + incident wiring + outcome resolution. Data: blueprint, repertoire,
  events (`fire_broke_out`, `escaped_a_fire`, `lost_home_to_fire` — some exist as texture today and get
  wired per C2's pattern).

### I. Employment flow, business matching & malleable histories

**Size: M–L. Gripes addressed:** "takes a long time for someone to get a job", "morph businesses to make
sense for residents", "entrepreneurial system", "asset people can't meet the town's needs — inject history".

**I1. Job seeking as behavior (data + planner).** Replace pure hazard-waiting: unemployment enqueues a
`job_seeking` routine (D) — visible applications (`applied_for_a_job` at the venue, new action) that drive
the `get_job` rate up sharply (a `hasAction: applied_for_a_job` factor), with money urgency (A) accelerating
it. Target: **days-to-2-weeks** to employment when a reachable slot exists, and the *search itself is
visible* (they go places, they get turned down — `application_rejected`, more lore). The `get_job` event and
JobMarket remain the single hiring authority.

**I2. Blueprint matching at first placement (code, small).** The 037 unmet-demand weighting already scores
categories for re-occupancy; apply the same scoring (plus a workforce-fit term from JobMarket's existing
candidate scoring over the unemployed pool) to the **initial** blueprint draw. Place three houses and a work
lot → you get a shop the residents can actually staff. Determinism preserved (seed + anchor unchanged; only
the weights feeding the draw change).

**I3. Entrepreneurship (M, high delight).** A qualified unemployed adult with savings above a threshold may
**found a business** on a vacant work lot: a `founded_business` event (gated on skills matching a blueprint's
core job, savings, and unmet demand) that seeds the business with the founder's capital (ledger-clean via the
starting-capital external-sector mirror), auto-hires them at the top rank, and names it after them (faker
pattern exists). Towns *grow their own* economy instead of waiting for the player — and a founder's log
("laid off → struggled → opened Padaria do João") is exactly the kind of life the project is for.

**I4. Career retcon at hydration (the asset-malleability compromise).** The brief's diagnosis is right: asset
people arrive fully-formed, so a town needing a doctor can wait forever. Proposal — **bounded, history-
coherent retcons at draw time**: when the coverage ledger (H) reports a critical gap, the household draw may
select a candidate whose skills are *adjacent* to the needed job and inject an authored transition template
into their hydrated history — e.g. a `nursing_school` event at a plausible past age + the corresponding
`acquireSkill` grants through the normal SkillBook path, appended as real (negative-tick) log entries with a
`retcon` provenance marker. Rules: deterministic (seed + draw), capped (≤1 retcon per household, ≤~25% of
draws), lineage/family/possessions untouched, never overwriting existing events — only *adding* a plausible
chapter. The person still has their real family, their real childhood, their real quirks; they just also
went to nursing school, which the window's skill install reflects. This preserves everything the asset was
built for while giving the town a workforce that can answer its needs.

### J. Legibility — showing what people are doing

**Size: S–M. Gripe addressed:** "we are not showing what people are currently doing anywhere".

**J1. Inspector status line (S — do first, it's nearly free).** `PersonDetails` gets a live "Now:" line —
`Brain.statusOf` + the active instance's definition label + location name ("Now: Working — Attending
patients, at Clínica Boa Vista"), refreshed on `timeChanged` through the bus (a new `PersonStatusQuery`
emitSingle, keeping the HUD/game seam clean). Needs/mood bars (A/G) join the panel when they land.

**J2. Map activity bubbles (M).** A throttled overlay in `MainScene`: for visible outdoor people, a small
label/icon above the sprite with the current action label (zoom-gated, budget-capped to N nearest). One new
bus event (`activitySampled`, batched per in-game minute) — no per-tick spam. Combined with E, the street
becomes self-narrating: joggers jog with "Jogging" over their heads, the officer's "Patrolling" walks past
the kid's "Chalk drawing".

**J3. Day timeline in the inspector (S).** A 24-tick strip of the person's day (log entries bucketed by
hour) — makes rhythm (A) inspectable at a glance and is the natural place to *see* that lives have shape now.

**J4. Feed follows (S).** Feed filter chips by category (uses the existing event `category`), plus "follow
this person" (their texture events get through the feed filter) — turning the feed into the serialized-novel
view the project's premise promises.

### K. Generator fidelity — hourly texture in the history asset

**Size: M. Gripes addressed:** the asset side of "everything feels loose" — windowed people arrive with
day-quantized, workless, school-less histories (Part 0's biggest artifact).

**K1. Two-band recording.** Keep the day stride for the deep past, but run the final `hotYears` (default:
10 — comfortably ≥ the window span) at **hourly** stride. The window selector already picks a "present"
tick; constrain it to the hot band. Windowed people then carry true diurnal texture — real shifts, real
school days, real evenings — while ancestors keep affordable coarse histories. Cost estimate from the 079
numbers (~0.05 ms/agent-step): 250 agents × 86,400 hot ticks ≈ **+18 minutes** on the ~40-minute run.
Acceptable; `--hot-years 0` keeps the old behavior for iteration runs.

**K2. Stride-tolerant new state.** Everything A/B/G add (needs, edges, mood, habits) is specified
closed-form precisely so both bands integrate identically at the seam — this is a *design rule* for those
workstreams, restated here as the acceptance criterion: a value computed at the band boundary must be
identical whether reached by 24-tick strides or 1-tick steps (no per-tick accumulation anywhere).

**K3. Logical-world co-location for the social graph.** `LogicalWorld` already assigns logical homes/
schools/jobs; B's edges need co-location opportunities off-map — logical venues (a per-neighborhood pool)
give the social hook candidates during generation, so asset people arrive with believable friend networks,
not just family.

**K4. A permanent decode diagnostic.** Promote the audit's throwaway decoder into
`scripts/decodePersonHistory.ts` (`npm run decode-person -- p108`) emitting the timeline/frequency views used
in Part 0 — these audits should be repeatable after every generator change, and the Part 0 numbers become
the before/after benchmark for this whole proposal.

### L. The Brain rework — stateful inputs, arbitration v2, interruption & resumption

**Size: L. Gripes addressed:** this is the structural enabler the rest of the plan leans on. The follow-up
to the brief ("this will probably require a major rework of the Brain system") is correct — and this
workstream *is* that rework, stated plainly rather than smuggled in as side effects of A–K.

**L1. The tenet break, made explicit.** `Brain.ts`'s header declares it "deliberately STATELESS: status
derives from the active instance, anti-repetition from the action history." That tenet does not survive this
proposal, and pretending otherwise would rot the docs. The new doctrine: **the Brain owns no state but reads
many** — a decision is a function of (log, active instance, needs A, mood G, edges B, agenda D, habits G,
traits M), every one of them a serialized store *outside* the Brain, read through `BrainDeps` exactly the way
`jobOf`/`schoolOf` are today. What survives unchanged: hooks propose / Brain arbitrates / the engine
executes; nothing serializes inside the Brain object; determinism; live↔bootstrap byte-equivalence. What
dies: the idea that the log alone is enough context to decide. The landing PR updates the Brain header and
CLAUDE.md §4.13 in the same change — doctrine shifts get documented, not discovered.

**L2. Priority bands (code).** The flat `necessity(3) → priority → hook order` sort collapses once Phase 2
multiplies the intent sources (a shift obligation, a planned visit, a critical need, and a social opening
can all plausibly claim "required"). Replace it with a closed band enum, highest first:

| Band | Contents | Examples |
|---|---|---|
| `survival` | critical needs, flight, evacuation | starving → eat; fire → evacuate; suspect → flee |
| `obligation` | shifts, school | today's required intents |
| `commitment` | agenda entries, joint plans | the promised visit; the date; the proposal |
| `need` | urgency-driven picks | hungry → cook; lonely → visit a friend |
| `opportunity` | social/inventory hooks | season the day, never steer it |
| `fallback` | idle default | today's `idleFallback` |

Intents declare `band` + an in-band utility; existing hooks migrate via a mechanical mapping (`emergency` →
survival, `required` → obligation, and so on). Arbitration becomes band → utility → hook order → actionId —
same determinism guarantees, one more comparison.

**L3. One utility currency (code, one shared helper).** In-band utility = authored base weight × need
urgency (A) × mood factor (G) × trait affinity (M), computed by a single `scoreIntent` helper so every hook
prices its intents in the same currency — and so *data keeps the last word*: the authored weights and
modifiers feed the exact formula they feed today, just alongside the new state factors. No hook rolls its
own scoring math ever again.

**L4. Interruption matrix & commitment inertia (code + `json/arbitration.json`).** Explicit rules where
today there is only `mayInterrupt`: (a) an intent may interrupt a running action only from a strictly higher
band; (b) same-band interruption additionally requires a utility delta above an authored hysteresis
threshold — **commitment inertia**: people finish what they start unless the case is clear, which kills the
flip-flopping any needs system otherwise produces at threshold boundaries; (c) `survival` interrupts
anything. The thresholds are data (per band pair), the validator checks the matrix is total, and the whole
thing is inspectable ("why didn't she stop gardening?" has a queryable answer).

**L5. Pause & resume (engine).** A new `paused` lifecycle status for continuous instances flagged
`resumable`: interruption from a higher band *parks* the instance instead of killing it (log:
`interrupted` → later `resumed`, same instance id, causation chaining the interrupter), and the planner
auto-enqueues resumption within a bounded window (past it, a typed abandonment entry — a broken plan is also
story). The walk interrupted by a chase continues after; the fleeing suspect's dinner is still on the stove
when the chase ends, whichever way it ends. This is also what makes the E/G4/H4 street scenes read as
*interruptions of a life* rather than context-free vignettes.

**L6. Decision cadence (perf + realism).** A freshly started action is immune to same-band re-evaluation for
its first N ticks (higher bands exempt). Fewer wasted evaluations per the 078/079 budget discipline, and
less neurotic-looking behavior for free.

**L7. Migration & proof.** One PR migrates all built-in hooks onto bands, carrying an **equivalence
corpus**: synthetic intent sets asserting old-sort vs. new-band outcomes match wherever semantics didn't
intentionally change, plus a documented list of the intentional divergences (there will be some — that's the
point). `arcScenarios` gains interruption/resume cases (the fire drill: leisure → evacuation → resumption)
and the live↔bootstrap equivalence keystone extends over every band path.

**Sequencing note:** L2–L4+L6 land mid-Phase 2, immediately after the planner — the moment intent sources
multiply is the moment the flat sort starts lying. L5 can trail by one task; L1's doctrine change lands with
L2.

### M. Traits & temperament — why people differ

**Size: M. Gripes addressed:** the other half of "too much looks just random". Needs (A) explain why a
person acts *now*; traits explain why *this* person acts *this way* — without them, two neighbors in
identical circumstances behave identically, and no amount of rate-tuning fixes that.

**M1. The vector (code + `json/traits.json`).** Six axes, 0–100, drawn once per person: `sociability`,
`industriousness`, `temper`, `riskAppetite`, `orderliness`, `hedonism`. Drawn deterministically at pool
generation/birth with **mild heritability** — a weighted blend of the parents plus seeded noise, so family
temperaments emerge across the genealogy for free (the hot-headed Silvas; the tidy Nakamuras). Asset people
derive theirs from (seed, personId), so **no asset regeneration is needed**. Effectively immutable: rare
life events may nudge one axis a few points (data-declared, hard-capped) — people are shaped, not rewritten.

**M2. Where traits bite (all through existing seams — no new decision machinery).** Selection: actions
declare optional `affinity` tags (`social`, `tidy`, `thrill`, `craft`, …) mapped to axes; L3's `scoreIntent`
multiplies by the person's affinity factor — a high-orderliness person actually keeps their house clean, a
hedonist haunts the bar *before* mood pushes anyone there, a low-sociability person genuinely prefers the
solitary walk. Consent (B6): temper and sociability shift the base. Vices (G3): per-axis susceptibility.
Crime (G4): `riskAppetite` gates alongside desperation — some people struggle honestly forever, and now
there's a reason. Routines (D2): assignment weights. Reactions (C3): the retaliate-vs-de-escalate roll reads
temper.

**M3. Surface & validation.** The inspector shows traits as prose, not sliders ("Quick-tempered, sociable,
a little reckless" — authored phrase bands per axis extreme; J). Validators: every `affinity` tag maps to a
declared axis; every axis is referenced by ≥N actions (the consumption rule, 076 tradition); heritability
math is covered by a determinism test across a three-generation fixture.

### N. Pets — small companions, big lore

**Size: S–M.** The manifest already dreams of pets (`adopted_cat`/`adopted_dog`/`adopted_goldfish` texture
events; a vet and a pet shop since 076; E2 wants `walking_the_dog`). Make them real at the lightest fidelity
that pays:

- **A `PetRegistry` (serialized):** pets are lightweight records (species, name, owner, birthTick) — **not**
  Persons, no Brain, no needs of their own this iteration; they exist through their owner's behavior.
  Capped per household.
- **Wiring:** `adopted_dog` becomes wired (C2 pattern), fired from a new `adopt_a_pet` action at the pet
  shop; feeding/care are owner routines (D2); `walking_the_dog` is an E ambulatory with the dog implied (the
  label suffices now — a trailing sprite is a scene-layer nicety later); vet visits ride illness-lite pet
  events at the existing vet; and a pet's death lands a real mood impulse (G1) — ask any dog owner whether
  that belongs in a life sim.
- **Why bother:** disproportionate charm per line of code, a new routine anchor for D, more street presence
  for E, and a grief source that isn't a human death — texture the feed sorely lacks.

### O. Reputation & gossip — the town remembers

**Size: M. Gripes addressed:** deepens C (reactions with memory) and G4 (a known thief gets treated like
one) — the Dwarf-Fortress texture multiplier that turns incidents into social reality.

**O1. Known facts (code).** A per-person, capacity-capped (~20 entries, FIFO) memory of *references* to
other people's notable log entries — witnessed directly (C4) or heard (O2). No new content: a fact points at
an existing log seq. The store serializes, and facts decay (old gossip fades; the town forgives, slowly).

**O2. Gossip propagation (one action + data).** A `shared_gossip` social discrete (co-located,
relationship-gated): transfers one known fact to the listener, with authored selection for juiciness
(|valence| × recency × how well the listener knows the subject). The chain composes from parts that already
exist by then: B's edges decide *who talks to whom*, C4 decides *what is knowable*, O decides *how it
travels*. A witnessed crime becomes town knowledge in days — without one scripted broadcast.

**O3. Reputation reads (wiring).** Consent (B6), social target scoring (B3), JobMarket candidate scoring (a
known-criminal factor beside the formal record), and reaction choice (C3) each gain an optional known-facts
factor. Surfacing is restrained: the inspector notes what a person has heard only where it changed an
outcome — no noise.

**O4. Restraint clause.** Facts are bounded, decaying *references* — this is deliberately not a
beliefs/deception/misinformation system. It is the minimum structure that makes "everyone knows what he
did" a mechanical truth instead of a narration, and it leaves a clean extension seam if deception ever
earns its complexity.

---

## Part 3 — Engine expressive-power changes (consolidated)

Everything above respects the flexibility line (new content = data; new primitives = deliberate code). The
complete list of code-level additions, in one place — this is the "give the engine more expressive power"
inventory:

| Primitive | Kind | Workstream |
|---|---|---|
| `NeedsState` + closed-form decay + urgency weighting in selection | state + selection | A |
| `satisfies` field on actions; `needs.json` schema + validator | schema | A |
| `needsHook` (critical-need required intents) | Brain hook | A |
| `SocialGraph` store + closed-form strength decay | state | B |
| `adjustRelationship` effect + consequence op | effect vocab | B |
| `relationship` predicate node; `relationshipToTarget` context attrs | predicate grammar | B |
| Relationship-aware target scoring in the social hook | selection | B |
| Consent policy v2 (edge/mood/history-scored, same stream discipline) | policy | B |
| `onCompleteTarget` / counterpart event links (+ `$subject` param source) | action schema + engine | C |
| Role-participant fan-out for `onEventCommitted` | Brain dispatch | C |
| `reactions` field on events + one-level reaction dispatch | schema + dispatch | C |
| `witness` role fan-out (rate-limited) | dispatch | C |
| `Agenda` store + `plannerHook` + `routines.json` | state + hook + schema | D |
| Joint plans (mirrored linked agenda entries via invite-consent) | mechanism | D |
| `location: person:<id>` intent targets | execution boundary | D |
| `ambulatory` action field + LiveWorld route-walking | schema + world adapter | E |
| Carry budgets (weight/slots) enforced in acquisition paths | rule | F |
| `stow`/`fetch` + house-location pantry queries | actions + query | F |
| Retail materialization seam (stock→purchase, monthly netting) | economy seam | F |
| `expiresAfterTicks` + spoilage sweep + stock ceilings | schema + sweep | F |
| `mood` state + `valence` field on events | state + schema | G |
| Fitness gate in JobOrchestrator (`called_in_sick`) | orchestrator | G |
| `habits` map (closed-form cooling) | state | G |
| `covert` interaction posture (detection roll instead of consent) | interaction contract | G |
| `CityIncidents` registry + police repertoire + pursuit linkage | registry + data | G |
| `CityServices` coverage ledger + service factors on hazards | derivation + wiring | H |
| Demand/workforce-weighted first blueprint draw | generation | I |
| `founded_business` event + founder seeding | event + handler | I |
| Career-retcon templates at hydration (provenance-marked) | hydration | I |
| `PersonStatusQuery` + `activitySampled` bus events | HUD seam | J |
| Two-band generator stride + hot-window constraint | generator | K |
| Priority bands + the `scoreIntent` utility currency | arbitration | L |
| Interruption matrix + commitment hysteresis (`arbitration.json`) | arbitration | L |
| `paused`/`resumable` lifecycle + planner auto-resume | action lifecycle | L |
| Post-start decision cooldown | arbitration/perf | L |
| Trait vector + heritability + `affinity` tags on actions | state + schema | M |
| Building `condition` + fire incidents + response-outcome curves | state + registry | H4 |
| `jail` blueprint + detention state + suspension/reintegration seams | state + wiring | G5 |
| `PetRegistry` + owner-driven pet behaviors | state | N |
| Known-facts memory + `shared_gossip` propagation | state + action | O |
| Reputation factors in consent/market/target scoring | wiring | O |

Every schema addition lands with its data-registry validator and invalid fixtures in the same PR (directive
§5.5), and every serialized addition gets a save-version migration (one coordinated bump per phase, not one
per workstream — see Part 7).

---

## Part 4 — The data audit passes

The brief asks for a full audit of existing content. Four passes, each sized like a content task (050–053
proved the shape), each **gated by generated docs + validators so the audit can never silently regress**:

**P1 — Action interaction audit (all 260, then the new ones).** For every action, answer and record: does it
semantically involve another person? (→ must carry an `interaction` block; targets gated by B's relationship
predicates; counterpart event per C). Does it semantically require an object? (→ `carries`/`objectAtLocation`
requirement — the *skateboard rule*; the audit found e.g. `played_a_game` requires a board game but many
semantic-object actions gate nothing). Does it belong indoors/outdoors/venue? (→ location + E's ambulatory
where apt). What does it satisfy? (→ A's `satisfies`). Deliverable: a generated
`docs/generated/action-audit.md` (checked-diff, like simulation-relationships) with one row per action and
the four verdicts, plus validator rules for the mechanically-checkable subset (an action with a `person`
param must have `interaction` — exists; NEW: an action whose label names an object family must require it,
enforced via an authored `semanticObject` field the validator cross-checks rather than label-parsing).

**P2 — Event coherence audit (all 707).** For every texture event: (a) does a real system now produce this?
→ demote to manual, wire from C1/C3 (the `received_gift` class); (b) does it narrate a state the subject may
not be in? → add the missing gates (`argued_with_partner` requires a partner; `bought_first_car` requires
none owned + money; the audit suggests dozens of these); (c) tag `valence` (G1) — this single column gives
the whole texture corpus mechanical effect; (d) events that should *remain* free-rolling quirk (the
`invented_a_story_about_a_stranger` class) are explicitly marked `quirk: true` so the audit is a decision
record, not a TODO list. Deliverable: the event-classification generator grows the new columns; CI diff-gates
it.

**P3 — Object audit (1,517 archetypes).** Verify/complete: weights & pocketability sanity (carry budgets
make bad weights player-visible), `consumable`/`expiresAfterTicks` for perishables, `satisfies` contributions
for food/fun objects, acquisition channel (which venue category sells it — powers F3's purchases and the
"don't buy what you own" rule), and theft-attractiveness (G4 gates on value). Deliverable: extended object
validator + a generated coverage table (every purchasable object is sold somewhere; every consumable is
consumed by some action).

**P4 — New-content backfills.** The additive passes riding the new primitives: the outdoor repertoire (E2),
the romance arc actions (B4), reactions tables (C3), routines (D2), coping/vice/crime repertoires (G3/G4),
service work repertoires (H3, police G4), counterpart events (C2). Rough order of magnitude: **+120–180
actions, +80–120 event rewires, +40–60 new events, ~30 new archetypes (litter, ring, service props)** — the
corpus grows, per the constraint.

---

## Part 5 — Quick wins (pure data, land this week)

Independent of everything above — manifest edits that fix the worst incoherences immediately:

1. **`had_sex` `perYear: 60 → ~12`**, and (until B lands) keep the partner bind but add a
   nighttime factor; it should also stop being feed-visible if it ever was. Rationale: it is 84% of a life's
   events; nothing else will move the perceived quality of logs as much per character changed.
2. **`get_job` `perYear: 4 → 26`** (≈ 2-week expected wait) as a stopgap until I1's seeking behavior;
   the `canBeHired` gate already prevents overshoot (rolls only fire when a real slot is reachable).
3. **Illness minimum duration:** `recovered` gains `hasEvent: fell_ill, withinTicks > 48` inverse-gating (or
   an occurrence-limit equivalent) so no one is cured within two days of falling ill; lower `recovered`
   `perYear` 24 → 18.
4. **Gate the top-20 most-incoherent texture events** (the `argued_with_partner`-without-a-partner class) —
   a taste of P2 delivering value before the full pass.
5. **`sleep`'s hour modifiers** are fine live but the generator's day quantization (Part 0) misrepresents
   them — no data fix exists; noted here to set expectations until K lands.
6. **J1 (the inspector "Now:" line)** — not data, but small enough to ship alongside as the first visible
   deliverable of the whole effort.

---

## Part 6 — Sequencing, task breakdown & dependency map

Six phases — the full path, arbitration included. Foundations before consumers; each phase independently
valuable and mergeable task by task; numbers continue the backlog at 080. Sizing letters carry over from
Part 2.

**Phase 1 — See clearly, stop the bleeding (S/M).**

- **080** Quick-wins data pass (Part 5) + the `decodePersonHistory` diagnostic (K4) — the before-metrics get
  pinned here.
- **081** Legibility J1+J3+J4 (inspector "Now:" line, day strip, feed filters).
- **082** Reciprocity engine (C1 counterpart events + C2's flagship rewires: the gift/lend/teach/argue set).
- **083** Social graph core (B1–B3: store, effects, predicates, hook target-weighting; consent v2 B6).

**Phase 2 — Motivation & the Brain rework (the heart).**

- **084** Needs engine (A1–A4) + first `satisfies` pass over the existing corpus (opens P1).
- **085** Planner & routines (D1–D2) + joint plans (D3).
- **086** Arbitration v2 (L1–L4, L6): bands, the `scoreIntent` currency, the interruption matrix, decision
  cadence — lands *here* because 084/085 just multiplied the intent sources and the flat sort starts lying;
  ships with the hook-migration equivalence corpus (L7) and the doctrine/docs update (L1).
- **087** Pause & resume (L5) + traits (M1–M3) — completes the utility currency's inputs before the content
  phases start pricing against it.
- **088** Objects: capacity + stow/fetch + curiosity-demoted hook (F1–F2).
- **089** Retail materialization + spoilage/stock ceilings (F3) — closes the food chain end-to-end.
- **090** Romance arc (B4–B5) — needs 083 + 085 + 086.

**Phase 3 — Consequence & the street.**

- **091** Mood + valence pass (G1, with P2's tagging).
- **092** Illness with teeth (G2).
- **093** Street life (E1–E3, outdoor repertoire) + map bubbles (J2) — ambulatory rides 087's resume
  semantics for interrupted walks.
- **094** Reactions & witnesses (C3–C4) — data-heavy; wants mood (091) and traits (087) for reaction rolls.
- **095** Vices, habits & depression arcs (G3).

**Phase 4 — The city answers back.**

- **096** CityServices ledger + dashboard + healthcare/education wiring (H1–H2).
- **097** Employment flow: seeking + first-placement matching + entrepreneurship (I1–I3).
- **098** Career retcons at hydration (I4) — needs 096's gap signals.
- **099** Crime, incidents, police & the chase (G4) — needs 093 (ambulatory), 091 (mood), 096 (coverage).
- **100** Jail & detention (G5) — needs 099.
- **101** Garbage service (H3).
- **102** Building condition, fire & the fire service (H4) — the survival-band (L2) and evacuation showcase;
  needs 086/087 and 099's incident registry.

**Phase 5 — Society deepens.**

- **103** Pets (N) — rides routines (085), ambulatory (093), mood (091).
- **104** Reputation & gossip (O) — rides witnesses (094), valence (091), edges (083).

**Phase 6 — Fidelity & proof.**

- **105** Generator two-band + logical venues + **asset regeneration** (K1–K3) — deliberately after all
  state layers, one regeneration: windowed people arrive with needs, edges, traits, mood, and true diurnal
  texture.
- **106** Validation keystone: an arc-scenario suite in the 075 tradition asserting the *new* invariants —
  a grief→coping→recovery arc, a courtship→proposal→marriage arc, a desperation→crime→chase→jail→release
  arc, a fire→evacuate→rehouse arc, an interruption→resume arc — plus live↔bootstrap equivalence over every
  new hook and band path, and the Part 0 metrics re-measured against 080's pins as the after evidence.

Dependency spine: `083 → 085 → 086 → 087` (the Brain chain), `084 → {085, 091}`, `086 → everything after
it`, `091 → {092, 095}`, `093+091+096 → 099 → 100`, `096 → {097, 098, 102}`, `094 → 104`, everything →
`105/106`. Phases 1–2 answer the brief's core (connected, intentional, reciprocal, *arbitrated*); 3–4 add
consequence and the city layer; 5 the society multipliers; 6 makes the asset and the proof match the game.

---

## Part 7 — Cross-cutting engineering notes

- **Determinism.** Every new stochastic choice forks the world-seed RNG with a documented salt (the
  SOCIAL_SALT convention); every new state decays closed-form (K2 is the acceptance test). Nothing here
  introduces wall-clock, iteration-order, or float-accumulation hazards that the existing test discipline
  can't pin.
- **Execution boundary.** No workstream branches on mode. New world capabilities (ambulatory routes,
  person-location targets) are `WorldAdapter` methods with Live (real movement) and Bootstrap/Logical
  (immediate/abstract) implementations — the 040 seam absorbs all of it, and `arcScenarios` grows equivalence
  cases per phase (task 100).
- **Save migrations.** One coordinated version bump per phase that adds state, not one per workstream —
  indicatively: v15 (graph, Phase 1), v16 (needs + agenda + paused instances + traits, Phase 2), v17
  (mood + habits + incidents + condition + detention, Phases 3–4), v18 (pets + reputation, Phase 5) — the
  exact grouping decided at each phase start. Each bump ships deterministic backfills for legacy saves *and*
  for asset-hydrated people; the two entry points share the backfill function so a person is identical
  regardless of how they entered the world.
- **Arbitration migration safety.** The band migration (086) is the riskiest single change in the plan —
  every behavior flows through it. It lands behind L7's equivalence corpus (old-sort vs. new-band outcomes
  match except where divergence is intentional and listed), plus per-hook characterization tests captured
  *before* the migration so any silent behavioral drift fails CI, not playtesting.
- **Performance.** The budget discipline from 078/079 applies: needs/mood are O(1) lazy reads; the graph is
  sparse (edges only where interaction happened) with the same per-location indexing the co-location fix
  proved; reactions/witnesses are strictly rate-limited; the perf suite gains gates per phase *before* the
  asset regeneration (099) so the ~40-minute default run stays ~1 hour with the hot band.
- **Validators.** Every new schema field registers in `game/data/` with invalid fixtures in the same PR;
  the three generated docs (relationships, classification, and the new action-audit) diff-gate the data
  passes so audit conclusions are enforced, not aspirational.
- **The constraint, restated.** Nothing in this proposal deletes an action, an event, or an object. The
  521 texture events all survive — re-gated, re-triggered, valence-tagged, and in many cases finally *true*.
  The corpus grows by roughly 150–250 entries. The engine grows by the Part 3 table. The people, if this
  lands, grow a life.

---

## Part 8 — Gripe-by-gripe traceability

The original brief, item by item, against what solves it, how, and where in the plan (workstream letters →
Part 2; task numbers → Part 6). This is the acceptance checklist for the whole effort: task 106 re-measures
every "before" number pinned in Part 0/080 against these rows.

### Gripe 1 — "People do a lot of things that aren't really connected, very random things"

**Solved by A + M + D + L (tasks 084–087).** Needs give each hour a *reason* (hunger → cook → eat; loneliness
→ visit), so picks connect to state instead of dice; traits make the distribution *personal* (the same needs
produce different lives for a tidy homebody and a reckless socialite); routines add the habit cadence
between hourly needs and rare milestones; and arbitration's commitment inertia (L4) stops thrash between
picks. The quirk is deliberately preserved: opportunity-band actions and `quirk: true` texture events keep
seasoning the day — the target is rhythm-with-spice, not a schedule. **Measured by:** the p108-style
frequency table stops being sleep + uniform noise; a decoded day reads as morning → work → errand → evening.

### Gripe 2 — "People do things to other people that others don't react to, with no consequence (the apple)"

**Solved by C (082, 094).** The apple already moved (`transferObject` works today); what was missing is now
explicit: the receiver logs the counterpart event with the same causation id (C1), reacts in the same tick
(C3 — thanks, a hug back, a retort), and bystanders can witness it (C4). The fake probabilistic doubles
(`received_gift` rolling at random, disconnected from any gift) are demoted to manual and wired to the real
source (C2), so logs stop contradicting reality.

- **2a — presence & object gates.** Person-actions already require co-location at start (the 072 contract —
  verified in the audit); the P1 action audit closes the *object* half: every semantically-object action
  gains its `carries`/`objectAtLocation` requirement — **skating requires the skateboard** (E2 models it) —
  enforced by the `semanticObject` validator so it can never regress. Rolls through the Phase 2–3 data
  passes.
- **2b — smart target choice, co-location, going to people.** B (083): targets weighted by relationship
  edges; intimate actions hard-gated by the relationship predicate — **kissing requires `dating|spouse`**,
  and `had_sex` gets the same gate. D (085): important acts are *planned* — venue chosen, travel through the
  normal transition machinery, partner invited — with **propose-at-the-park** as the worked example
  (D2/B4). `location: person:<id>` intent targets (D2) are the general "go to where that person is"
  mechanism.
- **2c — contextual importance, wants/needs, the food chain, the market.** A (084) is the wants-and-needs
  system the brief suspects is missing; F (088–089) closes hunger → pantry → cooking → eating and adds the
  *actual market*: purchases convert real shop stock to household objects with money moving.
  `bake_cake`'s 206/206 block rate is the pinned before-metric; task 106 asserts it completes in normal
  play.
- **2d — street life.** E (093): ambulatory actions visibly walking routes — jogging, skateboarding,
  sidewalk cleaning, walks alone; D3 (085): the **couple walk** as a consented joint plan (both sprites, one
  route); B6 (083) is the consent upgrade the brief flags; J2 labels make all of it readable from the map.
- **2e — events with no consequence.** G2 (092): the sick **don't go to work** (`called_in_sick`, absence
  risk, fitness gate in the orchestrator) and can't be cured within hours (minimum-duration gating —
  stopgap in 080); G1 (091) valence gives all 707 events mechanical effect through mood; H (096) makes
  recovery measurably faster in a town with a doctor.

### Gripe 3 — "People hold much more than makes sense; no intentionality grabbing objects"

**Solved by F1–F2 (088).** Carry budgets (weight + slots) enforced at every acquisition path; stow-at-home
sweeps and fetch-for-purpose (the toolbox before the repair, the list before the shop); the pocket-anything
hook demoted to a rare, novelty-biased curiosity. Acquisition becomes planner/need-driven. **Measured by:**
the median-553-carried number from the audit re-measured in 106; target is a life that fits in two hands
and a house.

### Gripe 4 — "We are not showing what people are currently doing anywhere"

**Solved by J (081 + 093).** The inspector "Now:" line (Brain.statusOf finally surfaced), the day-timeline
strip, feed filters/follows in 081; map activity bubbles over outdoor people in 093. The audit's finding —
`statusOf` exists and nothing reads it — is closed in the first phase.

### Gripe 5 — "Takes too long to get a job; morph businesses to fit residents; entrepreneurial system; make it flow"

**Solved by 080 + I (097).** Immediately: the `get_job` rate stopgap (080) cuts the ~3-month wait. Properly:
job seeking as visible planner behavior (applications, rejections, urgency scaling — days-to-two-weeks,
I1); first-placement blueprint draws weighted by unmet demand *and* the residents' actual skills (I2 — the
"morph businesses to make sense for them" ask); entrepreneurship (I3) lets a qualified unemployed resident
found the business the town lacks. **Acceptance test of 097:** place two houses and two work lots, and
within an in-game month the town is visibly working.

### Gripe 6 — "No public services, and asset people can't meet the town's needs; inject history"

**Solved by H (096) + I4 (098).** The coverage ledger tracks doctors/police/education/garbage/fire/jail per
capita and wires each ratio into real outcomes; and **career retcons at hydration** (I4) implement exactly
the compromise the brief sketches: asset people keep their families, histories, and possessions, but a
bounded fraction of draws may gain a plausible injected chapter (nursing school at 24, provenance-marked,
appended through the normal skill/log machinery) so the town can staff its clinic without blank-slate
immigrants.

### Gripe 7 — "No tracking of city needs — police, firemen, garbage, doctors, jail"

**Solved by H1–H2 (096) + the service loops.** Every named service gets both a ledger line and a real
loop: doctors (096, wired into recovery/death hazards), police (099 — patrols, investigations, coverage
lowering the crime gate), garbage (101 — litter, collection rounds, street-level consequence), **jail**
(100 — a real building with detention as a lived state, capacity on the ledger), **firemen** (102 — building
condition, ignition, visible response, damage/destruction). The dashboard (096) puts the ratios and trends
in the player's face.

### Gripe 8 — "No bad stuff — depression, alcohol, stealing — coherently caused; police should chase, criminals should run"

**Solved by G (091, 095, 099, 100).** The coherence is the design: a death in the family lands a grief
impulse (G1) → sustained low mood raises coping-action weights (G3) → repeated coping escalates a habit —
*death → drinking* emerges from three data-driven multipliers, zero scripting. Depression is a wired state
(`depressive_episode`) with recovery arcs read from social support and healthcare. Stealing gates on
arrears + low money + low mood + risk appetite — *financial struggle → theft*, literally the selection gate
(G4). Police **chase visually on the street**: officer and suspect run linked ambulatory routes (E's
movement + D3's linkage), the suspect genuinely fleeing, the outcome a deterministic roll — then fines,
detention, jail (G5), a record that makes honest work harder, and an unscripted recidivism loop.

### The follow-up gripe — "this will probably require a major rework of the Brain system"

**Confirmed, and planned as L (086–087).** The stateless tenet is formally broken and re-documented (state
lives in serialized stores; the Brain reads them all); arbitration moves to priority bands with one utility
currency; interruption gets an explicit matrix with commitment hysteresis; continuous actions gain
pause/resume; and the migration is proven by an equivalence corpus plus pre-captured per-hook
characterization tests (Part 7) — the rework is real, but it lands as one auditable step, not a rewrite.
