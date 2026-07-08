# Simulation relationships (generated)

> **GENERATED — do not edit by hand.** Derived from `src/json/actions.json`, `src/json/events.json`
> and `src/json/object-action-relationships.json` by `util/simulationDocs.ts`. The checked-diff test
> (`test/simulationDocs.test.ts`) fails when this file no longer matches the shipped data; regenerate
> with `npm run docs:sim`. The narrative companion is [simulation-flows.md](simulation-flows.md).

## Scale

| Manifest | Entries | Notes |
|---|---|---|
| `actions.json` | 256 | 67 continuous / 189 discrete |
| `events.json` | 700 | 175 probabilistic, 153 manual, 2 manual + automated, 370 probabilistic + manual |
| `object-action-relationships.json` | 28 | first-satisfiable entry per action commit |

## Action → Event (lifecycle links)

Lifecycle transitions fire the declared manual Events through `EventEngine.invoke` (`triggerSource: 'action'`, causation = the lifecycle log entry). Actions sharing one signature are grouped.

| Actions | Lifecycle → Event |
|---|---|
| `attending_customers`, `working_the_register`, `doing_paperwork`, `doing_rounds`, `working_the_kitchen`, `doing_manual_labor`, `teaching_class`, `fixing_equipment`, `keeping_watch`, `cleaning_premises`, `driving_route`, `treating_patients`, `styling_clients`, `coaching_session`, `drafting_designs`, `screening_film` | onStart → `started_working`<br>onComplete → `stopped_working`<br>onInterrupt → `stopped_working` |
| `attend_school` | onStart → `school_day_started`<br>onComplete → `completed_school_day` |
| `cleaning_house` | onComplete → `decluttered_house` |
| `cooking_meal` | onComplete → `tried_new_recipe` |
| `found_coin` | onComplete → `found_money_on_street` |
| `gardening` | onComplete → `planted_garden` |
| `gave_object_to_person` | onComplete → `gave_gift` |
| `hosting_gathering` | onComplete → `hosted_dinner_party` |
| `read_book` | onComplete → `finished_great_book` |
| `shopping_trip` | onComplete → `went_grocery_shopping` |
| `sleep` | onComplete → `woke_up` |
| `visiting_relatives` | onComplete → `reconnected_with_relative` |

## Action → Event (consequence ops)

*No shipped action currently uses `triggerEvent`/`scheduleEvent` consequence ops (the DSL supports both; engine tests cover them).*

## Event ← sources (reverse map)

Every event referenced by an action, with its trigger mix and limit. All manual invocation today is data-driven — the only `EventEngine.invoke` call sites are the action lifecycle (`ActionEngine.fireEvent`) and the consequence executor (`Consequences`).

| Event | Triggers | Limit | Invoked by |
|---|---|---|---|
| `completed_school_day` | manual + automated | once: perDay | `attend_school`.onComplete (continuous) |
| `decluttered_house` | probabilistic + manual | cooldown 360 ticks | `cleaning_house`.onComplete (continuous) |
| `finished_great_book` | probabilistic + manual | cooldown 360 ticks | `read_book`.onComplete (continuous) |
| `found_money_on_street` | probabilistic + manual | cooldown 720 ticks | `found_coin`.onComplete (discrete) |
| `gave_gift` | probabilistic + manual | cooldown 240 ticks | `gave_object_to_person`.onComplete (discrete) |
| `hosted_dinner_party` | probabilistic + manual | cooldown 240 ticks | `hosting_gathering`.onComplete (continuous) |
| `planted_garden` | probabilistic + manual | cooldown 1440 ticks | `gardening`.onComplete (continuous) |
| `reconnected_with_relative` | probabilistic + manual | cooldown 720 ticks | `visiting_relatives`.onComplete (continuous) |
| `school_day_started` | manual | once: perDay | `attend_school`.onStart (continuous) |
| `started_working` | manual | — | `attending_customers`.onStart (continuous)<br>`working_the_register`.onStart (continuous)<br>`doing_paperwork`.onStart (continuous)<br>… 13 more |
| `stopped_working` | manual + automated | once: perDay | `attending_customers`.onComplete (continuous)<br>`attending_customers`.onInterrupt (continuous)<br>`working_the_register`.onComplete (continuous)<br>… 29 more |
| `tried_new_recipe` | probabilistic + manual | cooldown 168 ticks | `cooking_meal`.onComplete (continuous) |
| `went_grocery_shopping` | probabilistic + manual | cooldown 168 ticks | `shopping_trip`.onComplete (continuous) |
| `woke_up` | manual | once: perDay | `sleep`.onComplete (continuous) |

Of the 525 manual-triggered events, 511 have no action source yet — they are invokable texture (052) reserved for future action links and system callers; the rest of their trigger mix (probabilistic rolls) still runs them.

## Automated schedule rules

| Event | Rules | Limit |
|---|---|---|
| `stopped_working` | afterEvent `started_working` +12 ticks | once: perDay |
| `completed_school_day` | afterEvent `school_day_started` +8 ticks | once: perDay |

## Trigger & limit breakdown

| Trigger mix | Events |
|---|---|
| probabilistic + manual | 370 |
| probabilistic | 175 |
| manual | 153 |
| manual + automated | 2 |

| Occurrence limit | Events |
|---|---|
| cooldown window | 633 |
| once: ever | 50 |
| — | 13 |
| once: perDay | 4 |

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
