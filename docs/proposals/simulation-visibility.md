# Simulation Visibility — player control & physical grounding for the aliveness glue

**Status: proposal, v1 — the follow-up arc to `simulation-aliveness.md` (tasks 080–106), bundled into the
same PR. Tasks 107–118.** The aliveness arc built the glue: needs, edges, mood, habits, incidents,
detention, conditions, services, counterpart events, the chase. This arc does two things with it: puts the
**player's hands on the levers** (a real construction menu, civic buildings, a services nagbar), and
**grounds the glue physically** — venues resolve to real placed buildings, officers *drive* to crimes,
firefighters *arrive* at fires, the sick *go* to the hospital, garbage *leaves* the house, and groceries
come from *that* supermarket. Everything below follows the arc's standing rules: no content deleted, no
loose ends (every addition has intentionality, counterparts, and real impact), organic consequences only
(never hardcoded outcomes), determinism, and the live/bootstrap seam.

---

## Part 0 — Fit assessment: what already exists vs. what the brief asks

Verified against the shipped code (see per-task references):

| Brief item | Already built (aliveness arc) | Gap this arc closes |
|---|---|---|
| Police respond to crime | Pursuit hook: co-located officer ↔ wanted suspect both RUN (ambulatory, 099); conviction/fines/records; detention at station→jail preference (100); impunity is already organic (zero coverage → nothing resolves → the same desperation gates → reoffending; records make hiring harder) | Officers don't **dispatch** (drive from the station to the scene); arrest is a City roll, not a real counterpart action; no escort transport; no rides; sentences are flat; no family counterparts; jail visits deferred |
| Collective chases | **Already works**: every on-duty officer's hook fires independently — three officers co-located with a suspect all give chase | Shared rides to the scene (the "partners in one car" texture) |
| Fire response | Condition/ignition/evacuation/outcomes all real (102); firefighters rush (ambulatory) | The rush is generic street running, not travel **to the burning building**; outcomes read the coverage *ratio*, not who actually **arrived** |
| Hospitals matter | Healthcare coverage measurably speeds `recovered` and `lifted_spirits` (096); low health already raises mortality through the death event's gradient (032) — "severely sick die without a doctor" is **organic today** | Nobody *goes* to the hospital; doctors treat nobody as actions; no hospitalization/visit texture |
| Garbage | Street litter lifecycle (drop → collect) + the depot + collectors on visible rounds (101) | **Household** garbage production, house-to-curb-to-landfill flow |
| Market / food flow | Retail materialization (089): purchases convert real business stock, pantry→cooking→eating chains complete; shopping actions exist | `venue:*` has **no map backing in live mode** (`LiveWorld.targetBuilding` returns null for venues) — the single biggest gap; purchases still use documented `createObject` fallbacks in live play |
| Buildings exist | police_station, fire_station, hospital, jail, sanitation_depot (≡ Landfill), supermarket are all real blueprints with real staffed jobs | The **player cannot choose** what to place — `work` lots draw blueprints (demand-weighted since 097), so a town gets a police station only by luck |
| Pets walked visually | `walking_the_dog` exists: ambulatory (visible street walking), gated on ownership, morning-boosted, cooldown 20 ticks; daily `pet_care` routine | No pet **sprite** (the trailing rectangle); walk *pressure* is selection-weight only, not routine-anchored |
| Services warnings | Coverage ledger + dashboard panel + a monthly worst-gap feed advisory (096) | A persistent, prominent **nagbar** |

**Raises (things to know before/while executing):**

1. **Civic buildings can currently spawn randomly.** The 097 demand-weighted draw, 037 re-occupancy, and
   even entrepreneurship all draw from the full blueprint table — a generic work lot *can* become a police
   station today. The brief's `placementOnly` property is therefore not just UI plumbing but a real
   behavioral fix, and it must gate **all three** draw paths.
2. **"Landfill" ≡ `sanitation_depot`** (task 101). Keep the blueprint key (saves reference it), change the
   `friendlyName` to "Landfill" and use that label in the construction menu.
3. **"Prison" ≡ `jail`** (task 100). Same treatment. Detention already prefers the jail over the station,
   so placing one immediately upgrades the town's justice loop.
4. **The chase brief is an extension, not a revert.** Nothing built conflicts: dispatch-then-chase slots in
   front of the existing co-location trigger (which remains the "officer stumbles on the suspect" path).
