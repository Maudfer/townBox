# Simulation Aliveness 4 — the visual-experience audit

**Status: findings + proposed arc, v2 (not yet broken into tasks).** v2 folds in the maintainer's own
observations and directives (Part 6, M1–M8) and threads them through the arc (V6/V8 extended, V9–V11
added). This document is the deliverable of
the round-4 observation session: a full re-run of the observation effort with **the real-time visual
player experience as the first-class citizen**. Round 1 made the engines feed each other, round 2 made
the map feed them, round 3 made the steady state healthy and the failures answerable. Round 4 asks the
question none of them asked directly: **when a player just watches the town, does what they see read as
a living place — or as simulation machinery wearing a town costume?**

Three instruments, cross-checked:

1. **A new movement tracer** in `TestHarness.ts` (uncommitted on the working tree, proposed as a keeper —
   see Part 5): `startTrace()/stopTrace()/traceReport()/traceAnomalies()/traceEvents()/traceCrumbs()/
   activityCensus()` sample every update frame while active and record per-person state-change timelines,
   positional breadcrumbs, and anomaly detection (logical teleports, render-layer jumps, stuck walkers,
   sprite overlaps, sprite-audit violations) — because screenshots can't see motion, but a posthumous
   trace can.
2. **Live play in a real Chrome tab** (the Claude-in-Chrome session): an asset-booted 12-house /
   14-business / full-civic-set town of 28 (seed 20260719), observed for ~83 in-game hours of real
   RAF-driven play at 1×/4×/8× through the shipped W10 time system, plus forced scenarios (a house fire
   with residents inside, serious illness at night, a witnessed crime, a bulldoze with an occupant).
3. **Static sweeps** of the seams each live finding implicated (`City.startCommute`, `LiveWorld`,
   `Person.processTravel`/`updateDestination`, `SocialOpportunity`, `MainScene` formations/labels,
   `json/actions.json`).

Findings are marked **[live]** (observed in the browser), **[static]** (mechanism verified in source), or
both. Where a finding traces to a known deferred residual, that is said explicitly.

The headline: **the sprite/travel truth layer (W8/W10) genuinely holds** — sprite invariants stayed
all-zero for the entire session, no orphan cars, no ghost sprites, honest labels, clean bulldozes — and
the town's *systems* keep working (labor flows, school runs, fires burn and resolve, the justice chain
closes with a mid-cake-baking arrest that is pure Dwarf Fortress). What round 4 exposes is one layer
deeper: **the town's model of PLACE and PURPOSE is too coarse for the camera.** Movement is truthful but
absurd (a woman walks home to board a car parked at her own front door, drives zero meters, and gets
out); "outside" is a single logical room the size of the whole map; walkers navigate building-anchor to
building-anchor because there is nowhere else to go; toddlers run errands alone at 5 AM; and the moments
the glue produces — evacuations, arrests, homelessness — still read wrong in the details because nothing
re-plans a life the instant its context burns down. Round 4's identity: **make place, purpose, and
company real on the street.**

---

## Part 1 — What verifiably works (do not re-solve)

Confirmed live this session, on `main` (post-aliveness-3, asset v137.0):

- **Sprite invariants: all-zero across ~83 in-game hours** — orphanControlledVehicles 0,
  occupiedDriverlessVehicles 0, visibleIndoorsPeople 0, at every sample, through commutes, a fire, an
  arrest, and a demolition. The W8 lifecycle fixes hold under sustained real-time play.
- **The time system (W10)**: 1×/4×/8× ran distortion-free; movement and clock never diverged; the HUD
  toolbar highlight tracked programmatic scale changes.
- **Labor flow (W1/LP-13)**: 0 → 22 employed by day-1 evening, 28/28 adult employment by day 3;
  front-line-first hiring produced 1 security guard, sales associates, checkout clerks, corrections
  officers — no Manager avalanche; the civic set self-staffed (police, fire, hospital, sanitation, jail)
  with no player micromanagement.
- **School (058/063)**: all four school-age children enrolled and physically present at the school
  building mid-morning, `attend_school` running; the toddler correctly excluded.
- **Travel labels & minute cadence (LP-2/LP-11)**: "Going to Barros-Martins / Plan: Working the
  register" walking past "Out looking for work" is the street narrating itself; departures visibly
  spread across the hour.
- **The fire arc completes** (102/110/116): particles on the burning house, household evacuation,
  resolution ("The fire was contained — heavy damage" in the feed), family back home after. The
  *middle* reads wrong (Part 3), but the loop is real.
- **The justice arc completes** (109): witnessed incident → next-morning `fleeing_the_police` →
  `chase_concluded` → `was_arrested` → `got_a_ride` → `was_detained` → `serving_time` →
  `ate_prison_food`. The suspect fled **mid-`bake_cake`** — dough abandoned on the counter — which is
  exactly the texture this project exists for.
- **Bulldoze truth (W9)**: an off-anchor bulldoze cleared all 9 footprint cells (no ghost building), the
  feed narrated demolition + homelessness honestly, and the occupant was physically ejected to the curb.
- **Evening variety (W2)**: jogging, evening strolls, window shopping, exercising, running errands — a
  readable, varied early-evening street. Deep-night streets (1–2 AM) were mostly, though not entirely,
  empty.
