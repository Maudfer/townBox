# Simulation relationships (generated)

> **GENERATED — do not edit by hand.** Derived from `src/json/actions.json`, `src/json/events.json`
> and `src/json/object-action-relationships.json` by `util/simulationDocs.ts`. The checked-diff test
> (`test/util/simulationDocs.test.ts`) fails when this file no longer matches the shipped data; regenerate
> with `npm run docs:sim`. The narrative companion is the "Simulation flows" section of [CLAUDE.md](../../CLAUDE.md) §4.13.

## Scale

| Manifest | Entries | Notes |
|---|---|---|
| `actions.json` | 314 | 96 continuous / 218 discrete |
| `events.json` | 741 | 168 probabilistic, 368 probabilistic + manual, 202 manual, 3 manual + automated |
| `object-action-relationships.json` | 38 | first-satisfiable entry per action commit |

## Action → Event (lifecycle links)

Lifecycle transitions fire the declared manual Events through `EventEngine.invoke` (`triggerSource: 'action'`, causation = the lifecycle log entry). Actions sharing one signature are grouped.

| Actions | Lifecycle → Event |
|---|---|
| `attending_customers`, `working_the_register`, `doing_paperwork`, `doing_rounds`, `working_the_kitchen`, `doing_manual_labor`, `teaching_class`, `fixing_equipment`, `keeping_watch`, `cleaning_premises`, `driving_route`, `treating_patients`, `styling_clients`, `coaching_session`, `drafting_designs`, `screening_film`, `balancing_the_till`, `prepping_ingredients`, `restocking_shelves`, `reviewing_charts`, `grading_papers`, `patrolling_the_floor`, `mixing_batter`, `servicing_a_vehicle`, `drawing_blueprints`, `leading_a_workout`, `checking_in_guests`, `projecting_the_matinee`, `sorting_deliveries`, `updating_ledgers`, `sterilizing_equipment`, `shelving_returns`, `wiping_down_tables`, `pruning_displays`, `counting_inventory`, `supervising_the_team`, `patrolling`, `chasing_a_suspect`, `collection_rounds`, `rushing_to_the_fire`, `responding_to_fire`, `responding_to_incident` | onStart → `started_working`<br>onComplete → `stopped_working`<br>onInterrupt → `stopped_working` |
| `adopted_a_pet` | onComplete → `adopted_a_pet` |
| `applied_for_a_job` | onComplete → `get_job` |
| `attend_school` | onStart → `school_day_started`<br>onComplete → `completed_school_day` |
| `cleaning_house` | onComplete → `decluttered_house` |
| `cooking_meal` | onComplete → `tried_new_recipe` |
| `evacuating` | onComplete → `escaped_a_fire` |
| `fleeing_the_police` | onComplete → `chase_concluded` |
| `found_coin` | onComplete → `found_money_on_street` |
| `gardening` | onComplete → `planted_garden` |
| `gave_object_to_person` | onComplete → `gave_gift` |
| `hosting_gathering` | onComplete → `hosted_dinner_party` |
| `pickpocketed_someone` | onComplete → `committed_pickpocketing`<br>onCompleteTarget → `got_pickpocketed` |
| `pocketed_merchandise` | onComplete → `committed_shoplifting` |
| `read_book` | onComplete → `finished_great_book` |
| `resting_at_home_sick` | onStart → `called_in_sick` |
| `shared_gossip` | onCompleteTarget → `heard_gossip` |
| `shopping_trip` | onComplete → `went_grocery_shopping` |
| `sleep` | onComplete → `woke_up` |
| `treating_patient` | onComplete → `treated_a_patient`<br>onCompleteTarget → `was_treated_by_doctor` |
| `visiting_relatives` | onComplete → `reconnected_with_relative` |

## Action → Event (consequence ops)

*No shipped action currently uses `triggerEvent`/`scheduleEvent` consequence ops (the DSL supports both; engine tests cover them).*

## Event ← sources (reverse map)

Every event referenced by an action, with its trigger mix and limit. All manual invocation today is data-driven — the only `EventEngine.invoke` call sites are the action lifecycle (`ActionEngine.fireEvent`) and the consequence executor (`Consequences`).