5. **Vehicles concession accepted**: everything below uses the existing magic-spawn commute cars. Rides are
   *logical co-location* + one hidden sprite — the vehicle system itself is untouched.
6. **Generator perf debt (measured)**: the aliveness arc made each agent-step ~30× heavier (~1.5 ms vs the
   079 ~0.05 ms), making the default two-band regeneration a ~24 h run. Task 118 is the 078/079-style
   remedy; the full regen should follow it (a regeneration may be grinding in the background meanwhile).

---

## Part 1 — The tasks

### 107 — Venue grounding: `venue:*` resolves to real buildings (the foundation)

**Why first:** every integration task below needs people to physically arrive somewhere. Today
`LiveWorld.targetBuilding` returns `null` for `{kind:'venue'}` — venue actions run logically but nobody
walks anywhere in live play.

- **The map (data):** `json/venues.json` — venue kind → the blueprint keys that host it
  (`bar → [bar]`, `supermarket → [supermarket]`, `shop → [supermarket, clothing_store, …]`,
  `pet_shop → [pet_shop]`, `park → [park]`, …). Registered + validated both ways (every venue key used by
  an action's `location: venue:<kind>` must be mapped; every mapped blueprint exists). The generated
  sim-relationships doc gains a venue column.
- **Live resolution (code):** `LiveWorld.targetBuilding` resolves a venue to the **nearest placed, occupied
  business** whose blueprint is in the venue's list (deterministic tie-break by anchor key; distance from
  the person's current position). No matching building → the transition **cancels** and the instance blocks
  (typed, zero mutations — the person shrugs and picks something else next tick).
- **Selection guard (code, small):** a `venueAvailable` context check so free-time selection skips
  venue actions with no live host (no thrash-proposing unreachable trips). Bootstrap/logical worlds keep
  the abstract shared-venue semantics — the seam holds, no mode branches (the WorldAdapter answers).
- **Purchases become real where a shop stands:** with venues grounded, `purchaseObject` in live mode
  consumes the *hosting business's actual stock* (the 089 machinery already nets materialized sales into
  monthly P&L); the documented `createObject` purchase fallbacks remain **only** for venue kinds with no
  placed host. The conjuring-audit keep-list shrinks accordingly (a keep-list entry may only stay if its
  venue kind can be unhosted).
- **Tests:** venue→building resolution (nearest/deterministic/none), the blocked path, live shopping
  consuming real supermarket stock end-to-end, bootstrap equivalence untouched (arcScenarios still green).

### 108 — The construction menu & civic placement

- **Toolbar:** remove House and Work buttons; add one **Construction** button (tool + F-key). Fold **Soil
  and Bulldoze into a single Bulldoze** tool: any structure → grass, with the existing coherent logical
  teardown (`demolishHouse`/`demolishWorkplace` already handle residents/businesses; soil painting stays
  reachable as bulldozing empty ground — document that grass IS the empty state).
- **The construction window (React):** the Construction tool opens a window with a **grid of placeable
  buildings**: Residence, Business (the generic demand-weighted lot), Fire Station, Police Station,
  Hospital, Landfill, Prison, Supermarket. Selecting one arms the placement cursor; placing works exactly
  like today's house/work placement (road-adjacency rules unchanged). **Sprites: colored squares** for the
  civic set (red = Fire Station, blue = Police, white/cross = Hospital, brown = Landfill, gray = Prison,
  green = Supermarket) — flat tinted placeholder assets, no art pass.
- **Pinned blueprints (code, small):** `BuildEvent` (and the save's structure record — it already persists
  `business.blueprintKey`) carries an optional pinned key; `City.openBusiness` already accepts a
  `blueprintKey` override (built for 097 entrepreneurship) — a pinned placement instantiates exactly that
  business (size drawn as usual).
- **`placement: "civic"` on blueprints (data + validator):** civic blueprints (police_station,
  fire_station, hospital, jail, sanitation_depot… and any future ones) are excluded from the generic
  draw, 037 re-occupancy, **and** entrepreneurship. Validator: every civic blueprint must appear in the
  construction menu config (no unplaceable buildings), and vice versa.
- **Labels:** `sanitation_depot.friendlyName → "Landfill"`; jail already reads "County Jail".
- **Tests:** pinned placement instantiates the pinned business; civic keys never appear in 1,000 seeded
  generic draws / re-occupancies / foundings; bulldoze-folding keeps teardown coherent; menu config
  validator fixtures.