- **Work texture**: the officer's day log (short break → gave directions to a stranger → checked the
  clock → wrote up reports) and the nurse's (tested a sample, tidied the workspace, complained about
  the time) read as believable workdays.

---

## Part 2 — The movement layer: truthful, but absurd

The W8 pass made movement *honest*; this session shows honesty is not the same as sense. These are the
round-4 core findings — all in the class the brief asked about (cars vs. walking, teleports, clustering,
overlap).

### 2.1 · The car ritual: every trip is a car trip, and the car spawns at the wrong end

**[static+live]** `City.startCommute` has no walk-vs-drive decision (every adult located trip spawns a
car, at any distance) and resolves its origin as `person.getCurrentBuilding() ?? person.social.getHome()`
— so for anyone **outdoors** (ambulatory walk, job hunting, ejected, stranded at a curb by a prior
outside action), the commute car spawns **in front of their home, wherever they actually are**.

The tracer caught the canonical absurdity end-to-end. Marcela, out walking at 01:00, decides to sleep:

1. Her body **keeps walking the leftover stroll leg** for 7 minutes while the sleep intent waits
   (`Person.update` continues the stale `currentTarget`/path after the ambulatory action ended — a
   bounded cousin of the stale-trip bug W8 fixed for building trips).
2. At her departure minute the car spawns at her **own home's curb** (origin = home; destination = home).
   She walks **~31 tiles to her own house** to reach it (13 sim-minutes labeled "Going home").
3. `enter-car → driving → exit-car` land **in the same minute at the same coordinates** — a
   zero-distance drive, because the car spawned on the destination's adjacent road tile.
4. She steps out of the car parked at her front door and walks the last 3 tiles inside.

Visually: *a woman walks home, climbs into a parked car, immediately gets out of it, and goes to bed.*
Every homeward trip from outdoors has this shape. Every outdoors shift-start has the mirror shape (walk
home first, then drive to work — even when the workplace is between the person and home).

Two compounding effects measured:

- **92 car trips in ~3.5 days for 28 people, all short hops.** Job-application rounds
  (`applying_at_business`) alone accounted for 12+ car trips — the street reads as cars materializing,
  driving 4–8 tiles, parking, and **vanishing on arrival** (park-and-despawn). Magic pop-in/pop-out cars
  are the dominant vehicle experience.
- All 278 logical "teleports" the tracer flagged were the **by-design disembark sync** (`exit-car →
  walk-to-destination`, sprite hidden while driving) — i.e. no *bug*-class teleports remain — but the
  boarding/alighting snaps are also what a player half-sees and reports as "walked to the entrance then
  teleported to their car."

**Direction (V1, the anchor workstream):** a real **trip planner** at the transition seam —
(a) origin truth: the trip starts from the person's actual position, never from a building they are not
at; (b) **walk vs. drive by distance** (authored threshold, ~N tiles): short trips are walked, the car
is for real distance; (c) never spawn a car whose route is zero/one road tile; (d) later (own
initiative): persistent household cars that park and are *re-boarded*, instead of per-trip conjuring —
the current spawn/despawn contract is the root of the pop-in/pop-out reading.

### 2.2 · "Outside" is one town-sized room

**[static+live]** `LiveWorld.locationOf` returns `{kind:'outside'}` for every outdoor person, and both
`peopleAt` and the interaction contract's same-building check (`locationKey(a) === locationKey(b)`)
treat all outdoor people as co-located — **across the entire map**. The social hook, person-targeted
actions, consent, witnesses, and the C1 counterpart machinery all bind through it.

Live evidence (crumb-verified positions at commit minute): 6 outdoor interactions between people
**110–470 px apart** (7–29 tiles) in one session, including `lent_an_object` at 386 px — the object
changed hands between two people on opposite sides of town — and `played_with_person` at 470 px.
Street conversations, greetings, jokes, gossip: any two pedestrians anywhere qualify.

