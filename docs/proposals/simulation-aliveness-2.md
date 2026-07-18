# Simulation Aliveness 2 — the live-play truth audit

**Status: v2 — the arc is IMPLEMENTED** (branch `task/simulation-aliveness-2`, one PR: LP-1…LP-14 landed as sequential commits; the flagged follow-ups — the exhaustive LP-7 texture catalogue, the LP-14 label-template data pass, the LP-9 generator decode audit + asset regeneration, and the LP-10 family-tree/skills-panel polish — remain open). Originally: findings + proposed arc, v1.** This document is the deliverable of a full re-run of the task-117
observation pass — this time **in the real game, in a real browser** (the Claude-in-Chrome session the 117
notes said was still owed), plus a fresh static sweep of the manifests and the live glue. Where the
aliveness/visibility arcs (080–118) were validated headless — through the generator and the Jest E2E suites —
this audit asks the question those instruments structurally could not: **what does the sim actually do when a
player starts a new game, places a town, and watches?**

The headline: **the motivational, social, and reciprocity machinery genuinely works in live play** (gossip
pairs both sides, hugs land counterparts, consent declines log, school runs complete, job seeking is visible
on the street with activity bubbles, the nagbar and feed narrate honestly). But a handful of live-only
breakages — invisible to the generator because the logical world abstracts exactly the things that break —
leave the flagship loops (eat, work, garbage) dead or sporadic on the map, and the texture corpus still
free-rolls enough incoherence to undermine the ground truth. Round 1 made the *engines* feed each other;
round 2 has to make the *map* feed them.

## How this was observed

- Dev build (`npm run dev`), booted via the task-008 harness (`?test=1&boot=asset&seed=20260717`) through the
  **real committed history asset**, in a visible Chrome tab (Phaser's loop halts entirely in hidden tabs —
  see P2-7).
- A scripted 13-house / 12-business town (roads, houses, generic lots, and the full civic set placed through
  the real construction-menu path — pinned `tileClicked` events), 32 asset-drawn residents.
- ~16 in-game days advanced through the harness, with two new **test-mode-only** instruments added to
  `TestHarness.ts` during the session (uncommitted, on the working tree — proposed as a keeper):
  - `__townbox.debug()` — the live `GameManager`, for read-only console inspection of every store;
  - `__townbox.stepGame(ticks, framesPerTick, deltaMs)` — tick advancement **interleaved with movement
    frames**, because `stepTicks` alone starves every LiveWorld transition (nobody arrives anywhere, so
    location-gated actions — sleep at home, work at the workplace — silently stall; the first measurement
    pass produced "0 sleeps in a week" purely from this artifact).
- Caveat inherited by everything below: even `stepGame` compresses movement time relative to sim time
  (~20% of real-time movement per tick at the settings used), so *arrival-dependent* loops measured here are
  a **lower bound** on real-time behavior — but the shipped `T` throttle has the same desync (P0-5), so real
  fast-forwarded play behaves like the pessimistic measurements, not the optimistic ones.

Where a finding is static (manifest/code), it is marked **[static]**; where observed live, **[live]**; most
are both.

---

## Part 1 — P0: live-play breakers

### P0-1 · Saving the game is impossible in asset-backed play

**[live]** Ctrl+S and the toolbar save both fail after a few in-game days:
`Save failed: RangeError: Invalid string length` in `SaveManager.serialize` (JSON.stringify exceeds V8's max
string). Root cause: **lazy hydration installs each drawn person's full asset history into the live
`LifeLog`** (`EventEngine.installPersonLog`) — measured: João Pedro Pereira's log holds **105,054 entries**
back to tick −355,546 — and the v8+ save serializes the whole append-only log. 32 residents × ~100k entries
kills stringify outright; even a town that squeaked under the limit would blow localStorage's ~5MB cap after
compression. **A player literally cannot save.** Also degrades memory and every `getPersonLog` scan.

*Direction:* the snapshot should persist only live-era entries (the asset ref + hydrated ids already pin the
pre-game past for re-hydration on load — that machinery exists since v14); pre-game entries stay a
hydration-time view, never save payload. Consider a `liveLogFloorSeq` per hydrated person.

### P0-2 · The food loop is structurally dead at live start — the town starves and nobody cares

The flagship hunger → shop → cook → eat chain (A/F, "closed" by 089/113) does not function on a fresh map:

- **[live]** By day 2, multiple residents sit at `food: 0`; by day 10 **half the town** (including the
  supermarket's own staff, and two 13–14-year-olds) is at food ≤ 15. One resident starved *inside the
  supermarket*.
- **[live]** The supermarket's generated contents are **office props** — desks, hole punches, staple
  removers, letter openers — plus 2 tomatoes, 1 egg, 1 pasta box. That IS the shelf. Placement-tag
  generation fills a supermarket like an office, and nothing seeds retail food stock at placement.
- **[static]** No production recipe restocks a grocery shelf, ever: `restocking_shelves` exists as a clerk
  work action but has **no object-action-relationship entry** — it produces nothing. The OAR production set
  is bakery bread/cakes, workshop crates/planks, parcels, and restaurant `kitchen_customer_order` only. The
  abstract demand economy's "food" and the object-level groceries are **disconnected on the supply side**.
- **[static+live]** Task 113 retired the conjuring fallback wherever a real shop stands (`atRealShop` in
  `Consequences.ts` `purchaseObject`) — so **placing a supermarket makes the town less able to buy food**
  than not placing one: the empty shelf is now "the truth" and purchases are typed failures.
- **[live]** Homes generate ~40 objects each with essentially no pantry (observed kitchen: stove, oven,
  fridge… one banana). So cooking's ingredient requirements fail everywhere.
- **[live]** People **pantomime cooking**: 169 `cooking_meal` completions in 10 days produced ~18 `ate_*`
  entries town-wide. The wrapper's requirements pass (stove exists), the `ate_a_meal` child that actually
  satisfies `food` is requirement-gated out, and the wrapper still completes cleanly. The #1 life event in a
  starving town: `tried_new_recipe` (64×).
- **[static]** And none of it matters mechanically, because **needs feed nothing but selection weights**
  (P1-1): the town at food 0 holds a median mood of 77.

*Direction (bundle):* (a) seed staple pantries in residential object generation and food stock in
grocery-class blueprints at placement; (b) give grocery venues a real restock channel — an OAR entry for
`restocking_shelves` producing shelf stock bounded by the 089 ceilings and netted against the abstract
economy's materials, so the B2B "food" the supermarket already buys becomes objects; (c) make wrapper
`satisfies` honest (a cooking run whose eat-child never fired should not read as a meal — move all `food`
satisfaction to the eat children, which is what the aliveness proposal specified); (d) needs-starvation
consequences (P1-1) so the failure is *visible* the moment it regresses.

### P0-3 · On-duty work is sporadic-to-absent in live play; entire service loops starve downstream

- **[live]** Over 16 days with ~24 employed adults: `started_working` fired **7 times**, `stopped_working`
  **40** — people "clock out" of shifts they never physically reached (the orchestrator's shift-end
  interrupt fires `stopped_working` on instances still `waiting_for_materialization`). At any instant,
  ~half of all live action instances (15 of 34 observed) sat in `waiting_for_materialization`.
- **[live]** The town's only Doctor spent 16 straight days cycling `spending_time_at_home` at 10:00 on
  workdays — **never one work attempt in his log** — while `jobOf` verifiably returns a full repertoire for
  him (title-join, shift 08:00–18:00, all days). Blocked/failed transition cycles are **not logged**, so
  whatever kills his intents is invisible in the inspector: silent-failure loops are structurally
  undiagnosable from the log.
- **[live]** Downstream, every arrival-gated service loop starves: **garbage collection never ran** (curb
  bags 0 → 95 in 15 days, monotonically, with a placed, staffed landfill), doctors treat nobody
  (`doctorRounds` needs a co-located on-duty doctor), shelves never restock, and — untested live but
  implied — police/fire dispatch would depend on the same layer.
- Part of the measured severity is instrument compression (see method note), but the **flakiness is real at
  any speed**: work discretes fire in rare bursts rather than each workday, and the doctor case is absolute.

*Direction:* a dedicated live-transition reliability task — (a) log `blocked`/transition-failed lifecycles
(typed, causation-chained) so failure loops become visible in the inspector; (b) trace and fix the commute
pipeline under tick-stepped time (the commute pump is minute-cadence and test/throttled time only delivers
tick-cadence pumps); (c) an arcScenario-style **live-map** keystone: N employed people on a real map reach
work and fire `started_working` ≥ X% of workdays under both real-time and throttled time.

### P0-4 · `movedOut` is orphaned — adult children never leave home in live play (task 122)

**[static, confirmed live]** Exactly as [task 122](../tasks/122-live-moved-out-signal-orphan.md) describes:
no manifest event emits `movedOut` or reads `canMoveOut`; `City.resolveMoveOut` is dead code; 16 observed
days produced zero move-out machinery activity (statistically weak alone, but the static case is absolute).
**Fixing 122 is part of this effort** — it is precisely a live-sim behavior gap (households only shrink via
death/eviction now), and its requirement #3 (a CI guard that every consumed signal is emitted by some event)
is the class of guard several findings below also want. Fold it into LP-6.

### P0-5 · The `T` time-throttle desyncs movement from time — the shipped observation instrument distorts the sim

**[static, mechanism verified live]** `GameManager.advanceTime` scales the clock by `timeScale`, but
`Field.update` moves people and vehicles by the **raw** frame delta. At 4×/16×, everyone moves 4×/16×
*slower relative to sim time*: commutes eat multiples of their in-game duration, school windows close before
children arrive, chases/dispatch/collection degrade — the exact loops the throttle exists to observe. The
117 balancing session's planned instrument would have systematically misreported the sim it was built to
watch. *Fix is small:* scale the movement delta by the same factor (or emit proportionally more update
time), and add a movement-vs-clock consistency assertion to the integration suite.

---

## Part 2 — P1: systemic gaps (the "aliveness 2" substance)

### P1-1 · Needs have no consequences — starvation is a mood-free lifestyle

`Needs` feeds selection multipliers and the critical-intent hook, and **nothing else**. `Mood.ts` never
reads needs (grep: zero references); health never drifts from them; hygiene at 0 changes no one's reaction;
`purpose` at 0 depresses nobody. The A1 design table in the aliveness proposal explicitly promised
"starved consequence: mood ↓, health drift ↓ / social weight ↓" — the wiring was never built. This is why
P0-2 could go unnoticed: the sim has no way to *scream*. **Direction:** closed-form need→mood pressure (a
sustained-low-need term in the mood baseline), a health drift for food/rest floors, wired
`went_hungry`/`exhausted` events (limit-gated) for the log/feed, and a hygiene factor in consent/social
targeting — all K2-stride-tolerant.

### P1-2 · Garbage (and services generally) still lack the promised consequences

The user's canonical example holds: **accumulated garbage causes nothing** — no illness factor, no mood
factor, no vermin, not even the location-mood dampener H3 promised. `fell_ill`'s hazard factors are age
only; the coverage ledger computes garbage coverage and the only consumers of *any* coverage are healthcare
(`recovered`, `lifted_spirits`), police (crime/resolution), fire (response), jail (capacity), school
(seats). **Direction:** a per-location squalor reading (curb bags + litter within radius) factored into
`fell_ill` (the epidemiology the brief asks for), into location mood, and into `cleaning` selection weights;
sanitation coverage as a factor on the squalor decay rate. Same pattern healthcare already proves.

### P1-3 · No gestation — pregnancy is an instant baby, and the texture contradicts it

**[static]** The vital `pregnancy` event's effect list is `birth` — conception and delivery in the same
hour. The `pregnant` context attribute is declared in the compiler's closed vocabulary and **nothing sets or
reads it** (dead vocabulary). Meanwhile the texture double `became_pregnant` still free-rolls independently
(`perYear: 0.8`, the 117 notes flagged it, unfixed), and `had_miscarriage` gates on `hasEvent:
became_pregnant` — **miscarriages chain off the fake pregnancy, not the real one**. A family-simulation
flagship where birth announcements are the first anyone hears of a pregnancy. **Direction:** make
`pregnancy` set `pregnant=true` + schedule `birth` via the automated queue (~9 in-game months), gate
behavior lightly on it (work fitness late-term, texture events *for* it), wire `became_pregnant` as the C2
counterpart of the real commit, re-chain `had_miscarriage` (clearing the scheduled birth — the Consequences
DSL already schedules/triggers), and fire `gave_birth`/`became_parent` milestones off delivery.

### P1-4 · The texture corpus still free-rolls against ground truth — pass P2 was only half-executed

521 of 738 events remain probabilistic-and-effect-free, and the incoherence class the aliveness proposal's
P2 promised to gate is very visible in a 16-day window. Observed/verified examples:

- **Work-named events with no `employed` gate** [static]: `worked_overtime`, `late_for_work`, `made_work_friend`,
  `injured_at_work`, `quit_job`, and a texture `got_job` that free-rolls beside the vital `get_job` — all
  eligible for unemployed 16-year-olds.
- **`spread_rumor` free-rolls beside the real gossip system** [live]: the log shows both the wired
  `shared_gossip` (63 paired both-sides commits — the real system, working beautifully) and random
  `spread_rumor` textures narrating gossip that never happened.
- **`had_nightmare` at 19:00 while awake** [live]; no sleep-state gate.
- **Medical texture without the health system**: `had_surgery` (×4 in 16 days, town of 32 — while lounging
  at home), `got_dental_filling`, `caught_cold` beside the real illness chain.
- **`adopted_child`** free-rolls with zero effects — an adoption that never produces a child (contrast:
  pets got this right — `adopted_dog` is manual-only, fired by the real registry).
- **Grandparent texture** (`spoiled_grandkids`, `taught_grandchild_to_fish`) gates on age ≥ 60 only, not on
  having grandchildren.
- **Aggregate rate noise** [live]: one person accrued concussion + allergic reaction + fainting + nightmare
  in 6 days; `won_chili_cookoff` hit 5 times in 16 days town-wide. ~520 texture events at ~0.3–0.8/yr each
  compound to a quirk *every couple of days per person* — the "life as a string of accidents" feel.

**Direction:** finish P2 properly as a data pass with generated-doc enforcement: every texture event gets
(a) the missing state gates (`employed`, partner, sleep-hour, pet, grandchild-existence where computable),
(b) demotion to manual+wired where a real system now produces the fact (`spread_rumor`, `became_pregnant`,
`got_job`, medical texture keyed to real illness), (c) a global rate-budget review (target: ~1 quirk/person
per 1–2 weeks, not per 2 days), (d) the `quirk: true` decision-record marker for the deliberately absurd.

### P1-5 · Money micro-flows are unbounded and desynced from the monthly economy

**[live]** Personal balances went **negative** (−8 → −32 and drifting) via `purchaseObject` micro-purchases
— no floor, no solvency gate in the purchase path (the events-side `adjustMoney` respects gates; retail
does not). Separately, a person burned $2000 → $0 within days in the first session. With wages monthly and
micro-spending hourly, the intramonth cash dynamic is unmodeled: people spend continuously and are paid 30
days later; day-1 towns are all-broke before their first payday, which will misfire every `money`-gated
selection predicate and (once P1-1 lands) desperation gates. **Direction:** floor retail purchases at
solvency (typed failure otherwise — being too broke to buy IS story), and either weekly pay or a
seeded month-one buffer keyed to cost-of-living, so the money texture matches the economy's cadence.

### P1-6 · The asset-carried social graph arrives skewed — rivals everywhere, polyamory by default

**[live, needs generator-side verification]** The 32 drawn residents arrived with edges (to on- and off-map
people) of: **224 rival**, 235 acquaintance, **149 dating**, 19 friend, 12 close_friend, 12 ex_partner, 2
engaged. Rivalry outnumbers friendship 10:1; the mean person "dates" ~4.7 people; friendships are nearly
absent. Whatever the deep sim's hostility/decay balance is doing, drawn people start their live lives with a
social fabric that reads antagonistic and romantically incoherent — consent, targeting, and the romance arc
all price off these kinds. Related: asset people carry ~80–107 possessions each (the F1 carry-cap
demotion evidently does not bind in the generator's acquisition paths). **Direction:** a decode-based audit
of the generator's edge dynamics (friend-formation vs rival-formation rates, dating-edge cleanup on
partnership/marriage/breakup), plus a carry-budget sweep at retention time.

### P1-7 · Dependent care doesn't exist — children starve independently

**[live]** The starving-town cohort included 13- and 14-year-olds at food ≤ 8. There is no feeding-your-
children loop: no parent-cooks-for-household satisfaction fan-out, no child-eats-what's-home behavior, and
school lunches don't exist. Once P0-2 makes food real, children of employed parents will still starve —
minors can't shop. (The generator hides this: everyone conjures.) **Direction:** household-meal semantics —
the cook's `shared_a_meal`/family-dinner children satisfy co-located household members' `food` (the D3
joint-plan machinery or a simple household fan-out), and a parental-care routine anchors it.

### P1-8 · Miscellaneous coherence [live]

- **Hiring at 03:00**: `get_job` has no hour-of-day factor; the feed announces night hires constantly.
- **`receiving_treatment` re-seek guard** (117's #1 flag) remains unimplemented — 4-tick sessions,
  re-proposed immediately; a sick person with a hospital camps there. (`Treatment.ts` still only checks
  "not currently running".)
- **`spending_time_at_home` has an always-true modifier**: `health < 40` on a 0–1 health scale (should be
  `0.4`) — every person carries a permanent ×1.5, which alone plausibly explains 117's "leads the fallback
  ~2×" flag. One-character fix, worth its own regression test.
- The engaged-couples → `marriage` pipeline is correctly wired (bind `engagedOf`, romance-arc gates all
  present [static]) — no marriage landed in 16 days, statistically unremarkable, but worth a longer-horizon
  scenario test asserting the pipeline completes at expected rates in live mode.

---

## Part 3 — P2: legibility, boot & tooling

1. **Activity bubbles never label travel** — the label requires a `running` instance, but a traveling
   person's instance is `waiting_for_materialization`; the street's dominant visible state (going somewhere)
   is unnarrated. Show destination-flavored labels ("→ work", "→ the supermarket") for pending transitions.
   (The bubbles that DO render are great — "Out looking for work" over a job-seeking crowd was the single
   most alive-feeling moment of the session.)
2. **The family-tree window is an unreadable hairball** at asset-genealogy density (force layout, hundreds
   of nodes, all labels overlapping). Needs a generational layout / depth cap / focus person.
3. **The skills panel is a wall of 70 numeric rows**; group by domain, collapse the 60.0 school basics.
4. **Construction menu has no School** (nor any way to answer the education nag deliberately) — the nagbar
   scolds about school seats while the menu can only gamble on generic Business lots. Either add school (and
   arguably clinic) to the menu or make the nag name the actual lever.
5. **Double boot**: `City created` / `Scene intialized.` / harness install each fire **twice** per boot —
   two full world selections run (the second silently replaces the first's bus registrations). Wasteful
   (asset decode ×2 at boot) and a determinism hazard (city name differed across identical-seed runs during
   the session). Also "intialized" is misspelled, which makes it easy to grep.
6. **Boot latency variance**: identical asset boots measured at ~8s and ~73s+ (dev server). Worth
   instrumenting the selection path; also the decode work happens on the main thread with no loading UI.
7. **Hidden-tab freeze**: Phaser's RAF halts in background tabs, so the sim (and even boot) fully stops —
   fine as a pause semantics decision, but it should be a *decision* (and the boot should not depend on
   visibility).
8. **Save-button UX**: the failed save (P0-1) shows no error toast — it fails only to console. Failure must
   surface.
9. **Test-harness keepers from this session** (uncommitted): `debug()`, `stepGame()` — plus this doc's
   method notes as the template for future observation sessions. Proposed: commit on a `task/` branch with
   the P0-5 throttle fix, since honest fast-forward is what every future balancing pass needs.

---

## Part 4 — What verifiably works in live play (so round 2 doesn't re-solve it)

- **Job seeking & employment flow (097)**: 0 → 24/26 employed inside a week, visible applications, street
  bubbles, feed announcements. The pacing brief is met.
- **Reciprocity & gossip (082/094/104)**: `shared_gossip`↔`heard_gossip` paired 63/63; hugs land
  `received_a_hug` counterparts; `witnessed_a_scene`, `action_declined` (consent) all present live.
- **School (058/063)**: enrollment sweep + `attend_school` + `completed_school_day` work when children can
  physically arrive (they walk; they completed school days in the honest-movement runs).
- **Garbage production side (112)**: bags fill from real kitchen life and reach the curb on the
  `trash_day` routine. (Only collection is dead — P0-3.)
- **Services ledger + nagbar + feed (096/114)**: accurate, prompt, dismissable; coverage correctly reads
  providers-not-buildings (an unstaffed fire station warns honestly).
- **Construction menu & civic pinning (108)**: pinned blueprints instantiate exactly; civic fencing holds
  in the generic draws observed.
- **Inspector (081)**: the "Now:" line, needs bars, mood, trait prose, day strip — all live and correct.
- **Determinism**: identical seeds reproduced identical event streams across reboots (same texture events,
  same ticks) — with the P2-5 double-boot as the one observed wobble.

---

## Part 5 — Proposed arc: tasks 123–135 (sketch)

Dependency-ordered; sizes in the 080-arc convention. **122 folds in as the first item of LP-6.**

| # | Task | Contents | Size |
|---|---|---|---|
| **LP-1 (123)** | Save & log lifecycle | P0-1: live-era-only log serialization, hydration floor seq, save-failure toast; memory/scan relief. | M |
| **LP-2 (124)** | Observation truth kit | P0-5 throttle movement scaling; blocked/transition-failure lifecycle logging (P0-3a); commit `debug()`/`stepGame`; P2-1 travel labels; P2-5 double-boot; save-fail surfacing. | M |
| **LP-3 (125)** | Live work reliability | P0-3: commute/transition tracing + fixes; the live-map started_working keystone test; the doctor-case regression. Depends on LP-2's logging. | L |
| **LP-4 (126)** | Food & goods, for real | P0-2: pantry/stock seeding, grocery restock OAR tied to the abstract economy, honest wrapper `satisfies`, P1-5 purchase solvency floor; live end-to-end: fresh town, everyone fed by week 2 without conjuring. | L |
| **LP-5 (127)** | Needs with teeth + dependents | P1-1 need→mood/health wiring + starvation events; P1-7 household meals/parental care; P1-8 treatment guard + the `health<40` typo (ship these two immediately, they're one-liners). | M–L |
| **LP-6 (128)** | Family lifecycle truth | Task 122 (movedOut producer + signal-coverage CI guard); P1-3 gestation (pregnant state, scheduled birth, miscarriage re-chain, milestones); marriage-rate live scenario. | M–L |
| **LP-7 (129)** | Texture coherence pass 2 | P1-4 across the 521 free-rollers: gates, demote-and-wire, rate budget, `quirk` markers; P1-8 hiring hours; generated-doc enforcement columns. | L (data) |
| **LP-8 (130)** | Squalor & epidemiology | P1-2: location squalor reading → illness factor, location mood, cleaning weights; sanitation coverage factor. The user's founding example, closed. | M |
| **LP-9 (131)** | Asset social & possessions rebalance | P1-6: generator edge-dynamics audit + rival/dating rebalance, dating-edge lifecycle cleanup, retention carry budget; regeneration + decode re-pins. | M–L |
| **LP-10** | Legibility polish | P2-2/3/4 (family tree, skills grouping, school in menu). Anytime. | S–M |
| **LP-11 (132)** | The intra-tick cadence rework (M1) | Minute-materialized commits: plan at the flip, execute across the hour with jittered offsets; `minute` on log entries; live-only materialization, boundary-equivalent in bootstrap. The architectural centerpiece of round 2. | L–XL |
| **LP-12 (133)** | Reactive Brain wakeups (M2) | The `BrainWake` queue: world mutations re-evaluate affected people at the next minute, bypassing routine cooldowns; kills "the town ignores the new business until the next hour (or day)". | M |
| **LP-13 (134)** | Employment physicalized (M3) | job_hunting as a business-to-business visit sequence; applications located and employer-bound; `get_job` invoked at the counter (probabilistic trigger kept for the generator); the end of Idle. | M–L |
| **LP-14 (135)** | Entity-linked logs (M5) | Label templates over typed entity params — "Hugged **Ana Souza**", clickable; person/object/business/skill/job resolution at render; the full param-coverage data pass + validators. A phase of its own. | L |

The keystone for the whole arc mirrors 106/117 but runs **on the map**: a scripted live scenario (the LP-2
kit makes it cheap) asserting — everyone eats, everyone with a job works most workdays, garbage cycles,
the sick get treated, a pregnancy takes months, an adult child eventually moves out, and a week of one
person's log reads as a life rather than a string of accidents.

---

## Part 6 — Maintainer observations (M1–M4): validation & the cadence rework

Four observations from the maintainer's own session, validated against the source, with solutions — two of
them (M1/M2) are architectural and deliberately allowed to be sweeping.

### M1 · "Brains are completely synced to ticks — people stand still between full hours" → the intra-tick cadence rework (LP-11)

**Validation: correct, fully.** Nothing in the action layer subscribes to `timeChanged` (grep: zero
handlers in `game/actions/`); Brain decisions, continuous-action advancement, pool-child rolls, and ALL
commits happen inside the hourly tick spine, and log entries carry `tick` only — there is no minute
anywhere in the simulation's data model. Between flips, the only live motion is travel (`Field.update`).
The observed pattern — everyone acts in a burst at :00, then the town freezes for a real-time hour (2.5
min at 1×) — is structural, and it also produces the ":00 pulse": every commute/departure in town starts
at the same instant.

**The assumption about child actions is also correct as a design reading**: a continuous action's pool
children are rolled per tick and committed **all at the flip, same seq run** — four discretes inside an
hour of `cooking_meal` land as four log lines at the same hour. Nothing ever intended to spread them, but
nothing forbids it either, and the spread is exactly what the design *should* have said.

**Proposed architecture — plan at the flip, materialize across the hour:**

1. **The tick flip stays the sole decision boundary.** Brain arbitration, eligibility, hazards, child pool
   rolls, ordering, and the *content* of every commit are resolved at the flip exactly as today — same RNG
   streams, same seq order, byte-identical decisions. Determinism and the 078/079 perf discipline are
   untouched because no *decision* ever runs more often.
2. **Each planned occurrence gets a deterministic minute offset**: this tick's N commits are spaced evenly
   across the 60 minutes, each jittered ±20% of its slot (seeded fork: worldSeed → tick → person →
   `CADENCE_SALT`). The offset becomes a new `minute` field on the log entry (additive; save-format
   friendly; the inspector and day-strip get sub-hour texture for free).
3. **Live mode materializes on the minute cadence** (`timeChanged` already fires per in-game minute): the
   commit's log append, consequences, counterpart events, bubbles, and travel departures happen at the
   scheduled minute. **Invariant: every commit of tick T materializes before flip T+1, and no decision path
   reads state between flips** — so the state at every tick boundary is identical to today's
   all-at-the-flip semantics. A late-minute commit whose inputs were consumed by an earlier-minute commit
   re-validates at application exactly as intra-tick ordering conflicts do today (two-phase atomic, typed
   failure — no new failure class).
4. **Bootstrap/generator materialize everything at the flip**, as today — the boundary-equivalence
   invariant is the seam, and `arcScenarios` extends to assert it (live-with-minutes vs bootstrap state
   identical at every tick boundary). The generator still *computes and logs* the minute offsets, so asset
   histories gain sub-hour texture at zero stride cost.
5. **Departures spread too**: a commute or venue walk planned at the flip starts at its scheduled minute,
   not at :00 — the whole-town synchronized pulse dissolves into a street that has someone on it at any
   given moment. (Combined with P2-1's travel labels, this is most of the visible-aliveness win.)
6. Save/load: the intra-hour schedule is transient; loading mid-hour materializes the remainder at the
   next flip (documented, cheap). No migration beyond the additive `minute` field.

Sizing L–XL; it touches ActionEngine commit application, EventEngine invoke-on-commit, LiveWorld, and the
log schema — but *not* decision logic, which is what makes it tractable. It should land **after** LP-2
(the tooling that can see it) and ideally before the content-heavy passes, since every later observation
benefits.

### M2 · "Placing a Business only matters next tick — the Brain must also be event-driven" → reactive wakeups (LP-12)

**Validation: correct, and it's worse than one tick.** Brain hooks are `onTick` / `onEventCommitted` /
`onActionFailed` — no world-change inputs exist. And the observed non-reaction to new businesses is
amplified by data: `job_hunting` carries `cooldownTicks: 24` and rides a `cadenceDays: 2` routine — a
person who seeked this morning may not reconsider for **two days** after the player places the town's
first employer.

**Proposal — the `BrainWake` queue:** world mutations enqueue wake records — `workplaceBuilt` /
`businessOpened(blueprint)` / bulldoze / bankruptcy / venue opened-closed / `servicesChanged` / fire
ignition — each with a scope (`unemployed-adults`, `residents-of <key>`, `everyone-within R`, explicit
ids). On the **next minute boundary**, City drains the queue and runs a bounded Brain pass for the woken
people only, with the current tick's deps and a dedicated salted stream (`WAKE_SALT`) so the tick streams
are unperturbed. Two rules give it teeth:

- **Wakes bypass the matching cooldown class** — a `businessOpened` wake clears job-seeking
  cooldown/routine recency for the woken, so the re-evaluation can actually choose the thing that changed
  (data: wake kinds declare which action/routine cooldowns they clear, in `json/arbitration.json`'s
  vocabulary).
- **Determinism story:** player placements are already non-deterministic inputs to the sim; a wake pass is
  deterministic *given* the placement (seeded per tick+minute+person). Bootstrap and the generator simply
  never enqueue (no player) — no equivalence break, because wakes are an input channel, not a mode branch.
  `LogicalWorld` MAY later reuse the queue for its own placement analogues if the generator ever wants it.

This is also the natural home for future mid-tick reactivity (fire ignition already wants it — today the
evacuation hook waits for the flip too, up to an in-game hour of standing in a burning building).

**The wake-trigger catalogue.** The queue is only as alive as its producers. Two mechanical notes first:
(a) Brain already dispatches `onEventCommitted` same-tick to role-bound participants (the C3 reaction
machinery) — so *target-side* reactions (thanks for the gift, the retort to the argument) are NOT the gap;
the gap is every **hook-based responder** (`treatment`, `pursuit`, `fireResponse`, the orchestrator's
fitness gate) that only evaluates `onTick`, plus the sweeps that run **daily** (police case resolution,
school enrollment). (b) Under LP-11, an event materializing at minute 12 would otherwise wait 48 minutes
for anyone to notice — wakes are what make minute-materialization *reactive* rather than just cosmetic.
The catalogue, by producer class (each entry: trigger → scope → what the woken evaluation should reach
for; wakes clear the matching cooldown class):

*Person-state commits (subject wakes):*

- `fell_ill` / `injury` → subject: stop the running work instance NOW (the orchestrator fitness gate,
  today next-flip), then severity-routed care — health exists in coarse severity today (`injury` 0.3 <
  `fell_ill` 0.5) and the treatment hook already urgency-scales on it, so the severe go to the hospital
  and the mild go to bed with no new machinery.
- `recovered` → subject: resume paused agenda / return to a still-open shift mid-day.
- `layoff` / business closure → subject: leave the premises, job-seeking wake (cooldowns cleared),
  money-anxiety re-plan.
- `get_job` → subject: if hired mid-shift-window (LP-13's at-the-counter hire), start the first shift now,
  not tomorrow.
- eviction / `became_homeless` → whole household: shelter-seeking (relatives first) immediately, not on
  the next relocation sweep.
- `was_arrested` / `released_from_jail` → subject (+ household): agenda suspension/resume at the minute.
- consent decline, `argument`, `snapped_at_someone` → both parties: walk-away / leave-the-room re-plan
  (today the scene continues cohabiting the building for the rest of the hour).
- theft *noticed* (stolen-flag item missed, with F4/G4) → victim: report — creates the incident that wakes
  the police chain below.
- `depressive_episode` → subject: withdrawal re-plan (collapse social/fun weights take effect now).
- labor onset (with LP-6's real gestation) → subject + partner: the hospital rush is the canonical
  emergency wake.

*Kinship & social fan-out (others wake about you):*

- a death → spouse/parents/children/close friends: **interrupt whatever they are doing** (survival-band
  exempt), gather at home, condolence-visit planning over the following days; employer notified (absence
  without the layoff hazard). Today grief lands as a mood impulse but nobody's *day* changes until the
  next flip — this is the user-named case and the model for all of these.
- `fell_ill` (severe) → close kin: care/sick-visit wake (the 111 planner visit, immediately instead of on
  the next planner pass).
- `birth` → father/grandparents/siblings: meet-the-baby visits; `relative_arrested` → family (the 109
  fan-out, now with a behavioral wake, not just valence).
- engagement/marriage → both households: cohabitation planning now; celebration texture.
- divorce/breakup → both parties: re-plan (one of them wants the LP-6 move-out path).
- a close friend's edge demotion/decay crossing (closed-form → computable crossing time): a "we haven't
  talked in forever" visit impulse — cheap because the crossing minute is analytic, like needs below.

*City services & role-based responders (on-duty wakes):*

- `crimeCommitted` (witnessed) → every on-duty officer: dispatch at the minute (today: next flip for the
  hook, next **day** for sweep resolution — the user-named case); the same wake re-arms pursuit if the
  suspect is co-located.
- fire ignition → occupants (evacuation, survival band) + on-duty firefighters (dispatch) + neighbors
  (spectate/report texture): today all wait for the flip inside a burning building.
- a patient entering `receiving_treatment` → co-located on-duty doctor: treat now (rounds are currently a
  per-tick scan).
- a suspect sighting / wanted person entering an officer's building → officer wake.
- jail intake/release → corrections staffing (with G5 texture); curb-bag threshold crossed at a depot's
  route → collectors' next rounds re-prioritize.

*World & economy mutations (the LP-12 core set, expanded):*

- `workplaceBuilt`/`businessOpened` → unemployed adults (job seeking, cooldowns cleared) **and** — by
  venue kind — need-starved households (the first supermarket wakes every empty pantry; the first
  restaurant wakes the hungry-with-money).
- bankruptcy/closure → employees (mid-shift: go home via a real transition, not a snap) + regular
  customers (re-plan errands).
- bulldozed house → residents: rehousing wake; bulldozed workplace → as closure.
- school placed/staffed → guardians of unenrolled children: enrollment wake (the sweep is daily today).
- `servicesChanged` upward (first hospital staffed) → currently-sick people: seek treatment now.
- a house becoming vacant (move-out, death, new placement) → homeless registry + `canMoveOut` adults (the
  LP-6 producer gets an event channel, not just a hazard).
- first stock landing on a shelf (with LP-4's restock) → hungry/shopping-list holders nearby.
- road network changes → in-flight travelers re-path (staleness today is unmeasured; at minimum a re-plan
  wake for anyone whose current path crosses the edit).
- pet lost/returned (103 texture) → owner search/reunion behavior.

*Internal threshold crossings (self-wakes, analytically scheduled):*

- **needs are closed-form, so critical-crossing times are computable at the flip** — schedule the wake for
  the exact minute `food` crosses critical instead of discovering it an hour late. This is the elegant
  payoff of the K2 stride-tolerance rule and should be the reference implementation of a self-wake.
- mood crossing the depression band, money crossing broke (after an LP-11 minute-materialized purchase),
  a habit crossing its escalation rung — same pattern, same closed-form argument.

Scoping rule so this stays cheap: every wake names an explicit, bounded scope (ids, household, on-duty
role, need-below-X filter) — never "everyone" without a radius — and the drain is budgeted per minute
(spillover rolls to the next minute deterministically). Validator: every wake kind declares its scope
class and cleared-cooldown class; a generated `docs/generated/wake-triggers.md` table (the 054 pattern)
keeps the catalogue enforced rather than aspirational.

### M3 · "Job seeking should be walking business to business; hired on arrival; Idle shouldn't exist" → LP-13

**Validation: half-built.** `job_hunting` IS a continuous ambulatory action (stroll, outside, business-hour
modifiers ×2, broke-modifier ×2.5, proposed by the `job_seeking` routine for every unemployed adult —
**not** gated on openings existing, so the "only seek when jobs exist" half of the worry is already fine).
But it is a *generic stroll*: `applied_for_a_job` is an abstract discrete committed mid-walk anywhere,
bound to no business; `get_job` remains a free-floating probabilistic roll (rate-boosted by the
`jobApplications` attribute) that can land at 03:00 with nobody anywhere near a workplace (P1-8).

**Proposal:** upgrade `job_hunting` from stroll to **rounds** — a sequence over up to N candidate
businesses (deterministic: openings-weighted, then nearest-first; falls back to *any* businesses when no
openings exist, because asking around at a full shop is what job seeking looks like), each step a located
visit (the 072/085 `location: building:<key>` machinery, nothing new) whose `applied_for_a_job` /
`asked_about_openings` child binds `employer: <key>` **at the door**. `get_job` gains a **manual channel
invoked from the application commit**: when JobMarket scores a reachable slot at *that* business, the hire
lands there and then — at the counter, during business hours, with the employer causation-chained (this
retires the 3 AM hires without any hour factor). The probabilistic trigger stays as the off-map/generator
channel (the logical world has no doors to walk to), demoted to a low background rate live. **On "Idle
shouldn't be a thing":** agreed as a product rule — the fallback band must always produce a *named* action
(people-watching, window-shopping, lingering on the porch — the E2 outdoor set covers it); "Idle" as a
visible state gets abolished, and the travel label work (P2-1) covers the in-between. Depends on LP-3
(physical seeking multiplies transition traffic, so reliability lands first) and pairs with M2 (a
`businessOpened` wake proposes exactly this action).

### M4 · "People leave the house, walk to the car, come back, go idle" → covered, three ways

**Validation: matches the session's forensics.** This is the visible face of P0-3's silent transition
deaths: an intent starts, LiveWorld begins the commute, something cancels or blocks the instance
mid-flight (unlogged — the log shows nothing), the person snaps back to the fallback. The fix is spread
across items already in the arc, plus M1/M2:

- **LP-2** makes every blocked/cancelled transition a typed, causation-chained log entry — the loop becomes
  diagnosable the day that lands (and the aborted-walk person becomes inspectable: "Heading to work —
  cancelled: shift ended en route").
- **LP-3** fixes the underlying commute/transition reliability (the doctor case).
- **LP-12 (M2)** fixes the "didn't react to new businesses" half; **LP-11 (M1)** dissolves the :00
  all-town pulse that makes these aborted departures so visible (everyone stepping out in sync), and the
  L6 decision cooldown already in `arbitration.json` gets a re-tune so a freshly-started travel isn't
  re-arbitrated into oblivion one tick later.
- The residual product rule lands in **LP-13**: no visible Idle, ever.

### M5 · "Don't log 'hugged someone' — log 'hugged *Ana Souza*', clickable" → entity-linked logs (LP-14, a phase of its own)

**Validation: the substrate is half-built, the surface is absent.** Log entries already carry typed entity
params where the aliveness arcs wired them — the session's live logs show `hugged_person {target: p37}`,
`shared_gossip {target: p493}`, `visiting_the_sick {target: p383}`, `use_object {object: 'cream_jar'}`,
counterparts carry `{from: $actor}` / `{with: …}` — the C1/067 machinery did its job. But the presentation
layer throws it away: labels are static manifest strings; `PersonDetails` renders event params as a raw
`[with: p488]` suffix and **action params not at all** (the person-targeted repertoire — where most of the
social ids live — displays as "Hugged a person"); nothing is clickable; and coverage is partial (most of
the texture corpus, and many wired events, name no entities in their params even when they semantically
have one). Three layers of work:

1. **Label templates (schema + engine, S–M).** Labels gain placeholder syntax — `"label": "Hugged
   {target}"`, `"Bought {object} at {business}"`, `"Promoted to {rank} at {business}"` — resolved at
   **render time**, never baked into the log (the log stays ids-only, which keeps it compact, survives the
   asset re-identification that re-rolls names, and lets a name render with the family-tree's † once its
   bearer dies). One resolver service maps id → display: person (genealogy pool — works for off-map and
   deceased referents too, since the pool holds everyone), object archetype → label, business key → name,
   job/rank key → title, skill id → label. Fallback for an unresolvable ref: today's generic label —
   never a raw id.
2. **Clickable references (HUD, M).** Rendered entity chips dispatch through the existing selection
   events: person → `PersonSelected` (works for any pool person — the inspector already handles off-map
   people via the resident-list path), business → `WorkplaceSelected`, house → `HouseSelected`; objects
   and skills get tooltips (archetype details / proficiency) until they earn inspectors. Applies to the
   **person log, the day-strip hover, the feed** (feed items gain the same chips — "**Marcos Barros**
   started a new job at **Padaria Central**"), and the activity bubbles where a target is present
   ("Arguing with **Bruno**").
3. **The param-coverage data pass (L, the bulk).** Audit all ~310 actions and ~738 events: every entry
   whose semantics name a person, object, business, job, skill, or place must (a) declare the param, (b)
   have its producers actually bind it (the engine already supports `$params`/`$actor`/payload mapping —
   this is authoring, not new machinery), and (c) carry a template referencing it. Validators enforce all
   three (a template placeholder with no declared param is an authoring error; an entity-typed param with
   no template placeholder is a warning), and a generated `docs/generated/log-references.md` coverage
   table (054 pattern) diff-gates the pass. This overlaps deliberately with LP-7's texture sweep — the
   same person is touching the same 700 entries; run them as one combined content phase with two
   deliverables.

Sequencing: the engine/HUD layers (1–2) are independent and can land early — they instantly upgrade every
already-wired social action (the hugs, gossip, lends, visits all carry targets TODAY and would become
named, clickable story overnight); the coverage pass (3) rides with LP-7. Together with LP-11's minute
texture this is what turns the inspector log from a telemetry dump into the serialized novel the project
premise promises.

---

## Part 7 — The LP-9 generator edge-dynamics decode audit (findings of record)

Decoded from the committed asset's `socialGraph.tbz` (28,642 edges at end-of-run, ~250 living):

| Kind | n | avg strength | avg days since touch |
|---|---|---|---|
| acquaintance | 23,903 | 4.8 | 82 |
| rival | 3,412 | 7.4 | 101 |
| dating | 1,172 | 47.1 | 18 |
| friend | 70 | 29.7 | 49 |
| close_friend | 39 | 76.6 | 23 |
| ex_partner | 42 | 37.0 | 96 |
| engaged | 4 | 85.0 | 12 |

Diagnoses and the fixes applied:

1. **Rivals outnumber friendships 49:1** because hostility was a one-shot mint: any negative delta driving
   a friendly edge to zero flipped it to a rival seeded at strength 15 — and the average acquaintance sits
   at 4.8, so a single argument with a near-stranger (delta −8) almost always minted a months-long feud,
   while friendship required accumulating to 30 through +0.5…+3 deltas against a 120-day half-life.
   *Fixes:* hostility seeds at 6 (a weak grudge that fades in ~9 months unless fed — feeding still heats
   it through the existing rival sign inversion), rival half-life 200 → 60 days (landed earlier),
   promoteAt 30 → 22 and 65 → 55, acquaintance half-life 120 → 150 days.
2. **~4.7 standing dating edges per living person** because a consented ask seeded a new romance and
   nothing ever closed the others. *Fixes:* weddings settle the couple's other romances (landed earlier),
   and dating is now EXCLUSIVE at formation — starting to date demotes both parties' other dating/engaged
   edges to ex_partner (the 090 arc is a ladder, not a web). Regression: `romanceArc.test.ts`.
3. **The 23.9k acquaintance carpet is healthy** — average 82 days since touch means those edges are
   actively maintained town texture (~96 weak ties per person over a century), not corpses. `pruneBelow`
   stays at 0.25; a raise to 2 was tried and reverted (it made small-delta edge formation impossible).

The before-numbers above are the pinned baseline for the post-regeneration re-measure.

---

## Appendix — repro notes

- Boot: `http://localhost:3000/?test=1&boot=asset&seed=20260717` (dev server; keep the tab visible).
- Town script + daily observer: see session transcript; everything drives through `window.__townbox`
  (`build`, `debug()`, `stepGame`) and `game.emit('tileClicked', {position, tool, blueprintKey, asset})`
  for pinned civic placement.
- Key numbers measured this session: save `RangeError` at day ~6 / 32 residents; 105,054-entry hydrated
  log; supermarket shelf = office props + 4 food items at day 10 staffed; 169 cookings → ~18 meals; food ≤ 15
  for ~16/32 people at day 10; `started_working` 7 vs `stopped_working` 40 over 16 days; curb bags 0 → 95
  monotonic; 15/34 instances `waiting_for_materialization`; asset edges 224 rival / 149 dating / 19 friend;
  balances to −32; `won_chili_cookoff` ×5, `tried_new_recipe` ×64 (town of 32, 16 days).