| Event | Triggers | Limit | Invoked by |
|---|---|---|---|
| `adopted_a_pet` | manual | — | `adopted_a_pet`.onComplete (discrete) |
| `called_in_sick` | manual | once: perDay | `resting_at_home_sick`.onStart (continuous) |
| `chase_concluded` | manual | — | `fleeing_the_police`.onComplete (continuous) |
| `committed_pickpocketing` | manual | — | `pickpocketed_someone`.onComplete (discrete) |
| `committed_shoplifting` | manual | — | `pocketed_merchandise`.onComplete (discrete) |
| `completed_school_day` | manual + automated | once: perDay | `attend_school`.onComplete (continuous) |
| `decluttered_house` | probabilistic + manual | cooldown 360 ticks | `cleaning_house`.onComplete (continuous) |
| `escaped_a_fire` | manual | — | `evacuating`.onComplete (continuous) |
| `finished_great_book` | probabilistic + manual | cooldown 360 ticks | `read_book`.onComplete (continuous) |
| `found_money_on_street` | probabilistic + manual | cooldown 720 ticks | `found_coin`.onComplete (discrete) |
| `gave_gift` | manual | cooldown 240 ticks | `gave_object_to_person`.onComplete (discrete) |
| `get_job` | probabilistic + manual | — | `applied_for_a_job`.onComplete (discrete) |
| `got_pickpocketed` | manual | — | `pickpocketed_someone`.onCompleteTarget (discrete) |
| `heard_gossip` | manual | — | `shared_gossip`.onCompleteTarget (discrete) |
| `hosted_dinner_party` | probabilistic + manual | cooldown 240 ticks | `hosting_gathering`.onComplete (continuous) |
| `planted_garden` | probabilistic + manual | cooldown 1440 ticks | `gardening`.onComplete (continuous) |
| `reconnected_with_relative` | probabilistic + manual | cooldown 720 ticks | `visiting_relatives`.onComplete (continuous) |
| `school_day_started` | manual | once: perDay | `attend_school`.onStart (continuous) |
| `started_working` | manual | once: perDay | `attending_customers`.onStart (continuous)<br>`working_the_register`.onStart (continuous)<br>`doing_paperwork`.onStart (continuous)<br>… 39 more |
| `stopped_working` | manual + automated | once: perDay | `attending_customers`.onComplete (continuous)<br>`attending_customers`.onInterrupt (continuous)<br>`working_the_register`.onComplete (continuous)<br>… 81 more |
| `treated_a_patient` | manual | — | `treating_patient`.onComplete (continuous) |
| `tried_new_recipe` | probabilistic + manual | cooldown 168 ticks | `cooking_meal`.onComplete (continuous) |
| `was_treated_by_doctor` | manual | — | `treating_patient`.onCompleteTarget (continuous) |
| `went_grocery_shopping` | probabilistic + manual | cooldown 168 ticks | `shopping_trip`.onComplete (continuous) |
| `woke_up` | manual | once: perDay | `sleep`.onComplete (continuous) |

Of the 573 manual-triggered events, 548 have no action source yet — they are invokable texture (052) reserved for future action links and system callers; the rest of their trigger mix (probabilistic rolls) still runs them.

## Automated schedule rules

| Event | Rules | Limit |
|---|---|---|
| `stopped_working` | afterEvent `started_working` +12 ticks | once: perDay |
| `gave_birth` | afterEvent `pregnancy` +6480 ticks | — |
| `completed_school_day` | afterEvent `school_day_started` +8 ticks | once: perDay |

## Trigger & limit breakdown

| Trigger mix | Events |
|---|---|
| probabilistic + manual | 368 |
| manual | 202 |
| probabilistic | 168 |
| manual + automated | 3 |

| Occurrence limit | Events |
|---|---|
| cooldown window | 630 |
| — | 51 |
| once: ever | 50 |
| once: perDay | 10 |

## Object-action transformations

At commit, the FIRST satisfiable entry (declaration order) for the action applies; inputs match the person's carried instances. `required` inputs must be present but survive; `transformed` inputs preserve instance identity.