This is the documented off-map co-location seam surfacing on the map, where the camera can see it. It
also quietly distorts everything gated on company (witnesses for crimes, `hosting_gathering`'s guests,
the social graph's street-formed edges).

**Direction (V2):** give the outdoors **place-hood** — outdoor co-location becomes radius-scoped
(reuse the location→people index pattern; a street-segment or supertile bucket key like
`outside:<r>-<c>` keeps `locationKey` equality semantics intact so the engine and validators are
untouched), and the interaction contract's "same building" becomes "same place" with outdoors places
being small. Bootstrap/logical worlds keep the abstract single 'outside' (the sanctioned seam
difference, exactly like venue hours).

### 2.3 · Walkers navigate building-anchor to building-anchor — the entrance-cluster mechanism

**[static+live]** Ambulatory movement (`Person.updateDestination`) picks destinations from
`Field.destinations` — the set of **every building anchor** — and `setNextTarget` targets a building's
**entrance point** when the path ends at a structure. So "taking a walk" is structurally: *pick a random
building, walk to its front door, stand there, pick another building.* The user's long-standing
observation that wanderers concentrate around public-building entrances is confirmed and mechanized:
every wander leg **terminates at an entrance**, and with most walkers alive at once (see 2.5) the same
few entrance pixels host a rotating crowd. First-frame observation: 15 simultaneous walkers, most parked
at house/civic entrance points; "Taking a walk" labels literally at the fire station's and jail's doors.

Side note **[static]**: wander picks use `Phaser.Math.RND` (unseeded) — harmless today because outdoor
pixel positions never feed sim state, but worth a comment the day outdoor radius co-location (V2) lands,
at which point wander must move onto a seeded stream.

**Direction (V2, same workstream):** a **street wander graph** — ambulatory legs route over road/curb
nodes and authored loiter points (the park, benches, storefront windows), ending mid-block, not at
doors; entrances stop being destinations except for trips that genuinely enter. Pairs naturally with
loitering variety (sit on the bench that already exists as an object, window-shop at a shop-fronted
road).

### 2.4 · Sprite stacking: 1,039 overlap episodes; the jitter fix pops

**[live, tracer]** 1,039 distinct episodes of two+ visible outdoor people within 4 px (5-second-cooldown
deduped, so this undercounts). Mechanisms:

- Everyone on a road walks the **same 1D curb line**, and everyone visiting a building stands on the
  **same entrance pixel** — logical stacking is structural (2.3 feeds it).
- The W5 formation offsets only separate **same-defId** groups (via the alias table) within a 32-px
  cell, refreshed per in-game minute. Distinct-activity stacks — "Taking a walk" over
  "Visiting relatives" — get **no offset at all**.
- The offsets **snap**: 13 render-jump anomalies of exactly the predicted shape — logical movement ~0 px,
  sprite hop 8–10 px — when a formation refresh re-slots a standing group. This is the user's "the
  jitter made people clip/teleport short distances" sighting, confirmed and mechanized: the offset is
  applied instantaneously in the redraw closure with no interpolation.

**Direction (V6):** (a) interpolate offset changes (lerp toward the target offset over ~a second) so
re-slotting never pops; (b) offset **all** co-located visible people, not just same-activity groups
(slot by stable person id within the position bucket; the activity alias only decides *grouping for
labels*); (c) with 2.3's mid-block loitering, the entrance pile-ups thin out on their own.

### 2.5 · Monocultures make the street read as a flash mob

**[live]** Free-time output is varied *per person over time* but synchronized *across people at a
moment*: 15 of 28 residents ran `taking_a_walk` simultaneously at 07:00 day 1; 11 of 28 ran
`visiting_friends` at 22:00; midnight strolls are routine (`taking_a_walk` keeps its base weight at
3 AM — Marcela's 00:00–01:00 walk; the town's "midnight-empty streets" is only mostly true). The same
few actions also dominate biographies (the aliveness-3 coffee-monoculture finding, now visible on the
street as identical labels everywhere).

**Direction (V7, pure data + one selection nicety):** hour-shaped weights for the big outdoor/social
actions (walks peak morning/evening, near-zero 23:00–06:00 absent insomnia texture; visiting_friends
tapers after 21:00), plus mild **anti-synchrony** — the deterministic pick already forks per person; what
is missing is authored variety pressure (lower base weights, more competing evening actions — W2's venue
repertoire helps once venues pull harder than walks).

---

## Part 3 — Scenes that still don't read

Round 3's W3 fixed the lifecycle vocabulary; these are the next-layer scene breaks, all observed in
forced scenarios this session.

### 3.1 · The fire: evacuees tour the town, and a man sleeps in the burning house

**[live]** Ignition at 19:47 with two residents inside (one asleep). What happened:

- **Evacuation scoped by household, not by presence**: all four household members started `evacuating` —
  including two who were elsewhere in town, who thereby began "Evacuating!" *away from* a fire they were
  never in. "Evacuating!" labels dotted the whole map within minutes.
- **Evacuation is an unbounded wander**: `evacuating` is `location: outside, ambulatory: run` — the
  evacuees ran building-entrance to building-entrance (2.3) for **six in-game hours**, still labeled
  "Evacuating!", with no rally point, no "safe now" conclusion, no regrouping at a neighbor's.
- **Pedro went back to bed in the burning building**: his evacuation instance ended (natural conclusion),
  the needs hook proposed sleep, sleep's `location: home` sent him **into the open fire**, and he slept
  there for the rest of it. Nothing gates located actions on "this building is currently on fire," and
  the fire-response hook evidently proposes evacuation once rather than holding it while the incident is
  open.
- The fire burned ~7 in-game hours before resolving (with the town's one firefighter off duty — the
  honest-coverage path — but 7 hours of particles with zero response *activity* visible is a long time
  for the camera).

**Direction (V4):** (a) a `burning` gate on location targeting (a located intent whose target has an
open fire incident is blocked/typed, and the fire wake *re-proposes* evacuation for anyone inside);
(b) evacuation concludes: scope it to building occupants + a family-notification wake for the rest,
give it a **rally target** (the connected street outside their home, a neighbor/relative house via the
relocation helper) and a natural end when the incident resolves; (c) response pacing: resolution window
tuned so an unanswered fire still resolves within ~2–4 hours.

### 3.2 · The aftermath gap: homeless, "Spending time at home"

**[live]** After the bulldoze ejection (which itself worked — body on the curb, feed honest), Maria
Júlia's next hours: `became_homeless` at 15:19 → **`spending_time_at_home` twice more** (17:18, 17:44),
running at the curb next to the rubble, label floating over the grass where her house was → an evening
stroll. The `homeLost` wake fired but did not displace her running location-less leisure; and the
free-time picker kept proposing home-category actions to a woman with no home (`spending_time_at_home`
declares `location: home`, but her pre-demolition instance survived the teardown un-revalidated, and
the re-picks either ran unlocated or silently). `looking_for_a_home` is agenda-anchored to the next
day — correct cadence, but the first hours after the most dramatic event of her life read as denial
plus a nice walk.

**Direction (V4):** (a) demolition/eviction re-validates the victim's *running* instance (interrupt with
cause, like the arrest ceremony does); (b) a homeless day-shape: home-category actions hard-gate on
having a home, with the shelter-seeking/park/bench repertoire (the machinery exists) taking their
weight; (c) the deferred domestic-location data pass (Appendix B.1's known residual — explicit `home`
locations on the domestic repertoire) folds in here, scheduled post-regeneration as planned.