### 109 — Police, end to end: dispatch, the ride, the arrest, the sentence, the visits

The brief's task 1, refit onto what exists:

- **Dispatch (code + data):** a witnessed incident with an on-duty officer anywhere in town →
  the pursuit hook (extended) proposes `responding_to_incident` at obligation band with
  `locationOverride: building:<incident location>` (or the suspect's current building via the existing
  `person:` target) — the normal commute machinery **drives them there** from the station, visibly. On
  arrival, the existing co-location chase logic takes over unchanged (suspect flees, officer chases — both
  the stumble-upon path and the dispatch path converge on the same scene).
- **Shared rides (code + data, the one new interaction primitive):** `offered_a_ride` — an askFirst
  interaction (consent v2 scores it; partners/colleagues near-always accept). On consent the passenger is
  **logically co-moved** with the driver for the trip (their sprite hides, like entering a car today; one
  car moves). Officers responding to the same incident from the same station ride together (the hook binds
  a co-located on-duty colleague as passenger when both propose the same response). Civilian rides come
  free from the same primitive (a spouse driving their partner — planner texture, later).
- **The arrest is a real action (data + one wiring change):** on a *caught* chase outcome, instead of the
  City roll silently convicting, the officer performs `arrested_suspect` (person-targeted, covert=false,
  no-consent hostile posture like `argued_with_person`) whose counterpart lands **`was_arrested`** on the
  criminal (C1 machinery, same causation seq). City's conviction bookkeeping (case closed, record) keys off
  that commit. The evaded path stays as-is.
- **Escort & sentencing (code + data):** the arrested suspect is co-moved (the ride primitive) to the
  **station first**, then transferred to the **prison** if one stands (else serves the short stopgap at the
  station — the 100 rule, unchanged). **Sentences scale with the record** (data:
  `json/justice.json` — first conviction: fine only; second: weeks; repeat within the window: months; the
  numbers are tunables). All served time runs the existing lived detention (serving_time, releases).
- **Family counterparts (data + City fan-out):** `was_arrested` fans out `relative_arrested` (valence −2)
  to spouse/parents/children via the same kinship fan-out `became_widowed` milestones use. Mood and the
  depression hazard react through the normal valence machinery — nothing scripted.
- **Jail visits (data + planner):** `visited_person_in_jail` (the 100 deferral) — the planner's located
  visit (085 machinery) targets the facility when a close relative/friend is detained; both sides log
  (`visited_person_in_jail` / `received_a_visitor`, C1). Satisfies `social` for both.
- **Impunity (data):** an incident going **cold unresolved** fires `got_away_with_it` on the suspect
  (valence +1, manual — City invokes it from the cold sweep when the suspect is known-to-self). Crime
  actions gain `habit: 'crime'` — getting away **practices the habit**, raising the criminal's own
  selection weight (the 095 escalation loop, reused verbatim). A town without police literally *teaches*
  crime. Conversely a conviction's long gap cools it closed-form.
- **Tests:** dispatch travel (live harness: officer at station, crime across town, car trip, arrival,
  chase), the ride co-move + consent, arrest counterparts + family fan-out, scaled sentences, the visit
  loop, impunity practicing the habit, cold-case → got_away_with_it.

### 110 — Fire, end to end: driving to the fire, arrival-scaled outcomes

- **Dispatch:** on ignition, on-duty firefighters get `responding_to_fire` with `locationOverride` to the
  burning building — they drive/run there (same seam as 109). The generic `rushing_to_the_fire` becomes the
  final ambulatory leg / the no-station fallback texture.
- **Arrival matters (the organic consequence):** `resolveFires` counts **firefighters physically at the
  building** at resolution and blends it with the coverage ratio: `effectiveResponse = coverage ×
  arrivalFactor` (0 arrived → the baseline burn-down odds regardless of what the ledger claims; a full crew
  on scene pushes toward extinguished). No station, nobody on shift, or the crew stuck across town → the
  building burns — never hardcoded, always the measured path.
- **The injured meet task 111:** occupants injured at resolution become `seeking_treatment` candidates.
- **Tests:** dispatch arrival; outcome distribution with crew-on-scene vs. absent (same coverage);
  no-station towns burn at baseline; the 102 suite untouched.