| Entry | Action | Inputs | Outputs | Context |
|---|---|---|---|---|
| `mix_dough_from_ingredients` | `mix_dough` | 1× `flour_bag` (consumed)<br>2× `egg` (consumed) | 1× `raw_dough` | — |
| `bake_dough_in_oven` | `bake_dough` | 1× `raw_dough` (transformed) → `baked_dough` | — | at location: `{"archetype":"oven"}` |
| `top_dough_into_cake` | `add_topping` | 1× `baked_dough` (transformed) → `cake`<br>1× `cream_jar` (consumed) | — | — |
| `tossed_a_fresh_salad` | `plated_the_meal` | 1× `lettuce` (consumed)<br>1× `tomato` (consumed) | 2× `caesar_salad` | — |
| `roasted_a_hearty_dinner` | `plated_the_meal` | 2× `potato` (consumed)<br>1× `onion` (consumed) | 2× `meatloaf_slice` | — |
| `grilled_garlic_bread` | `plated_the_meal` | 1× `bread_loaf` (consumed)<br>1× `butter_stick` (consumed) | 2× `garlic_bread` | — |
| `packed_cheese_sandwiches` | `packed_a_lunch` | 1× `bread_loaf` (consumed)<br>1× `cheese_wedge` (consumed) | 2× `sandwich` | — |
| `packed_pb_sandwiches` | `packed_a_lunch` | 1× `bread_loaf` (consumed)<br>1× `butter_stick` (consumed) | 2× `peanut_butter_sandwich` | — |
| `ate_sandwich` | `ate_a_meal` | 1× `sandwich` (consumed) | — | — |
| `ate_peanut_butter_sandwich` | `ate_a_meal` | 1× `peanut_butter_sandwich` (consumed) | — | — |
| `ate_caesar_salad` | `ate_a_meal` | 1× `caesar_salad` (consumed) | — | — |
| `ate_meatloaf_slice` | `ate_a_meal` | 1× `meatloaf_slice` (consumed) | — | — |
| `ate_garlic_bread` | `ate_a_meal` | 1× `garlic_bread` (consumed) | — | — |
| `ate_grilled_steak` | `ate_a_meal` | 1× `grilled_steak` (consumed) | — | — |
| `ate_bread_loaf` | `ate_a_meal` | 1× `bread_loaf` (consumed) | — | — |
| `sliced_cake_for_guests` | `sliced_the_cake` | 1× `cake` (consumed) | 6× `cake_slice` | — |
| `baked_loaf_in_oven` | `baked_bread_loaf` | 1× `raw_dough` (transformed) → `bread_loaf` | — | at location: `{"archetype":"oven"}` |
| `fixed_a_broken_wristwatch` | `repaired_an_item` | 1× `wristwatch`{condition: broken} (transformed) → `wristwatch`<br>1× `toolbox` (required) | — | — |
| `fixed_a_broken_toy_car` | `repaired_an_item` | 1× `toy_car`{condition: broken} (transformed) → `toy_car`<br>1× `toolbox` (required) | — | — |
| `fixed_a_broken_umbrella` | `repaired_an_item` | 1× `umbrella`{condition: broken} (transformed) → `umbrella`<br>1× `toolbox` (required) | — | — |
| `scrubbed_with_supplies` | `deep_cleaned_the_kitchen` | 1× `detergent_pod` (consumed)<br>1× `sponge` (required) | — | — |
| `wrapped_gift_with_supplies` | `wrapped_a_gift` | 1× `wrapping_paper` (consumed)<br>1× `gift_bow` (consumed) | — | — |
| `bakery_bread_batch` | `baked_a_batch_of_bread` | — | 4× `bread_loaf`, owner: employer | — |
| `bakery_display_cake` | `frosted_a_display_cake` | — | 1× `cake`, owner: employer | — |
| `workshop_crate` | `assembled_a_crate` | — | 1× `wooden_crate`, owner: employer | — |
| `workshop_planks` | `milled_some_planks` | — | 4× `wood_plank`, owner: employer | — |
| `packed_parcel_for_shipping` | `taped_up_a_box` | — | 1× `parcel`, owner: employer | — |
| `kitchen_customer_order` | `plated_a_customer_order` | — | 1× `grilled_steak`, owner: employer | — |
| `supermarket_restock` | `stocked_the_shelves` | — | 4× `egg`, owner: employer<br>2× `bread_loaf`, owner: employer<br>2× `milk_carton`, owner: employer<br>2× `tomato`, owner: employer<br>1× `lettuce`, owner: employer<br>2× `potato`, owner: employer<br>1× `onion`, owner: employer<br>1× `flour_bag`, owner: employer<br>1× `butter_stick`, owner: employer<br>1× `cheese_wedge`, owner: employer | — |
| `ate_meal_from_loaf` | `ate_a_meal` | 1× `bread_loaf` (consumed) | — | — |
| `ate_meal_from_eggs` | `ate_a_meal` | 2× `egg` (consumed) | — | — |
| `ate_meal_from_salad` | `ate_a_meal` | 1× `tomato` (consumed)<br>1× `lettuce` (consumed) | — | — |
| `ate_meal_from_potatoes` | `ate_a_meal` | 2× `potato` (consumed) | — | — |
| `ate_meal_from_pasta` | `ate_a_meal` | 1× `pasta_box` (consumed) | — | — |
| `ate_meal_from_fruit` | `ate_a_meal` | 1× `apple` (consumed) | — | — |
| `served_family_from_staples` | `served_the_family` | 2× `egg` (consumed)<br>1× `tomato` (consumed) | — | — |
| `served_family_from_loaf` | `served_the_family` | 1× `bread_loaf` (consumed) | — | — |
| `served_family_from_potatoes` | `served_the_family` | 2× `potato` (consumed)<br>1× `onion` (consumed) | — | — |