### 3.3 · Illness: the treatment intent evaporates when the hospital is closed

**[live]** Warley fell **seriously** ill at 02:31. He woke at 05:08 and went **grocery shopping** —
the hospital was closed (venue hours: the one nurse off shift), so `hasVenue('hospital')` was false,
the treatment producer proposed nothing, and the hunger producer won the morning. Treatment began only
at 06:51 when the venue opened, ran three sessions, then `resting_at_home_sick` — a decent arc *once
the doors opened*, but "seriously ill man runs errands because the clinic is shut" is the closed-venue
collapse pattern: **a blocked need doesn't defer, it disappears** (no "go when it opens" plan, no
waiting-at-the-door, no urgency escalation).

**[live, compounding]** The hospital's only staffer is a **Nurse — and nurses never treat**: the
doctor-rounds hook is title-gated to Doctor, so Carla spent the morning `tested_a_sample` /
`tidied_the_workspace` in the same building as a seriously-ill patient in `receiving_treatment`, no
`treating_patient`/`was_treated_by_doctor` pair, no `recentlyTreated` boost — while the coverage ledger
counts her as healthcare provision and the nagbar stays quiet. A staffed-but-doctorless hospital is
functionally a waiting room that the services layer reports as coverage.

Also **[live]**, the milder case: Marcela (ill at 14:00) got treatment, then spent the evening walking,
visiting friends, and laughing until midnight — mild illness gates almost nothing observable.

**Direction (V5):** (a) closed-venue needs **defer instead of dissolving** — a planner entry "at
opening hour, go" (the agenda machinery exists; this is the general fix for every venue-gated need,
not just health); (b) treatment roles: either nurses treat at reduced effect (data: the rounds hook
reads a role set, not one title) or coverage weighting counts only treating roles — both honest, pick
one; (c) severity-banded day-gating so serious illness visibly cancels leisure (the bedridden-band
weights exist; verify they bind at `health` 0.3 and widen them).

### 3.4 · Justice: closes well, sentences oddly

