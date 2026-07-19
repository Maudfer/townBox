# Simulation Aliveness 3 — the player-experience audit

**Status: v2 — the arc IS IMPLEMENTED** (branch `task/simulation-aliveness-3`, one PR: W0 → W8 → W9 →
W1 → W2 → W3 → W4 → W5 → W7 → W10 → W6 as sequential commits, with the asset regenerated on the arc's
engines — `HISTORY_GENERATOR_VERSION` 136.0). The engine narrative lives in `CLAUDE.md` §4.17; the
findings below are the arc's evidence base and the Appendix numbers its re-measure baseline.
**Originally: findings + proposed arc, v1.** This document is the deliverable of a full re-run of the
observation effort — the 117 session's promised "much more detail, in a real browser" pass — executed on
`main` *after* the aliveness-2 merge (PR #101, regenerated asset, `generatorVersion 121.0`). Three
instruments, cross-checked:

1. **Static sweep** — manifests, engine seams, and the aliveness-2 fix list re-verified on `main`.
2. **Asset decode** — `npm run decode-person` over the *regenerated* committed asset (p101, p400, p520,
   p700 + meta), including hot-band timeline slices.
3. **Live play, in a real Chrome tab** (the first-class citizen this round): two asset-booted worlds via
   the task-008 harness — a 13-house / 11-business / full-civic-set town of 30 observed for a **full
   in-game month** with per-day metrics, and a second minimal world used for **forced scenarios**
   (sick→hospital with a real doctor, a house fire, a crime→chase→arrest) with staffing forced through
   the debug seam.

The headline: **the machinery of both arcs genuinely works when its preconditions hold** — the hospital
loop runs end-to-end on the map, fires burn/displace/rehouse with honest narration, the justice chain
closes with scaled sentences and family fan-out, commutes and school and work-as-actions are real,
minute stamps land, the feed and nagbar tell the truth. And yet **the month-long town was a
chronic-famine, garbage-saturated, mood-collapsed place** — not because any single system is broken, but
because the *support structure around the loops* fails: the shop can't sell, the town can't staff its
services, and nobody can react to either. Round 3's theme is not "make systems feed each other"
(round 1) nor "make the map feed them" (round 2). It is: **make the town's steady state healthy, and its
failures answerable** — by the sim or by the player — plus a scene-coherence pass so the moments the
glue produces read as scenes.

Where a finding is static it is marked **[static]**, observed live **[live]**, decoded from the asset
**[asset]**.

---

## Part 1 — What verifiably works in live play now (don't re-solve it)

Confirmed in the browser this session, on `main`:

- **Employment flow (097/LP-13):** 13 hires by noon of day 1; applications at the door; hires at the
  counter during business hours; visible job seeking with street bubbles.
- **Work is real (LP-3):** `started_working` 13–21 per weekday sustained over a month (vs. 7 in 16 days
  in the aliveness-2 audit); weekends genuinely off (1–3 starts on Sat/Sun); people physically at their
  workplaces (11 co-located at 18:00 day 1).
- **The hospital loop (111), end-to-end on the map:** a forced `fell_seriously_ill` at 09:00 →
  the sick man interrupts what he was doing, departs `→ venue:hospital`, arrives, `receiving_treatment`
  starts, the on-duty doctor interrupts her rotation, `treating_patient` / `treated_a_patient` /
  `was_treated_by_doctor` all land with paired causation — within six in-game hours.
- **Fire (110/116):** a forced ignition renders real flame particles, resolves at coverage-0 baseline to
  a burned-down lot, both residents log `lost_home_to_fire`, the feed narrates ("The building burned to
  the ground", "The Macedo household is now homeless"), one resident is rehoused with kin.
- **Justice (109):** a reported crime with an on-duty officer → suspect flees (`fleeing_the_police`),
  `chase_concluded`, `arrested_suspect`/`was_arrested` counterparts, the ride, `got_caught`, family
  `relative_arrested` fan-out, case closed; first offense correctly lands a fine, not detention.
- **Needs → consequences (LP-5):** `went_hungry` (79 in 10 days), `utterly_exhausted`, squalor-fed
  `sick_of_the_filth`, and a town-wide **mood collapse to median 19** with a real
  `depressive_episode` ("Júlio Saraiva sank into a depression" in the feed) — the sim now *screams*
  when it starves, exactly as LP-5 intended.
- **School (058/063):** enrollment day 1, children walk, `completed_school_day` fires (with an
  attendance caveat, P3-9).
- **Gossip/reciprocity (082/094/104):** `shared_gossip`↔`heard_gossip` paired 29/29 live;
  hugs land `received_a_hug`; `witnessed_a_scene`; sick-visit pairs 5/5.
- **Minute cadence (LP-11):** log entries carry spread, jittered `minute` values; no :00 pulse in the
  logs.
- **Inspector & feed (081/LP-14):** the "Now:" line with location ("Working — Sterilizing equipment, at
  Braga S.A."), trait prose, needs/mood, Follow chip; feed chips and honest coverage warnings
  (a placed-but-unstaffed fire station correctly warns "no fire protection — coverage 0%").
- **Single boot:** the P2-5 double-boot is fixed (one `City created` per load).
- **The two-band asset (105) is real** [asset]: people alive in the final 10 recorded years carry true
  hourly texture (8h sleeps ×1171 for p700, hourly timelines); the regenerated social graph holds the
  LP-9 re-pins.

---

## Part 2 — P0: the town's steady state is broken (live breakers)

### P0-1 · The food chain is still dead at the shop counter — the basket bug

The single highest-impact defect found this session. A month of live play produced **zero
`bought_groceries` purchases after day 2** in a town with two staffed supermarkets, stocked shelves,
and ~$2,000 in every pocket. The town's median food level fell to 5–10 and stayed there; 10–20
`went_hungry`/day; mood collapsed town-wide; **cooking ran ~35×/day against ~4 `ate_a_meal`/day** —
the pantomime-cooking pattern from the aliveness-2 audit, still the town's #1 activity, now sustained
by the grazing credit alone.

Root cause chain [static+live]:

1. **`bought_groceries` is an all-or-nothing hardcoded basket** — its consequences are three
   `purchaseObject` ops (`flour_bag`, `tomato`, **`cream_jar`**). At a real shop (113: fallback
   retired), *any* missing archetype makes the whole plan unplannable → the child never commits.
2. **`cream_jar` is not in the `supermarket_restock` OAR outputs** (egg/bread/milk/tomato/lettuce/
   potato/onion/flour/butter/cheese only) and is not reliably seeded — so once absent, the basket is
   **permanently** unbuyable at that shop. `picked_up_fresh_ingredients` (potato+onion+lettuce+egg)
   has the same all-or-nothing shape and dies on `lettuce`.
3. **The failure is silent.** An unplannable pool child is filtered before rolling — no `failed` log
   entry, no typed reason, nothing in the inspector. Nineteen completed `shopping_trip`s produced
   gossip, `waited_in_line`… and no purchase, and the log says nothing about why. (LP-2 made
   *transition* failures loggable; consequence-plan failures inside pool children remain invisible.)
4. **Restock capacity is symbolic**: `restocking_shelves` ran 6 times in a month (one Checkout Clerk
   town-wide — see P0-3), producing ~11 `stocked_the_shelves` against ~30 residents × daily demand.
   Shelves seeded **one unit per staple** at placement and never recovered.
5. **There is no hunger→shopping producer.** The aliveness proposal's D2 promised "pantry below
   threshold → enqueue `shopping_trip`"; it was never built. Shopping is a 6-day routine plus a small
   free-time weight. A starving person with an empty pantry has a pantry-*fetch* intent
   (`Brain.ts` `pantryFetchBelowFood`) but no "go buy food" path at any urgency.
6. Meanwhile the *event* `went_grocery_shopping` fired 24 times narrating trips where nothing was
   bought — the log actively contradicts the shelf.

**Direction (bundle, the LP-4 completion):** (a) make purchase baskets per-item-optional or ordered
alternatives ("buy what's there" — the cooking-recipe-alternatives pattern, already proven in OAR);
(b) a validator: every `purchaseObject` query archetype must be produced by the hosting venue's
restock/seed set (the 113 coverage audit, extended to *sustainability*, not just presence);
(c) restock throughput scaled to demand (quantity × clerks on duty, under the 089 ceilings);
(d) log consequence-plan failures on pool children (typed, rate-limited — one `failed:
inputsUnavailable` per (person, action, day) is enough to make the inspector honest);
(e) the hunger→shopping planner producer, urgency-scaled; (f) fire `went_grocery_shopping` from a
commit that actually purchased, not from trip completion.

### P0-2 · The commute's visual layer lies: orphan cars, ghost sprites, incoherent travel windows

**[live]** After a month, the roads held **148 driverless "controlled" vehicles** (30 residents). The
street visually reads as a parking-lot apocalypse; a year of play projects ~1,700 sprites with
matching update-loop cost. The same defect family also explains the long-observed "car left behind
when someone entered a building" and "person sprite lingering outside a building they'd entered"
sightings. Four distinct mechanisms, three of them real bugs (the throttle only amplifies them):

1. **Mid-flight re-plan orphans the car** [static, reproduced live]. `City.startCommute`
   unconditionally spawns a new car per adult trip and `person.setVehicle` silently overwrites any
   existing link; cancelled transition handles never despawn either. The car is removed **only** in
   `TravelStep.Arrived` — so every trip interrupted or re-planned before arrival strands its car
   forever. Deterministic repro this session: catch a person at `driving`, issue a second
   `startCommute` → car count +1 permanently, and the orphan **retains its occupant flag** (the
   person was aboard when overwritten), so it reads as an occupied, controlled, driverless car for
   the rest of the session. Clean trips despawn correctly — which is exactly why the leak is
   "frequent but not always."
2. **The spawn/despawn sprite race mints ghost sprites** [static]. `Field.spawnVehicle` pushes the
   vehicle and fires `Game.emit('vehicleSpawned')` **without awaiting**; the sprite is attached by
   the async `drawVehicle` handler a microtask later. A removal in the same window
   (`removeVehicle` → `vehicle.getAsset()?.destroy()` with `getAsset() === null`) destroys nothing,
   and the sprite is created *afterwards* — a ghost car that is in no list and no sweep can find.
   The `personSpawned`/`removePerson` pair has the identical race (same-tick spawn+despawn: newborn
   reconciliation, bulldoze/teardown, load), explaining occasional lingering **person** sprites that
   no state mismatch accounts for.
3. **Travel-state incoherence windows around interruption** [static, reproduced live]. Nothing stops
   the travel machine when the driving intent dies: (a) a re-plan mid-drive forces
   `ExitingBuilding` while the person is still logically indoors-in-the-car — next frame the sprite
   **pops visible in the middle of the road** where the old car sat; (b) an interrupted walker's
   body **completes the stale trip** into the old destination (nothing cancels
   `destinationBuilding`), entering a building their current action has nothing to do with; (c) the
   window between those — a visible sprite standing at the curb by the door while the inspector
   already narrates the person's next (interior) activity — is precisely the "entered the building
   but the sprite lingers" sighting.
4. **Throttle/step compression is an amplifier, not the cause** [live]. At 4×/16× (or harness
   stepping) trips take longer relative to sim time, so more trips get interrupted mid-flight —
   more orphans, longer incoherence windows. But all three mechanisms exist at 1×; the month-run
   leaked ~4.6 cars/day.

**Direction:** see workstream **W8** (the sprite/travel truth pass): the vehicle lifecycle owned by
the transition handle (cancel/replan despawns; `setVehicle` refuses to overwrite a live link),
awaited (or synchronous) sprite attach on spawn, a travel-machine reset seam invoked when the
driving intent is interrupted (park-and-despawn or hand the stale trip a typed cancellation), an
orphan sweep as belt-and-suspenders, and standing sprite-vs-state invariant assertions.

### P0-3 · The service-labor system cannot staff a town — everyone becomes a Manager

**[live]** Of 24 employed adults at day 10: **14 Managers**, 5 Teachers, 2 Fitness Trainers, 1 Doctor,
1 Checkout Clerk, 1 Garbage Collector — and **0 of 12 sanitation positions, 0 firefighters, 0 police
officers** (in world 1). Consequences observed: garbage collection effectively never ran (curb bags
20 → 212, squalor saturated at 1.0), the nagbar scolded about fire protection **with a placed fire
station** the whole month, one supermarket had one clerk to restock for 30 people, and the town's one
doctor was a 21-year-old trainee.

Three stacked causes [static, mechanism confirmed live]:

1. **Manager magnetism.** `JobMarket.bestMatch` maximizes per-person skill fit; the manager job's
   requirements are generic enough that asset adults (60-basics baseline + assortment) fit it best
   nearly everywhere, and `Workplace.hire` takes the **first** open position whose requirements pass —
   Manager is first in every blueprint's expansion. Nothing prices in *role scarcity* (a business with
   3 managers and no front line outscores hiring its first clerk), *service criticality*, or wage
   attractiveness.
2. **No labor inflow.** The town saturated at ~24 employed by day 2 against ~180 open positions, and
   nothing brings new residents: no migration pressure, no "help wanted attracts a household draw"
   loop. City builders live on this loop; TownBox has no version of it. (Career retcons (098) shape
   *who arrives when a house is placed* — nothing arrives *because jobs exist*.)
3. **No job switching.** Once hired, a person re-enters the market only via layoff/quit events;
   an employed Manager will never take the vacant Garbage Collector slot no matter what the coverage
   ledger says (nor should they — but a *system* should notice the vacancy: wage premium, a
   civil-service draw at hydration, targeted migration).

**Direction:** this is the anchor workstream of round 3 (see Part 6, W1): scarcity/coverage-aware
hiring scores, a migration loop (unmet labor demand + housing vacancy → new household draws, the 055
asset machinery already supports arrivals), retcon-at-need extended to service roles, and optional
voluntary job-switching under wage/coverage pressure.

### P0-4 · Houses can draw empty, silently

**[live]** In world 2, three of six placed houses materialized **nobody** (occupiedHouses 3, houses 6)
— no feedback, no retry, just a dead building the player paid for and will never notice isn't a home.
Whether the window's unplaced-living pool was exhausted or the draw legitimately whiffed, the player
experience is a silent no-op. **Direction:** surface it (feed line + a "For sale" visual state) and
prefer immigrant-fallback draws over empty results when the pool thins (the fallback exists in
`HouseholdDraw` — it evidently doesn't always engage).

### P0-5 · One thrown window unmounts the whole HUD, permanently

**[live]** A malformed `PersonSelected` payload crashed `PersonDetails`, and React unmounted the
**entire HUD** — toolbar, clock, feed, all windows — for the rest of the session (no error boundary
anywhere in the tree; React's own console message says as much). The trigger here was harness misuse,
but any future window bug has the same blast radius in normal play. **Direction:** an error boundary
per window + one around the HUD shell; a crashed window becomes a closed window with a toast.

### P0-6 · Bulldozing desyncs sprite from logic — ghost buildings with dead insides

**[live, root-caused static]** Bulldozing "often" fails to remove the building sprite — and the
mechanism makes it worse than cosmetic. `Field.bulldoze` first runs the coherent logic teardown
(`demolishHouse`/`demolishWorkplace` — eviction, layoffs, both correct), then re-dispatches the event
as a **Soil build anchored at the clicked cell**. But buildings sit at fine-grained (soft-snapped)
anchors while the soil stamp goes wherever the click landed, and `stampFootprint`'s rule is that a
structure is only torn down "once none of its cells reference it anymore" — so any click that isn't
the building's exact anchor overwrites only part of the 3×3 footprint. Result: **the household or
business is destroyed, but the sprite and the surviving footprint cells remain** — a ghost building
that still hit-tests, still blocks placement, and lies to the player. The bulldoze *preview* is
likewise broken (the cursor-preview asset for Bulldoze is `null` in the toolbelt map) — the intended
preview (maintainer-stated) is the same **ghost-tile preview every other tool has, showing the grass
tile** over the footprint that would be cleared. The intended
semantics (maintainer-stated): **the bulldozer IS the grass tool** — remove the logic entities,
lay off / evict the occupants, physically eject them onto the connected street, and leave clean
grass. **Direction:** bulldoze must resolve the clicked cell to the occupying structure's **anchor**
and stamp soil over the structure's own footprint (all 9 cells), with a real preview; physical
ejection is P1-11/W9.

---

## Part 3 — P1: systemic gaps (the aliveness-3 substance)

### P1-1 · The town has venues people never go to — the "venue desert"

**[static, confirmed live]** Of 314 actions, **267 declare no location** and run wherever the person
already is; only **10 are venue-located**, mapping to just **7 venue kinds** (`bar`, `beach`,
`hospital`, `park`, `pet_shop`, `shop`, `supermarket`). Meanwhile the blueprint roster the economy
simulates — and the player can build — includes restaurant, café, bakery, cinema, gym, library,
church, salon, hotel, bookstore, sports complex… **none of which is a destination for any behavior.**
There is no eat-out action at all: `restaurant` demand is a monthly abstraction while the hungry town
walks past it. The observable result: street life is commute + job seeking + walks; the "downtown" is
a row of buildings whose only visitors are their own staff. This is the single biggest gap between
"the economy simulates leisure" and "people visibly live."

**Direction (W2):** a venue-repertoire content pass — map every consumer-facing blueprint to a venue
kind, give each 2–5 located continuous actions (dining out satisfying `food`+`social` and *charging
money* — the money sink live play currently lacks, see P1-8; cinema/gym/library/church each with a
small repertoire), wire them into needs/routines (date night at the restaurant rides the existing
joint-plan machinery), and add **opening hours** (P1-2).

### P1-2 · Nothing closes — 2 AM shopping trips and hires

**[live]** Shopping trips start at 02:00 (observed, repeatedly — the hour modifier only *weights*
business hours ×1.4). Venues have no open/closed state; a shop with no staff present sells (the
purchase path requires stock, not a clerk). LP-13 fixed 3 AM *hires*; the general form — venue
actions gated by the host business's staffed hours — was never built. **Direction:** an `openHours`
concept derived from the business's authored shifts (a venue is open while staff are on duty),
enforced as a hard gate in venue-action selection and in `LiveWorld.targetBuilding`; "found it
closed" is a loggable, story-bearing outcome.

### P1-3 · Scene coherence: the glue produces events, not scenes

The forced scenarios all *worked* and all read wrong in the details [live]:

- **The officer arrested the suspect mid-coffee-date, without interrupting the date.** His pursuit
  never displaced his leisure instance: `catching_up_over_coffee started → arrested_suspect →
  chatted_over_coffee → completed`. The arrest is a discrete that fires *through* whatever the
  officer was doing; only the suspect's side (fleeing) is a real interruption.
- **The suspect resumed her register shift within the hour of being chased, arrested, and fined** —
  then left mid-shift for coffee. No mood aftermath surfaced, no "shaken" state, no employer
  reaction, no gossip wave observed about it.
- **The doctor logs `stopped_working` when she switches to treating a patient** — a work→work
  interruption reads as clocking out (and plausibly costs her the day's skill progression, since the
  workday credit rides `stopped_working`'s per-day limit — worth a targeted test).
- **Sleep never completes**: every night ends `interrupted` (26 starts / 27 interrupted / 0 completed
  on day 1; the asset shows the same). Semantically the morning wake IS the natural end of sleep;
  logging it as an interruption makes every biography read as chronic sleep disruption and
  presumably double-charges the interruption machinery.

**Direction (W3):** an interruption-semantics pass — (a) distinguish `concluded` (natural end:
wake-up, shift-end reached) from `interrupted` (displaced by a higher band) in the lifecycle
vocabulary or at least in labels; (b) role-consistent scenes: an arrest/pursuit/treatment discrete
performed by X on Y must interrupt (or pause) X's unrelated continuous the same way it does Y's;
(c) aftermath texture: valence impulses exist — add short-lived post-incident state ("shaken",
"relieved") that gates the next few hours' selection, so a chase visibly *costs an afternoon*;
(d) work→work switches inside the same shift must not fire `stopped_working` (route through
pause/resume instead).

### P1-4 · Rehousing splits couples; the homeless haunt the supermarket

**[live]** After the fire, Sophia was rehoused with blood relatives; her partner Matheus — same
household, not kin — became homeless and spent the night "indoors" at the supermarket at 3 AM.
`findRelativeHouse` resolves per-member by kinship only; partners/households aren't kept together.
And homelessness has no behavior layer: the homeless person's day is ordinary free-time selection
from wherever he squats. **Direction:** household-unit rehousing (offer the *household* to a host,
capacity permitting, before splitting), and a minimal homeless repertoire (shelter-seeking at night,
the park/bench day texture that already exists, a feed-visible arc) — the machinery (registries,
located intents) all exists.

### P1-5 · Nobody retires, and a dying 75-year-old gets hired

**[live]** Murilo (75), freshly `fell_seriously_ill`, was out `job_hunting` and **got hired the same
morning** via the at-the-counter path. The `job_seeking` routine requires `age ≥ 18 && !employed` —
no upper gate, no `retired` check, no health check; JobMarket scores likewise. The `retirement`
event exists but its state evidently doesn't gate the seeking loop. **Direction:** gate the routine
and the market on `retired`/age curve/health; retirement should also *produce* a repertoire shift
(more park/grandkids/hobby weight — data-only once the gate exists).

### P1-6 · Pregnancy is still an island

**[static]** Gestation is real now (LP-6: `pregnant` state, scheduled birth +6480, miscarriage
re-chain) — but **conception is still a free-rolling hazard**: `had_sex` has zero effects, and
`pregnancy` rolls independently on married couples. The user's founding question — "do pregnancies
feel like they came out of the blue?" — is still *yes* at the moment of conception (the announcement
now foreshadows the birth, which is real progress). Marriage is likewise correctly gated on the
romance ladder (engagement bind verified [static]), but the wedding itself is a probabilistic hour
with no ceremony, guests, or venue — a line, not a scene. **Direction:** make `pregnancy`'s manual
channel the primary one, invoked (probabilistically) from `had_sex` commits of `wantsMoreChildren`
couples, with the background hazard demoted to the off-map channel (the LP-13 pattern, exactly);
give marriage a minimal ceremony scene (a planned joint event at a venue, guests via the invite
machinery, witnesses → gossip — every piece already exists).

### P1-7 · Squalor is invisible and unanswerable

**[live]** 212 curb bags = squalor 1.0, `sick_of_the_filth` firing — and the street renders
**identical to a clean one** (no object-layer rendering exists in `MainScene` at all; the 112
"visible pile-up" is visible only in logs). Worse, the player *cannot fix it*: the landfill stood
staffed-by-nobody all month (P0-3), and there's no other lever. **Direction:** render curb bags (a
tiny sprite per N bags at the curb tile — the fire-particle pattern), and let squalor feed a
cleaning-pressure loop residents can actually perform (the `cleaning_the_sidewalk` weight boost
exists; verify it binds and that residents can dent the pile without a depot, at worse rates).

### P1-8 · Live money has no sinks — and the first month is still weird

**[live]** With groceries broken, balances just accumulate (median ~$1,957 → max $7,966 after
payday); the only real outflows are cost-of-living and rare snacks. Once P0-1 lands, groceries help,
but the town still has almost nothing to *spend on* (no dining, no leisure fees, no goods people
want — P1-1 again, from the money side). A handful of balances also sat at **−8/−10**, so something
still leaks past the LP-4 solvency floor [live, small]. **Direction:** venue spending (W2) is the
sink; audit the remaining negative-balance path (likely a non-`purchaseObject` micro-flow).

### P1-9 · School attendance is ~55%

**[live]** 4 enrolled children × 8 weekdays ≈ 30 expected `completed_school_day`s; observed 17–18.
The misses correlate with the arrival-dependence caveat (movement compression), but the shipped `T`
throttle now scales movement (LP-2), so real-time play should do better — worth a live-map keystone
assertion (the LP-3 pattern: enrolled children complete ≥ X% of school days) before trusting it.

### P1-10 · Small-manifest oddities caught in passing

- `moved_out_of_parents` replays (8× in one asset life [asset]) — coherent-ish via jail/rehousing
  cycles, but reads absurd; consider once-per-household-formation semantics (or gate on currently
  living with parents — which `canMoveOut` may already imply; verify the generator honors it).
- The generic business draw gave a 30-person town a **cemetery** as one of four shops, plus duplicate
  supermarket/school while whole demand categories went unserved — the demand-weighted first draw
  (097) is category-blind to what's already placed [live].
- `had_nightmare`-class gates: mostly fixed by LP-7; not re-audited exhaustively this session.
- Consent-decline volume in the deep sim: lifetime ratios like 1,804 hugs landed vs 1,142 declined
  [asset] — a ~39% decline rate suggests target-selection still proposes intimacy far below the
  consent bar; cheap fix is pricing edge strength into the social hook's target choice more steeply
  (the declines are logged attempts, so they also bloat logs).

### P1-11 · Displacement is invisible — ejection, homelessness, and home seeking have no body

The brain-side reaction to demolition **exists** (LP-12: `demolishHouse` enqueues a `homeLost` wake,
`closeBusiness` a `businessClosed` wake with job-seeking cooldowns cleared) — but nothing physical
follows [static, matches live observation]:

- **No ejection.** Occupants indoors at demolition keep their position and `currentBuilding`
  pointing at the destroyed tile; nobody is repositioned to the adjacent street or set outdoors.
  The maintainer-intended behavior: the displaced **spawn immediately on the street connected to
  the demolished building** (the `Field.getAdjacentRoadTile` seam the commute already uses), then
  their woken brain routes them — laid-off workers **go home jobless** (a located transition, the
  travel label narrating "→ Home"), and the un-housed start seeking.
- **Homelessness is hidden by design** (022 keeps the homeless "materialized but hidden") — so the
  most dramatic thing that can happen to a household is the *least visible* state in the game.
- **There is no `looking_for_a_home` behavior** — re-housing happens via the `runRecovery` sweep,
  off-screen. The ask: a visible, ambulatory `looking_for_a_home` continuous action in full parity
  with `job_hunting` (street presence, activity bubble, visits to vacant houses as located steps,
  the recovery/relocation flow invoked at the door the way `get_job` lands at the counter), so the
  eviction→homeless→recovery arc that already runs logically becomes a story you can watch.

**Direction:** workstream **W9** — physical ejection on demolition/eviction, the homeless made
visible (street-anchored day repertoire instead of the hidden flag), `looking_for_a_home` wired
into the existing relocation/recovery machinery as its manual channel.

---

## Part 4 — Generator/asset findings [asset]

The regenerated asset is *structurally* much better (hot band verified hourly; LP-9 edge re-pins
hold; sleep 8h in the hot band). Remaining findings:

1. **The cooking:eating ratio is ~14:1 over whole lives** (p700: 7,932 cookings, 573 meals; p520
   similar) — the off-map world has the same basket/pantry starvation as live play, survived via
   grazing credits. People cook five times a day, including at 4 AM by interrupting sleep (the
   critical-food self-wake proposes *cooking*, not eating or shopping). The P0-1 bundle should be
   verified against a regeneration with a cooking:eating ratio pin (~1.2:1) and a "median foodLevel
   ≥ 60" cohort assertion.
2. **Petty crime is a guaranteed jail carousel**: p700 committed 15 shopliftings/pickpocketings and
   was caught 12 times → **11 jail terms in 27 years**. The 121 neutral-coverage chain catches ~80%
   — off-map crime is near-certain punishment, which both distorts biographies (`ate_prison_food`
   ×678) and contradicts the live balance where coverage gates resolution. Tune the neutral
   catch/conviction rates toward the live mid-coverage odds.
3. **Illness cadence is still high**: ~3–4 `fell_ill`+`injury` per year per adult (p700: 107 in 27y),
   partly *caused* by chronic hunger's ×2.5 factor — fixing food fixes half of this on its own.
4. **The social monoculture is coffee**: `catching_up_over_coffee` is the #1–2 action of every
   decoded life (5,836 starts for p520). Not a bug (cooldown 36 ⇒ ~2/week is fine) — but it's the
   *only* strong social-continuous outlet, so it dominates every biography identically. The W2 venue
   repertoire fixes this by competition.
5. **Day-band lives still read day-quantized** (all-24h sleeps for anyone dead before the hot band —
   p101/p400/p520). Expected per the two-band design; worth remembering when reading old ancestors'
   logs in the inspector (they *will* look robotic).

---

## Part 5 — Legibility & tooling

1. **Activity bubbles collide and double-draw** [live]. Two forms: (a) unreadable chains when 3+
   labeled people share a block ("→ Catching up over coffee ing inventory"); (b) the *same* label
   apparently drawn over itself — the mechanism is co-located people running the **same activity**
   (joint plans, household pairs, coworkers on the same rotation) each rendering an identical text
   object at near-identical coordinates, with no stacking, dedup, or offset handling. Needs
   per-block label budgeting with vertical stagger, and a merge rule for identical co-located
   labels ("×2" suffix beats double ink).
2. **No object layer on the map** (P1-7): garbage, and eventually shop-window/stock cues, have no
   visual existence. Even two sprites (bag pile, "closed" shutter) would move legibility more than
   any log improvement.
3. **Groups travel as one overlapping sprite** [live]. People doing the same activity together, or
   going from the same place to the same place — a couple's walk, two officers chasing the same
   suspect, household members heading to the same venue — render perfectly stacked, so a joint
   scene reads as one person (and feeds the same-label double-draw, 5.1b). The maintainer-scoped
   fix is deliberately **not** a collision system (separate initiative if ever): **side-by-side
   formation offsets**, render-layer only — logical positions stay canonical (pathfinding,
   arrival, co-location queries untouched), and each group member draws with a small deterministic
   lateral offset perpendicular to the walk direction, by stable slot index. The task-115 pet dot
   is the exact precedent (a purely visual companion offset). Grouping signals already exist:
   joint-plan linkage ids (085), the pursuit pair (099), shared dispatch to one incident (109),
   and a same-origin→same-destination-same-tick fallback for household co-walks. People only;
   vehicles stay in their lanes.
4. **The HUD error boundary** (P0-5).
5. **Silent consequence failures** (P0-1d) — the inspector cannot explain "why didn't they buy/eat".
6. **Travel labels & minute spread work** and read great; the "→ Resting at home, sick" moment was
   the session's best. Keep building on this seam.
7. **Harness gaps found while scripting** (all cheap): `build()` accepts no `blueprintKey` (pinned
   civic placement requires hand-emitting `tileClicked`; the menu's placeholder asset key
   `civic_<entryId>` vs blueprint key mismatch is an easy foot-gun — my landfill/prison rendered as
   missing-texture black squares until diagnosed); no `hireAs(personId, workplaceKey, title)` seam
   (scenario staffing required monkey-patching `avaiableJobs`, and raw `Workplace.hire` doesn't set
   `WorkLife` — a trap); no `forceEvent` wrapper around `EventEngine.invoke` (state/ctx plumbing is
   needed every time); `PersonSelected` takes a bare `Person` (an object payload crashes the HUD —
   see P0-5). Propose promoting these four as harness keepers for every future observation session.
8. **`Workplace.avaiableJobs`** is misspelled (grep-hostile, like the fixed "intialized").

---

## Part 6 — The proposed aliveness-3 arc (sketch)

Round 3's identity: **a healthy steady state, answerable failures, and scenes that read.** Ordered by
leverage; sizes in the house convention.

| # | Workstream | Contents | Size |
|---|---|---|---|
| **W0 (P0 wave)** | Stop the bleeding | P0-1a–f (baskets, restock validator+throughput, silent-failure logging, hunger→shop producer, honest `went_grocery_shopping`); P0-5 HUD error boundaries; P1-8 negative-balance audit; P0-4 empty-house surfacing. Keystone: the fed-town live test — fresh civic town, **median food ≥ 60 by week 2, groceries actually purchased**. | L |
| **W1** | The labor answer | P0-3: scarcity/coverage-aware hiring (role-balance term in `bestMatch`; front-line-first fill order per business), **migration** (unmet labor demand + vacant homes → new household draws with retcon-at-need extended to service roles), optional wage-pressure job switching. Keystone: the civic town staffs police/fire/sanitation/hospital within a month without player micromanagement. | L–XL |
| **W2** | Venues people go to | P1-1/P1-2/P1-8: venue kinds for every consumer blueprint; located repertoires (eat out, cinema, gym, library, church, salon…) with `satisfies` + real spending; opening hours from staffed shifts; date-night/joint-plan wiring; needs/routines integration. This is the street-life multiplier and the money sink in one. Mostly data over existing machinery. | L (data-heavy) |
| **W3** | Scenes, not events | P1-3: `concluded` vs `interrupted` semantics (sleep!, shift-end); actor-side interruption for person-targeted service/justice actions; post-incident aftermath states; work→work switches stop firing `stopped_working` (+ the day-credit regression test). | M–L |
| **W4** | Household truth 2 | P1-4 household-unit rehousing + homeless repertoire; P1-5 retirement gates + retiree repertoire; P1-10 move-out semantics; P1-6 conception from `had_sex` (manual channel primary, generator keeps the hazard) + the minimal wedding scene. | M–L |
| **W5** | The visible street | P1-7 curb-bag rendering + squalor cleaning loop; Part-5 bubble collision; **side-by-side formation offsets** (Part-5.3: render-layer lateral offsets by stable slot index for linked groups — joint plans, pursuit pairs, shared dispatch, household co-walks; the pet-dot precedent, people only, no collision system); object-layer seam (bags now, shop cues later); optional "closed" shutter for W2's hours. | M |
| **W6** | Generator re-pin | Part-4 items: neutral-coverage crime odds, the cooking:eating pin, illness cadence re-measure, consent-decline pricing; regeneration + decode re-pins as the arc's closing evidence. | M |
| **W7** | Observation keepers | Part-5.7 harness seams (`build` blueprintKey, `hireAs`, `forceEvent`, payload-safe selection), the live-map school-attendance keystone (P1-9), and this document's method as the standing template. | S–M |
| **W8** | Sprite & travel truth — the visuals debug pass | The P0-2 bundle as one coherent phase: (a) **vehicle lifecycle** owned by the transition handle — cancel/re-plan despawns the car, `setVehicle` refuses to overwrite a live link, occupant flags cleared on abandonment, plus an orphan sweep; (b) **spawn/despawn race** closed for vehicles AND people (sprite attach awaited or synchronous; `removeX` destroys-or-marks so a late-attaching sprite self-destroys); (c) **travel-machine reset seam** — interrupting a traveling person's intent parks/despawns coherently instead of letting the body finish the stale trip or pop visible mid-road; (d) **sprite-vs-state invariants** as standing assertions (integration suite + a harness `auditSprites()` read: vehicles ≤ people-in-flight, no visible sprite for an indoors person, no occupied driverless car, no sprite without a list entry); (e) **bubble collision & the same-label double-draw** (Part 5.1: per-block budget, stagger, identical-label merge); (f) a **general visuals live-test protocol** — a scripted pass (the 117/this-doc method) that screenshots morning/noon/evening at 1× and 16×, diffs sprite counts against sim state each hour, and eyeballs bubbles, the object layer (W5), and depth/z-order at tall buildings. Run it once as a debug session (expect more finds — these fell out of one afternoon), then keep the invariant assertions as CI. | M–L |
| **W9** | Construction & demolition UX | The maintainer-spec'd pass over the player's own hands: (a) **bulldoze truth** (P0-6) — resolve the clicked cell to the structure's anchor and stamp soil over its whole footprint, plus a real bulldoze **ghost preview like every other tool's: the grass tile**, shown over the footprint that would be cleared (the toolbelt preview asset is `null` today); semantics stated plainly: bulldozer = grass tool, coherent logic teardown, clean grass after; (b) **physical ejection** (P1-11) — the displaced spawn on the street connected to the demolished building (`getAdjacentRoadTile`), laid-off workers visibly go home jobless, and the un-housed run the new `looking_for_a_home` ambulatory (full parity with `job_hunting`: bubble, located visits to vacant homes, the relocation/recovery flow invoked at the door), homelessness made visible generally; (c) **much softer placement snapping** — a candidate snaps only when the cursor is within the closest **half of an adjacent tile** (~1.5 tiles; today `BUILDING_SNAP_RADIUS_TILES = 4`), otherwise the preview is honestly invalid; (d) **tool reset after build** — a successful building placement returns the cursor to the Select tool (one click, one building); roads keep the continuous paint behavior. | M |
| **W10** | Time control as a first-class system | The closing phase: promote the masterSwitch-gated debug `T` throttle into a shipped, player-facing time system. (a) **Distortion-free scaling across the board**: one authoritative time-scale factor that EVERYTHING derives from — ticks come closer together when time runs faster, and movement, vehicle physics, animations, particle emitters, the minute cadence (LP-11 materialization/departures), wake drains, and every `timeChanged`-driven pump scale **together** (today the clock and `Field.update` scale (LP-2) but nothing audits the remaining consumers — the P0-2 amplifier shows the seams). (b) **Deterministic and hitch-resistant**: a fixed-timestep accumulator with clamped catch-up so a framerate drop or CPU/RAM-bound hang stalls *everything together* — the sim never leaps ahead of movement (no delta lumps tunneling walkers, no minute pumps skipped); if the game must hang, it hangs coherently, and the same seed + same speed schedule reproduces the same world (extend the determinism suite to assert byte-equal state after identical tick counts run at 1×, 4×, 8×, and mixed schedules — the speed knob must be invisible to the sim). Revisit the hidden-tab RAF freeze (aliveness-2 P2-7) as part of the same contract: background pause becomes an explicit, coherent state, not an accident. (c) **The time HUD**: a small floating toolbar, top-right — four icon buttons: **Pause ▪ Play (1×) ▪ double-chevron (4×) ▪ triple-chevron (8×)** — active speed highlighted, wired through the bus per §4.9 (the debug `T` key can remain as a dev alias). (d) **Test it extensively**: integration-suite coverage for the toolbar and each speed; movement-vs-clock consistency assertions at every scale (the LP-2 assertion, generalized); pause = zero sim drift; and harness upgrades where needed (e.g. a `setTimeScale`/frame-hitch injection seam so CI can simulate stutter and assert no desync). | M–L |

Dependency spine: W0 first (everything else is observed through a starving town otherwise); **W8
early and independent** (it's the lens every later live observation looks through — land at least
W8a–c alongside W0); **W9a/c/d** (bulldoze truth, soft snapping, tool reset) are small and can ride
with W8 — W9b's `looking_for_a_home` wants W8c's travel-reset seam first; W1 ‖ W2 next (labor and
venues are independent); W3–W5 ride on them; W6 late (one regeneration); **W10 closes the arc** —
the first-class time system wants W8's sprite/travel truth already landed (a distortion-free
throttle over a leaking visual layer would faithfully fast-forward the leaks), and its
speed-invariance determinism suite is the arc's final acceptance gate: the same seed at 1×/4×/8×
must produce the same town.

---

## Appendix B — the post-implementation live re-measure (same civic town, arc engines)

The audit's exact town shape (13 houses / ~34 residents / 11 businesses incl. the full civic set),
re-run in the browser on the finished arc:

- **Sprite invariants: all-zero for the whole run** — orphan controlled vehicles 0 (baseline ~4.6
  leaked/day, 148 total), occupied-driverless 0, visible-indoors 0; cars on the road = people actually
  in flight.
- **The town staffed itself**: 1 Manager (baseline **14 of 24**), 9 nurses, 5 checkout clerks, 2 police
  officers, 1 firefighter, 2 garbage collectors, 1 corrections officer, 4 teachers — the W1 keystone
  met with no player micromanagement.
- **Groceries flow**: purchases every day (baseline: zero for 28 straight days); people eat both at
  home and out; curb bags get **collected** (baseline: 0 → 212 monotonic).
- **Blocked venue trips: 0** (baseline-equivalent run showed a 166-blocked wall at 16:00–19:00 before
  the choke guard); shops honestly closed at night, and nobody proposes trips into them.
- **Sleep completes** (17 completions in 3 days; baseline 0 — every night ended 'interrupted').
- The time toolbar's full loop verified by real clicks (▶▶ → scale 4 → highlight follows); the ×2
  label merge and midnight-empty streets confirmed on screenshot; an off-anchor bulldoze cleared all
  9 footprint cells (no ghost).
- Two shelf-economy gaps were found only in THIS pass and fixed in the same commit chain: the basket
  must span the restock set (milk/pasta/cheese/butter/cereal silted), and restocked production
  (bakery cake, restaurant steak) must be purchasable — both now validator-enforced (the inverse
  sustainability rule).

## Appendix — session numbers (the re-measure baseline)

World 1 (seed 20260718, 13 houses / 30 residents / 11 businesses incl. full civic set, 32 in-game
days): hires day 1 = 13; `started_working` 13–21/weekday, 1–3/weekend-day; **`bought_groceries` = 2
(day 1–2) then 0 for 28 days**; cooking completions ~25–40/day vs `ate_a_meal` 1–13/day; median
food 5–10 from day 5; `went_hungry` 10–20/day; curb bags 0 → **212** (squalor 1.0); **vehicles
leaked: 148**; mood min/med/max 4/19/70; jobs: 14 Manager / 5 Teacher / 2 Trainer / 1 Doctor /
1 Clerk / 1 Collector; depot+police+fire positions filled: 0; `fell_ill` 15; treatment sessions 98
(83 completed) vs `was_treated_by_doctor` 8; school days completed 17–18 of ~30 expected;
`shared_gossip`↔`heard_gossip` 29/29.

World 2 (seed 777001, forced scenarios): sick→hospital arc completed in 6 in-game hours
(ill 09:00 → treated 15:00); fire ignition → burned-down lot + `lost_home_to_fire` ×2 + partner-split
rehousing (one rehoused, one homeless-at-the-supermarket); crime → flee/chase/arrest/ride/fine chain
closed same hour, officer never interrupted his coffee, suspect back at the register within the hour;
75-year-old seriously-ill man hired same morning; 3 of 6 houses drew empty. Vehicle-leak repro: person
caught at `driving`, second `startCommute` issued → car count +1 permanently, orphan retains
`occupied`; person forced to `exit-building` while still flagged indoors (sprite pops visible mid-road
next frame).

Asset (regenerated, `generatorVersion 121.0`, endTick 1,400,064, hot band ≈ ticks ≥ 1,313,664):
p700 — 7,932 cookings vs 573 meals; 15 crime commits → 12 caught → 11 detentions; `ate_prison_food`
×678; sleeps 8h×1171 / 24h×316; `moved_out_of_parents` ×8. Cohort-lifetime consent declines: hugs
1,804 ok / 1,142 declined.