## Interaction contracts (person-targeted actions)

Every action with a `person` parameter carries a contract (072); `askFirst` routes consent through the target (073); decline events are curated, not universal (074). All require same-building co-location this iteration.

| Action | Consent | onDecline | Decline event | Selection |
|---|---|---|---|---|
| `apologized_to_person` | no consent | — | — | w 0.15, cd 24 |
| `argued_with_person` | no consent | — | — | w 0.15, cd 24 |
| `asked_for_advice` | no consent | — | — | w 0.4, cd 12 |
| `asked_for_help` | no consent | — | — | w 0.4, cd 12 |
| `asked_person_out` | ask first | skipStep | — | w 0.15, cd 168 |
| `celebrated_with_person` | no consent | — | — | w 0.3, cd 24 |
| `complimented_person` | no consent | — | — | w 0.6, cd 8 |
| `consoled_person` | no consent | — | — | w 0.2, cd 24 |
| `gave_object_to_person` | ask first | failParent | `action_declined` | w 0.12, cd 72 |
| `greeted_person` | no consent | — | — | w 1.5, cd 2 |
| `hugged_person` | ask first | skipStep | — | w 0.6, cd 8 |
| `invite_to_activity` | ask first | skipStep | — | w 0.3, cd 48 |
| `invited_person_over` | ask first | skipStep | — | w 0.2, cd 48 |
| `kissed_partner` | ask first | skipStep | — | w 0.8, cd 6 |
| `lent_an_object` | ask first | failParent | `action_declined` | w 0.2, cd 48 |
| `offered_job_lead` | no consent | — | — | w 0.1, cd 48 |
| `pickpocketed_someone` | no consent | — | — | w 0.02, cd 120 |
| `played_with_person` | no consent | — | — | w 0.5, cd 8 |
| `proposed_marriage` | ask first | skipStep | — | w 0.08, cd 720 |
| `returned_borrowed_object` | ask first | failParent | — | w 3, cd 12 |
| `shared_food_with_person` | ask first | failParent | — | w 0.4, cd 12 |
| `shared_gossip` | no consent | — | — | w 0.5, cd 12 |
| `talked_to_person` | no consent | — | — | w 1.2, cd 2 |
| `taught_person_something` | ask first | skipStep | — | w 0.25, cd 24 |
| `thanked_person` | no consent | — | — | w 0.2, cd 4 |
| `told_a_joke` | no consent | — | — | w 0.7, cd 6 |
| `treating_patient` | no consent | — | — | w 0 |