**[live]** The chain itself was the session's best scene (Part 1). Warts: the sentence for a
first-observed offense was **jail**, not the 109 fine-first ladder (verify whether her hydrated asset
record carries priors — if the off-map carousel (aliveness-3 Part 4.2) still convicts everyone
repeatedly, live sentencing inherits inflated records); the 19-hour case latency read fine
(next-morning warrant), but only because she happened to be home — a suspect mid-shift would be
arrested at the register again (the W3 actor-side interruption covered the officer; the *suspect's*
workday context still doesn't factor); and the harness's `forceEvent` **discards invoke signals**, so
a forced crime never registered an incident (Part 5, tooling).

### 3.5 · Children are small adults

**[live]** The session's most consistent coherence break, compounding across every system:

- **Ana Luiza, age 2**: home alone after both parents left for work; took herself on a solo
  `shopping_trip` to the supermarket (minors walk, so she toddled across town); ran
  `hosting_gathering`; `lent_an_object` and `invite_to_activity` to people across the map (via 2.2);
  and when her mother was jailed and her father at work, she was **out taking a walk alone** again.
- **Beatriz, age 9**: solo `visiting_relatives` before 07:00; wandering town at night mid-evacuation.

There is no guardianship layer at the behavior level: age gates exist for school/jobs, but free-time
selection offers toddlers the adult repertoire minus explicit age-gated entries, no action requires an
accompanying adult, and nothing notices a dependent home alone (LP-5's household meal fan-out feeds
them; nobody *minds* them).

**Direction (V3):** an age-banded action policy (data: `minAge` on the errand/venue/social-roaming
repertoire — the validator can enforce coverage), an **accompaniment** primitive for the young (a
toddler's located trip requires/joins a guardian's — the D3 joint-plan linkage is exactly this shape),
a home-alone signal with a parental-care producer (the `caring_for_children` action exists and is
already selected — anchor it when a dependent would otherwise be unattended), and jail/illness/death
fan-outs check for now-unattended dependents (the orphan re-housing precedent).

### 3.6 · Small coherence catches [live]

- The generic business draw gave the downtown a **beach** between the bar and the bakery (the
  cemetery-class draw-coherence item from aliveness-3 P1-10, still open).
- `visiting_friends` runs in two modes with one identity: the planner's located visit
  (`person:<id>`, real travel — good) and an unlocated free-time variant that logs "Visiting friends"
  while standing at home alone. Split the ids or gate the free-time variant on co-location.
- `hosting_gathering` ran in three houses at once on day 2 with no evidence of guests arriving
  (suspicion, not verified: hosting may not require/produce visitors — worth an audit of its
  contract).
- The stale **tool-preview ghost** (a translucent road segment) floats over empty grass wherever the
  cursor last hovered before leaving the canvas.
- Shift-enders don't go home first: the officer clocked out at 17:13 and was `browsing_store` at
  17:30 — fine alone, but combined with 2.1 every such trip is a car hop; venue evenings will
  multiply them.

---

## Part 4 — Proposed aliveness-4 arc (sketch)

Round 4's identity: **place, purpose, and company on the street.** Ordered by leverage; sizes in the
house convention.

| # | Workstream | Contents | Size |
|---|---|---|---|
| **V1** | The trip planner | 2.1: origin truth (trips start where the body is), walk-vs-drive by distance, no zero-length drives, stale-path cancellation on ambulatory end (the sleepwalking leg). Keystone: a scripted day where no resident boards a car for a sub-N-tile trip and no car spawns at a building its driver isn't at. Optional stretch (own initiative): persistent household cars, parked and re-boarded. | M–L |
| **V2** | Outdoor place-hood | 2.2 + 2.3: radius/segment-scoped outdoor co-location behind `locationKey` (bootstrap keeps the abstract 'outside'); the street wander graph with curb/loiter nodes (benches, park, storefronts) replacing building-anchor hops; wander onto a seeded stream; interaction contract "same place" for outdoors. Keystone: zero cross-map interactions in a traced day; walker heatmap no longer peaks at entrances. | L |
| **V3** | Guardianship & dependents | 3.5: age-banded repertoire gates (data + validator), accompaniment via joint-plan linkage for under-N trips, home-alone detection anchoring `caring_for_children`, dependent checks on jail/illness/death fan-outs. Keystone: a traced week in which no under-6 leaves home unaccompanied. | M–L |
| **V4** | Scene aftermath truth | 3.1 + 3.2: burning-building location gate + evacuation with rally and conclusion + presence-scoped evacuation with family-notify wakes; demolition/eviction re-validates running instances; homeless day-shape (home-gated domestic actions + shelter repertoire); the deferred domestic-`home`-location data pass (post-regeneration, as scheduled). | M–L |
| **V5** | Deferred needs & service roles | 3.3: closed-venue needs defer to opening (planner entries) instead of dissolving; treating-role honesty (nurses treat at reduced effect, or coverage counts only treating roles); severity-banded illness day-gating verified live. | M |
| **V6** | Street render polish & selective labels | 2.4: interpolated formation offsets (no 8-px pops), offsets for all co-located visible people (grouping only for labels), label budget tuning; entrance thinning falls out of V2. **M1: activity labels render only over selected people** (person window open), with a debug-all toggle. | S–M |
| **V7** | Rhythm & variety tuning | 2.5 + 3.6: hour-shaped weights for walks/visits (night floors), evening venue pull vs. walk dominance, the beach/cemetery draw-coherence guard, first-offense sentencing verification against hydrated records. Mostly pure data. | M (data) |
| **V8** | Sprite hardening & observation keepers | Part 5 + **M2**: commit the movement tracer; **the definitive orphaned-sprite reconciliation sweep** (every sprite maps to a live list entry or self-destroys; `auditSprites` invariants asserted in CI, not just read); `forceEvent` routes invoke signals through the City consumers; teleport classifier marks the disembark sync as by-design; the "visual truth day" protocol as the standing template. | S–M |
| **V9** | Collective-action integrity | **M3 + M4**: audit all 27 multi-person-semantics actions; the free-rolling continuous stragglers (`visiting_friends`, `visiting_relatives`, `hosting_gathering`, `taking_a_walk_together`) become real **joint plans** — a visit targets a specific friend's house, the host runs a mirrored `hosting_a_friend_visit` in the same building, both linked instances end together (the D3 machinery, applied where it was skipped); generated-doc + validator enforcement so no social action can free-roll again. | M–L |
| **V10** | Locomotion & the real chase | **M5 + M6**: a per-kind movement **speed** (walk / jog / run), driven by the action's `ambulatory` kind, with **police run speed slightly above** civilian run; the pursuit resolves only when the officer sprite **physically catches** the suspect (co-located within a catch radius) or the suspect is **deemed escaped** (distance/time bound) — not a duration-completion roll. Depends on V2 (place-hood makes physical proximity meaningful) and V1 (the movement seam). | M–L |
| **V11** | Time & clock configuration | **M7 + M8**: new games start at **09:00**, not midnight; the speed ladder becomes **1× / 10× / 50×** (HUD icons unchanged); a **50× distortion pass** — verify commute/minute-cadence pumps, departure-jitter windows, and one-waypoint-per-frame walking all hold at the larger per-frame delta (no overshoot, no skipped arrivals, no desync) and extend the W10 speed-invariance determinism suite to 50×. | M |

Dependency spine: V1 and V2 are the anchors and independent of each other; V4 wants V2's rally targets
but its gates can land first; V3 rides D3 linkage and is independent; **V9 also rides D3** and pairs
with V2's place-hood; **V10 depends on V1+V2**; V5–V7, V8, V11 are independent (V11 is small and can
land early — the start-time and ladder changes are near-trivial, the 50× pass is the substance). The
arc's acceptance gate mirrors this session: a full traced in-game week at **50×** with
**zero bug-class teleports, zero orphaned sprites, zero cross-map interactions, no unaccompanied
toddlers, no car for a sub-threshold trip, every social visit a two-sided scene in one building, a
chase that ends on a real catch, and a fire/demolition scenario whose victims' next six hours read as
aftermath** — plus the standing all-zero sprite audit round 3 already achieved.