### 111 — Hospitals, end to end: treatment as lived behavior

- **Seeking treatment (data + needs/planner):** while `health < 0.5`, a `seeking_treatment` intent
  (need band, urgency-scaled) sends the person to the hospital venue **if one is placed** (107 grounding);
  there they run `receiving_treatment` (continuous). No hospital → they stay home resting (the 092
  behavior, unchanged) — and keep the slower ledger-only recovery.
- **Doctors treat (data):** on-duty doctors' work repertoire gains `treating_patient` — a person-targeted
  interaction bound to a co-located patient-in-treatment (the return-side coherence pattern from 074),
  counterparts `treated_a_patient` / **`was_treated_by_doctor`** (valence +1).
- **Treatment speeds recovery organically (code, one attribute):** a new `recentlyTreated` context
  attribute (a `was_treated_by_doctor` within N ticks read, like `jobApplications`) joins `recovered`'s
  factor list (×1 untreated — the status quo — up to ×2 treated). The coverage factor stays (system-level
  care quality); treatment is the personal multiplier on top. **Death already reads low health** (the
  mortality gradient), so prolonged untreated severe illness killing more people is emergent arithmetic:
  slower recovery → longer at low health → more death-hazard exposure. The test pins that chain.
- **Visiting the sick (data + planner):** `visited_sick_relative` — the planner's located visit when a
  close relative's health is low, both sides logged, `social` satisfied; the visitor's presence feeds the
  patient's mood (valence +1) which feeds `lifted_spirits` — the 095 social-support loop, now physical.
- **Tests:** the sick travel to a placed hospital and not to an empty lot; treatment factor on recovery
  (cohort test, the jobSeeking pattern); the untreated-mortality chain (severe cohort with vs. without a
  hospital over a seeded year — strictly more deaths without); visit loop.

### 112 — Household garbage: produce, take out, collect, dispose

- **Production (data):** meal/kitchen discretes (`cleaned_up_after`, cooking children) get a low-chance
  `filled_the_trash_bag` child creating a `trash_bag` instance (archetype exists) at the home. Honest
  source: garbage comes from living.
- **Taking it out (data):** `took_out_the_trash` — a maintenance discrete (home, requires a trash_bag at
  home) moving the bag to the person's *outside* location (the curb). Selection: boosted when bags
  accumulate (`objectAtLocation` modifier, the 101 pattern); a routine (`trash_day`, cadence 2–3 days)
  anchors it.
- **Collection (extend 101):** the collectors' `collection_rounds` gain a `collected_the_trash` child
  consuming curb `trash_bag`s (alongside the wrapper/butt children). Rounds already walk the streets.
- **The failure mode is visible, organic:** no landfill/collectors → bags pile at curbs (real instances on
  the map), the cleaning/mood modifiers react (the 101 dampeners), and the services nagbar (114) names it.
- **Tests:** the full loop home→curb→collected; accumulation without a depot; routine cadence.

### 113 — The market, end to end (mostly 107's payoff, verified)

- With venues grounded: `shopping_trip`/`went_grocery_shopping` walk to the **placed supermarket**, buy
  **its actual stock** (produced by its own staff via the 053 production recipes, restocked under the 089
  ceilings), carry groceries home to the pantry, cook, eat. The whole F-chain becomes street-visible.