## Skills (dependency DAG summary)

335 skills — 15 basics, 320 specific abilities gated by the dependency DAG (059–062). School lands every basic at 60 by 18 (perfect attendance); the band above 60 is career/talent territory.

| Basic skill | Direct dependents |
|---|---|
| `art` | 0 |
| `biology` | 0 |
| `chemistry` | 0 |
| `civics` | 0 |
| `digital_literacy` | 0 |
| `geography` | 0 |
| `history` | 0 |
| `math` | 0 |
| `music` | 0 |
| `physical_coordination` | 0 |
| `physics` | 0 |
| `problem_solving` | 0 |
| `reading` | 0 |
| `speaking` | 0 |
| `writing` | 0 |

## Job rank ladders

Every job carries a full authored ladder (064/066) with an explicit entry-rank training grant (the temporary College shortcut, applied atomically ONLY inside a successful hire) and a deterministic promotion cadence; the self-climbing rule (CI-enforced) guarantees no ladder silently stalls.

| Job | Ladder | Entry grant | Promotion cadence |
|---|---|---|---|
| `accountant` | Trainee Accountant → Accountant → Senior Accountant → Controller | 2 skills | every 30 work days |
| `architect` | Trainee Architect → Architect → Senior Architect → Principal Architect | 3 skills | every 30 work days |
| `baker` | Trainee Baker → Baker → Master Baker | 2 skills | every 30 work days |
| `bank_teller` | Trainee Bank Teller → Bank Teller → Head Teller | 2 skills | every 30 work days |
| `barista` | Trainee Barista → Barista → Head Barista | 2 skills | every 30 work days |
| `beautician` | Trainee Beautician → Beautician → Senior Beautician | 2 skills | every 30 work days |
| `checkout_clerk` | Trainee Checkout Clerk → Checkout Clerk → Head Cashier | 2 skills | every 30 work days |
| `concierge` | Trainee Concierge → Concierge → Head Concierge | 2 skills | every 30 work days |
| `cook` | Trainee Cook → Line Cook → Head Cook | 2 skills | every 30 work days |
| `corrections_officer` | Trainee Corrections Officer → Corrections Officer → Shift Supervisor | 2 skills | every 30 work days |
| `delivery_driver` | Trainee Delivery Driver → Delivery Driver → Route Supervisor | 2 skills | every 30 work days |
| `doctor` | Trainee Doctor → Resident → Attending Physician → Senior Physician | 4 skills | every 30 work days |
| `electronics_technician` | Trainee Electronics Technician → Technician → Senior Technician | 2 skills | every 30 work days |
| `engineer` | Trainee Engineer → Engineer → Senior Engineer → Principal Engineer | 2 skills | every 30 work days |
| `firefighter` | Probationary Firefighter → Firefighter → Fire Lieutenant | 2 skills | every 30 work days |
| `fitness_trainer` | Trainee Fitness Trainer → Fitness Trainer → Head Trainer | 2 skills | every 30 work days |
| `garbage_collector` | Collection Crew → Route Collector → Route Supervisor | 2 skills | every 30 work days |
| `hairdresser` | Trainee Hairdresser → Hair Stylist → Salon Stylist | 2 skills | every 30 work days |
| `hardware_clerk` | Trainee Hardware Clerk → Hardware Clerk → Floor Supervisor | 2 skills | every 30 work days |
| `housekeeper` | Trainee Housekeeper → Housekeeper → Head Housekeeper | 2 skills | every 30 work days |
| `janitor` | Trainee Janitor → Janitor → Head Custodian | 2 skills | every 30 work days |
| `laborer` | Trainee Laborer → Construction Worker → Site Foreman | 2 skills | every 30 work days |
| `manager` | Trainee Manager → Manager → General Manager | 2 skills | every 30 work days |
| `mechanic` | Trainee Mechanic → Mechanic → Master Mechanic | 2 skills | every 30 work days |
| `nurse` | Trainee Nurse → Nurse → Charge Nurse → Nurse Practitioner | 2 skills | every 30 work days |
| `pharmacist` | Trainee Pharmacist → Pharmacist → Senior Pharmacist → Chief Pharmacist | 2 skills | every 30 work days |
| `police_officer` | Patrol Officer → Sergeant → Lieutenant | 2 skills | every 30 work days |
| `projectionist` | Trainee Projectionist → Projectionist → Chief Projectionist | 2 skills | every 30 work days |
| `receptionist` | Trainee Receptionist → Receptionist → Front Desk Manager | 2 skills | every 30 work days |
| `restocker` | Trainee Restocker → Restocker → Warehouse Lead | 2 skills | every 30 work days |
| `sales_associate` | Trainee Sales Associate → Sales Associate → Senior Sales Associate | 2 skills | every 30 work days |
| `security_guard` | Trainee Security Guard → Security Guard → Security Supervisor | 2 skills | every 30 work days |
| `service_advisor` | Trainee Service Advisor → Service Advisor → Senior Advisor | 2 skills | every 30 work days |
| `teacher` | Trainee Teacher → Teacher → Senior Teacher → Head Teacher | 3 skills | every 30 work days |
| `ticket_clerk` | Trainee Ticket Clerk → Ticket Clerk → Box Office Lead | 2 skills | every 30 work days |
| `usher` | Trainee Usher → Usher → Head Usher | 2 skills | every 30 work days |
| `waiter` | Trainee Waiter → Waiter → Head Waiter | 2 skills | every 30 work days |