---

## Part 5 — Tooling notes (this session's instrument)

- **The movement tracer** (`TestHarness.ts`, working tree): `startTrace()` samples every `update` frame
  (scaled by `effectiveTimeDelta`, so it is throttle-honest and free while paused); per person it
  records state-change events (travel step, indoors, building, destination, vehicle link, active
  action/status/location, ambulatory), 250-ms breadcrumbs (ring-buffered), and anomalies: `teleport`
  (logical jump beyond one frame's walk), `renderJump` (sprite moved ≫ logical — the formation-pop
  detector), `stuck` (walking step motionless > 2.5 s), `overlap` (visible pairs < 4 px, deduped),
  `spriteAudit` (the W8 invariants, sampled). Read via `traceReport()/traceAnomalies()/traceEvents()/
  traceCrumbs()`, plus `activityCensus()` for one-call town snapshots. Zero cost while off; test-mode
  only. **Proposed: commit as a W7-class keeper** (V8), with one refinement — classify
  `exit-car → walk-to-destination` as `disembark` (by design) so `teleport` alerts mean bugs.
- **`forceEvent` is signal-blind**: it calls `EventEngine.invoke` and discards the outcome's signals, so
  City-side consumers (incident registration, cohabitation, feed) never hear forced events — the forced
  shoplifting produced no incident until `incidents.report(...)` was called directly. Fix in V8.
- **Method notes**: build scripts against the harness must be fire-and-forget with polling (CDP
  evaluates time out at 45 s; background-tab timer throttling freezes awaited `setTimeout` chains —
  keep the tab foregrounded, as established in aliveness-2). `stepGame` compression remains the honest
  fast-forward for scenario setup, with the known arrival-compression caveat for anything
  arrival-gated measured during the skip.

---

## Part 6 — Maintainer additions (M1–M8)

Eight observations and directives from the maintainer's own play, each validated against the source and
threaded into the arc above. They divide into three legibility/hardening items (M1, M2), two
collective-action items (M3, M4), two locomotion items (M5, M6), and two configuration items (M7, M8).

### M1 · Activity labels only over selected people (with a debug-all toggle) → V6

**Validation: correct, and it's a pure legibility win.** `MainScene.refreshActivityLabels` creates and
shows a floating label over **every visible outdoor person** (`text.setVisible(show)` for all in the
roster). Combined with the monoculture (2.5) and entrance-clustering (2.3), the street is a wall of
overlapping "Taking a walk" text — the double-ink and collision the W5 merge pass fights is largely a
*consequence of showing them all at once*.

`MainScene` tracks no notion of selection today (`PersonSelected` is handled only in `Hud.tsx`, which
opens the detail window). The fix: MainScene subscribes to the open-person-window set — the cleanest
seam is a small bus contract (the HUD already owns which `PersonDetails` windows are open; emit an
`inspectedPeopleChanged` set, or reuse `PersonSelected` + a window-closed signal MainScene folds into a
tracked set). A label renders only for a person in that set. Preserve the current show-all behavior as a
**debug toggle** (the `debug.masterSwitch` overlay pattern the curbs/lanes/tile-depth overlays already
use — a keypress like the `T` throttle). This makes the inspected person's activity pop while the rest
of the street stays clean, and it shrinks the label-collision surface V6 otherwise has to fight.

### M2 · The definitive orphaned-sprite sweep → V8

**Validation: the tracer says the *known* leak classes are closed; the maintainer's fresh-game sighting
says finish the job.** `auditSprites` read **all-zero for 83 in-game hours** this session
(orphanControlledVehicles, occupiedDriverlessVehicles, visibleIndoorsPeople), so the W8 vehicle and
same-tick spawn/despawn fixes hold on the asset-boot path. But the maintainer sees, in fresh-game play,
**people standing dead-still at building entrances mid-action** ("visiting friends" at a doorway) — and
asks whether that is an orphaned sprite whose person entered the building.

Two mechanisms produce that exact picture, and they must be **distinguished, then both closed**:

1. **Not an orphan (the likely one):** the entrance-clustering of 2.3 — a real outdoor walker whose
   ambulatory leg *ended at a building's entrance point* and who is standing there between picks, plus
   the location-less social straggler of 3.6/M3 running "visiting friends" wherever the body happens to
   be (which, after a wander leg, is a doorway). This is a *behavior* bug (V2 + V9), not a sprite bug —
   the person is genuinely there.
2. **A true orphan (must be ruled out):** a sprite left visible after its person entered a building or
   was removed. My session never reproduced it, but the fresh-game boot path differs from the asset
   harness path, and the maintainer's judgment — *"we've been dealing with these for way too long"* — is
   the right call.