- **Work in this task:** retire the grocery-class purchase fallbacks in live-hosted worlds; ensure venue
  stock queries match what production creates (archetype coverage audit — every shopping list item is
  produced or stocked by the supermarket's recipes; extend recipes where honest gaps exist); a live-mode
  end-to-end test: place supermarket + house, watch a person shop real stock and `bake_cake` **complete in
  live play** (the Part 0 audit's 206/206-blocked flagship, closed on the map).

### 114 — The services nagbar

- A persistent, dismissable **nagbar** (React, top of screen) when any `CityServices` line with a facility
  requirement sits below its warning threshold: "Your town has no hospital — the sick recover slowly."
  Click → a **Services window**: the 096 dashboard panel promoted to its own window with per-service rows
  (ratio, providers, facilities, and *what to build* — linking the construction menu's item). Data-driven
  copy (`json/services.json` gains `warning` strings, validated). The monthly feed advisory stays (history);
  the nagbar is the live surface. Reappears when a NEW service degrades (dismissal is per-service-state).
- **Tests:** stats plumbing (nagbar payload derives from `latest()`); threshold crossing shows/clears.

### 115 — Pets on the street

- `walking_the_dog` already walks the owner visibly; add the **pet sprite**: a tiny brown rectangle
  trailing the owner's sprite while the action runs (MainScene overlay, the activity-bubble pattern from
  093 — follows in `redraw`, despawns with the instance). No pathfinding of its own; it shadows the owner
  with a 4–6 px offset.
- **Walk pressure:** a `dog_walk` routine (cadence 1 day, morning/evening windows, `petCount ≥ 1`) so
  owners *reliably* walk — with the neglect texture for free: a depressed owner's dampened walks simply
  happen less (already wired in 103).
- **Tests:** routine proposal for owners; sprite lifecycle via the integration harness (browser suite,
  non-blocking).

### 116 — Fire particles

- MainScene: a basic Phaser **particle emitter** (small orange/red flames + drifting smoke tint, built-in
  textures, nothing fancy) anchored on any building whose key has an open `fire` incident; created on
  ignition, destroyed on resolution (a `fireStateChanged`-style bus event from City, or the scene polling
  incidents each in-game minute — prefer the bus event per §4.2/§5.5). Burned-down lots need no residue
  (the structure is gone).
- **Tests:** the bus event payloads (unit); visuals via the browser suite.

### 117 — The observation & balancing pass (the payoff session)

- **Scaffolding first (small, debug-gated):** a time-throttle debug key (e.g. `T` cycles 1×/4×/16× —
  multiply the clock's advance delta; debug.masterSwitch-gated like the other overlays), plus a debug
  overlay line (people count / employed / open incidents / worst service). The Playwright harness's
  `stepTicks` already covers scripted observation; this is for the human session.
- **The session:** new game → place roads, houses, the civic set, a supermarket → watch: job seeking →
  hires, commutes, venue trips, gossip circles, chases, dog walks; inspect inventories (carry caps
  holding?), person logs (rhythm? counterparts?), the services panel. **Deliverable: a balancing-notes
  document** (`docs/proposals/visibility-balancing-notes.md`) with observed issues ranked, plus immediate
  small tunings applied (rates/weights only — structural findings become proposed follow-ups).

### 118 — Generator perf pass (the regeneration unblock)

- Measured: ~1.5 ms/agent-step post-aliveness (~30× the 079 baseline) → the default two-band regen is
  ~24 h. The 078/079 playbook: `--profile` + `--cpu-prof` the new hot paths — prime suspects are the
  free-time loop's per-candidate market reads (needs/traits/habits multiply per candidate per person per
  tick → memoize per (person, tick) like the 079 free-time memo), the witness/reaction passes, and the
  pursuit/evacuation hooks' peopleAt scans (gate before query, the 079 social-hook lesson). Byte-identity
  is NOT required (streams already moved this arc) but determinism is. Target: ≤0.15 ms/agent-step
  (regen ≈ 2–3 h). Then run the one full regeneration (the 105 plan) and re-measure the Part 0 numbers
  (the 106 decode pass) as the arc's closing evidence.

---

## Part 2 — Sequencing & dependencies

```text
107 venue grounding ──► 109 police ──► 110 fire ──► 111 hospital
        │                    ▲
        ▼                    │
108 construction UI ─────────┘ (civic buildings must be placeable before dispatch matters)
        │
        ▼
112 garbage ── 113 market (107's payoff) ── 114 nagbar ── 115 pets ── 116 particles
                                                                          │
118 generator perf ──► the one full regeneration                          ▼
                                                              117 observation & balancing
```

107 and 108 first (everything physical depends on them); 109–113 in order (each reuses the previous's
seams — dispatch, rides, arrival-counting); 114–116 are independent polish; 117 last (it observes
everything); 118 runs parallel to any of it and gates only the final asset regeneration.

## Part 3 — Standing rules (inherited, restated)

Organic consequences only — every "town lacks X" outcome must be the measured path (arrival counts,
coverage factors, habit escalation), never a scripted penalty. Every new action/event carries counterparts,
valence, and a consumer (the no-loose-ends rule); every new schema field registers with validators and
invalid fixtures in the same task; every serialized addition is v16-family additive with a deterministic
backfill; the live/bootstrap seam takes no mode branches (venue grounding lives entirely in the
WorldAdapter); and the perf op-count gates re-pin consciously per task.