## Placement tags (context vocabulary)

The controlled vocabulary (069): tags mean "this environmental context exists here" — rooms are never simulated. `building`-scoped tags drive object generation (070); `deferred` tags await the venue model.

| Tag | Scope | Archetypes | Buildings |
|---|---|---|---|
| `art-studio` | building | 27 | 1 |
| `attic-basement` | building | 27 | 1 |
| `auto-repair-shop` | building | 31 | 1 |
| `backyard-garden` | building | 34 | 2 |
| `bakery` | building | 31 | 1 |
| `bank` | building | 28 | 1 |
| `bar` | building | 31 | 1 |
| `bathroom` | building | 32 | 1 |
| `beach` | building | 27 | 1 |
| `bedroom` | building | 34 | 1 |
| `bookstore` | building | 27 | 1 |
| `bus-stop` | building | 24 | 1 |
| `cafe` | building | 31 | 1 |
| `campsite` | building | 33 | 1 |
| `cemetery` | building | 24 | 1 |
| `church` | building | 27 | 1 |
| `cinema` | building | 27 | 1 |
| `classroom` | building | 29 | 1 |
| `clothing-store` | building | 31 | 1 |
| `construction-site` | building | 31 | 1 |
| `dentist-office` | building | 28 | 1 |
| `electronics-store` | building | 29 | 1 |
| `factory` | building | 26 | 1 |
| `farm` | building | 31 | 1 |
| `fire-station` | building | 24 | 1 |
| `fishing-pier` | building | 26 | 1 |
| `garage` | building | 33 | 3 |
| `gym` | building | 30 | 1 |
| `hair-salon` | building | 31 | 1 |
| `hardware-store` | building | 32 | 1 |
| `hospital` | building | 30 | 2 |
| `hotel-room` | building | 27 | 1 |
| `kitchen` | building | 50 | 4 |
| `laundromat` | building | 26 | 1 |
| `library` | building | 28 | 1 |
| `living-room` | building | 34 | 1 |
| `music-studio` | building | 30 | 1 |
| `office` | building | 34 | 16 |
| `park` | building | 31 | 1 |
| `pet-shop` | building | 28 | 1 |
| `pharmacy` | building | 31 | 1 |
| `playground` | building | 28 | 1 |
| `police-station` | building | 27 | 2 |
| `post-office` | building | 25 | 1 |
| `restaurant` | building | 30 | 1 |
| `school-cafeteria` | building | 28 | 1 |
| `sports-field` | building | 31 | 1 |
| `street-sidewalk` | building | 26 | 1 |
| `supermarket` | building | 38 | 1 |
| `swimming-pool` | building | 27 | 1 |
| `toy-store` | building | 31 | 1 |
| `veterinary-clinic` | building | 25 | 1 |
| `warehouse` | building | 27 | 3 |
| `workshop` | building | 36 | 3 |