The deliverable: **a standing reconciliation invariant, enforced, not just observable.** `auditSprites`
already computes the counters; V8 (a) adds `orphanSprites` (a rendered person/vehicle sprite with no
live list entry — the class no counter names yet), (b) runs a per-minute scene-side reconciliation sweep
that destroys any sprite whose backing entity is gone or indoors (belt-and-suspenders over the W8
lifecycle fixes, the same posture as the orphan-vehicle sweep), and (c) **asserts all sprite invariants
zero in the integration suite** so a regression fails CI instead of a play session. The behavior half
(why a person is *legitimately* standing at a doorway) is V2/V9; this item guarantees that whenever the
sim says "indoors" or "gone," the sprite agrees — permanently.

### M3 · "Visiting friends" must be a two-sided scene in one building → V9

**Validation: correct — it's an un-migrated straggler, exactly as suspected.** `visiting_friends` is a
**continuous, free-time-weighted action with no `interaction` block, no target, and no location**
(`selection.weight 0.8`, `location: null`). It runs wherever the body is — which is why the maintainer
saw "Visiting friends" floating over a *business* building: the picker chose it, the body was near a
shop, and nothing binds it to a friend, a house, or a co-participant. `visiting_relatives` and
`hosting_gathering` share the shape (the latter "hosts a gathering" at home with no guests bound).

The intended design already exists as machinery (the aliveness proposal's D3 joint plans / the planner's
located `person:<id>` visits): a visit should **target a specific friend's house**, the friend should
run a **mirrored `hosting_a_friend_visit`** in that same building, and **both linked instances end
together**. The planner's located visit does part of this; the free-time variant bypasses all of it. The
fix is to route `visiting_friends` (and relatives) exclusively through the joint-plan path — pick a
real friend (social graph), resolve their home, install mirrored instances on both people, gate the
whole thing on the friend being available/home — and delete the location-less free-roll. The visitor
travels there (real commute), the host greets them, the co-located discrete children
(`chatted_with_friend`, `laughed_together`, `watched_tv_together`) fire *inside the house between the two
of them*, and the scene concludes on both sides at once.

### M4 · Sweep the corpus for other collective-action stragglers → V9

**Validation: correct — there are more, and the audit is mechanically findable.** A static sweep of the
337-action manifest turns up **27 actions whose id/label names a multi-person interaction but which
carry no `interaction` block**. Most are legitimately *discrete children* of a co-located continuous
wrapper (`laughed_together`, `chatted_with_friend`, `swapped_shift_gossip` — they inherit co-location
from their parent, so they need no contract of their own). But the **free-rolling continuous** ones are
the stragglers M3 names — `visiting_friends`, `visiting_relatives`, `hosting_gathering`,
`taking_a_walk_together` (the couple's walk, `location: outside` but with no partner bound) — and the
sweep must classify every one of the 27: *child-of-a-co-located-wrapper* (fine), *needs an interaction
contract* (fix), or *needs joint-plan linkage* (fix). Deliverable: a generated, diff-gated coverage
table (the 054/072 pattern — every social-semantics action is one of: contracted, a co-located child,
or a joint plan) plus a validator so a new free-rolling social action can't land. This is the same
audit posture the aliveness proposal's P1 promised; M3's finding shows it was only half-executed.

### M5 · A running speed, and running actions → V10

**Validation: correct — running is nominal only today.** `Person.speed` is a fixed `0.02` px/ms used for
all movement; the `ambulatory` kind an action authors (`'run' | 'jog' | 'stroll'`) is read by
`MainScene`/`City` to set the visible-wander flag but **never changes how fast the sprite moves**. So a
suspect "fleeing the police," a jogger, and someone on an evening stroll all move at identical speed —
the chase has no urgency in the pixels.

The fix: a per-kind speed table (walk / jog / run as multipliers of the base), applied in `Person.walk`'s
`maxStep` from the active action's `ambulatory` kind (the person already knows it via `setAmbulatory`;
widen it to carry the kind, or read the active instance's def). **Police run speed slightly above
civilian run** (a small authored premium) so a chase visibly closes rather than pacing forever. The
step-clamp (W8) already prevents overshoot at any speed, so this is safe under the throttle — but the
50× pass (M8) should re-confirm it with the higher speeds in play.

### M6 · Chases end on a real catch, not a timer → V10

**Validation: correct, and it compounds with 2.2.** The chase outcome is decided when the
`fleeing_the_police` action's **duration completes** — City resolves `chase_concluded` with "a
deterministic roll weighted by the suspect's age and health." The officer sprite never has to reach the
suspect. Worse, the "chase is on" test in `Pursuit.ts` uses `world.peopleAt({kind:'outside'})` — the
town-wide 'outside' room (2.2) — so **officer and suspect need only both be outdoors anywhere in town**
for the chase to run and resolve; they can be on opposite ends of the map.

The fix rides V2 and V10: once outdoor co-location is radius-scoped (V2), the chase resolves by
**physical proximity** — `got_caught` fires the tick an on-duty chasing officer's sprite is within a
catch radius of the fleeing suspect; `evaded_the_police` fires when the suspect breaks a
distance-or-time bound (outran the officer, whose slightly-lower run speed, M5, makes escape possible
but not easy). The deterministic roll is retired in favor of the geometry the chase already visually
implies — the outcome becomes *what the player sees happen*. (Bootstrap/logical worlds keep an abstract
resolution — no sprites off-map — the sanctioned seam, so the generator's crime chain is unaffected.)

### M7 · New games start at 09:00 → V11

**Validation: trivial and safe.** The `Clock` is `elapsedMs`, seeded `0` at new game → midnight. Seed it
with `9 × MS_PER_TICK` (9 in-game hours) at new-game init only (loads restore the saved elapsed). The
asset window rebases everyone's ticks to tick 0 and ages derive against the current tick, so a 9-tick
offset is immaterial to ages (8,640 ticks/year) and household composition (the draw reads
`getCurrentTick()`). The win is a town that opens **mid-morning, already awake and commuting**, instead
of a dead 3-real-minute midnight before anyone stirs — the first thing a new player sees.

### M8 · The speed ladder becomes 1× / 10× / 50×, verified → V11

**Validation: the change is one constant; the verification is the substance.** `TIME_SCALES` is
`[1, 4, 8]`; change to `[1, 10, 50]` (the HUD's three icons — play / double-chevron / triple-chevron —
map by index, unchanged). But 50× is **6.25× the current top speed**, and the concern is exactly right:
`effectiveFrameDelta` caps the raw delta at 100 ms then multiplies by scale, so a normal 16 ms frame
becomes **800 ms of sim per frame at 50×** (5 ms → 250 ms; a capped hitch → 5,000 ms). At that stride:

- **Walking advances one waypoint per `walk()` call** (`setNextTarget` fires once per frame), so a walker
  can only progress one curb segment per frame no matter how large the delta — at 50× the clock outruns
  the feet, so commutes eat more in-game time than authored (arrival-gated behavior degrades, the P0-5
  disease in a new form). The clamp prevents *overshoot*; it doesn't prevent *falling behind*.
- **The minute-cadence pumps** (`City.handleCommute`, `LiveWorld.pump`, wake drains) may see several
  in-game minutes elapse per frame — verify they process every crossed minute, not just the latest, or
  departures/arrivals get skipped.
- **The departure-jitter window** (`DEPART_JITTER_MINUTES = 15`) and minute-materialization (LP-11)
  collapse toward "all at once" if minutes are batched per frame.

The V11 pass: raise the per-frame movement budget so feet keep up with the clock at 50× (advance
multiple waypoints per frame when the delta warrants, still clamped per segment so no overshoot), make
every minute-cadence consumer loop over crossed minutes, and extend the W10 speed-invariance determinism
suite to assert **byte-equal state after identical tick counts at 1× / 10× / 50× and mixed schedules** —
the speed knob must stay invisible to the sim. This is the "make 50× play nice" work the maintainer
asked for, made concrete.

---

## Appendix — session numbers (the round-4 baseline)

Seed 20260719, 12 houses / 28 residents / 14 businesses (4 generic + bookstore, supermarket ×2,
construction site, auto repair, bakery, bar, beach + full civic set), booted from asset v137.0;
~83 in-game hours observed (ticks 7 → 90) at 1×/4×/8×, tracer active throughout.

- Sprite audit: **all zero, every sample**. Vehicles peaked at 4 concurrent; 0 orphans.
- Trace: 226,289 frames sampled; anomalies — overlap **1,039**, teleport 278 (**all**
  `exit-car → walk-to-destination` disembark syncs; zero bug-class), renderJump 13 (formation
  slot pops, logical ≈ 0 px / render 8–10 px), stuck 0.
- Car trips: 92 in ~3.5 days, 100% flagged outdoors-at-assignment; job applications ≈ car-hop
  rounds; zero-distance drive reproduced (enter/drive/exit same minute, same coordinates).
- Cross-map outdoor interactions: 6 (110–470 px apart), incl. `lent_an_object` at 386 px;
  two involved the 2-year-old.
- Employment: 6 by 10:00 day 1, 22 by 22:00 day 1, 28/28 adults by day 3; civic staffing incl.
  3 corrections officers (zero prisoners at the time) vs. 1 police officer.
- Morning simultaneity: 15/28 `taking_a_walk` at 07:00; evening: 11/28 `visiting_friends` at 22:00.
- Fire (forced, 19:47): 4/4 household members evacuated (2 not present in the building), ~6 h
  "Evacuating!" wandering, 1 resident returned to sleep inside the burning house, resolved
  ~01:00 "contained — heavy damage", family home by 01:53.
- Illness (forced serious, 02:31): grocery shopping 05:25 (hospital closed), first treatment 06:51,
  `resting_at_home_sick` 11:48; zero `was_treated_by_doctor` (nurse-only hospital).
- Justice (incident filed 20:15 with 2 witnesses): flee 08:47 next day (mid-`bake_cake`),
  chase → arrest → ride → `serving_time` by 10:31; first-observed offense sentenced to jail
  (record verification pending).
- Bulldoze (occupied, off-anchor click): all 9 cells cleared, occupant ejected to curb,
  `became_homeless` 15:19, then `spending_time_at_home` ×2 while homeless at the rubble.
