This repository contains a city builder prototype with a complex person simulation. The next big planned task on it is to transition from loading-time generation to offline generation, what we call the pre-game bootstrap: a pool of pre-simulated people, with thousands of individuals simulated non-visually for hundreds of in-game years and rich life event logs, skills, relationships, etc. The offline generation will allow it to be richer and uncompromised in fidelity. That task has already been planned.

To get more context on the system and that plan, please start by reading the entirety of `/README.md`, `/CLAUDE.md`, `/docs/tasks/README.md`, and `/docs/tasks/038-history-asset-pipeline.md`.

This will give you a very good idea of how the simulations work. The following claims about the current implementation must therefore be treated as discovery and verification requirements, not assumptions:

* Verify whether live simulation and bootstrap simulation currently use the same simulation engine and data definitions.  
* Verify whether events currently tick once per in-game day for every Person.  
* Verify whether live simulation currently has map-materialization-dependent behavior, including going to a business to get a job.  
* Inventory the current file-based schemas, their loaders, their validation behavior, and any existing query syntax used by event requirements.  
* Record the results of this discovery in the first implementation task, and update this document or its follow-up architecture proposal wherever the current implementation differs from these assumptions.

Now, what I want to do today is, since the decision to move to offline generation for the bootstrap removed earlier performance constraints, I think we should make the simulation much richer to ensure the trade-off of this decision, which is having a static pool all games will pull from, pays off.

But please notice that what I want to plan today should serve both real-time generation and bootstrap alike. They should be the exact same system, with the only difference being that certain actions and events should wait for materialization in the world, such as a person arriving at their job, and should resolve immediately when being simulated in the bootstrap.

This needs to be implemented as a formal simulation execution boundary:

* The same event engine, action engine, data definitions, requirement queries, logs, and consequence engine must run in both modes.  
* The simulation must receive an execution context, such as `live` or `bootstrap`, through a world/materialization adapter rather than through scattered `if bootstrap` branches.  
* An action that needs a person to be physically present somewhere must request a location transition through that adapter.  
* In live simulation, that request may place the Person into a commuting or waiting-for-arrival state until the visual/map layer confirms arrival.  
* In bootstrap simulation, the same request should resolve immediately through the non-visual world adapter and emit the same arrival/action lifecycle records.  
* Game logic must not change based on whether the Person is live or bootstrapped. Only the materialization wait changes.

This is largely not how it currently works, because although I believe the simulation is unified today, the in-game sim does not have many aspects that are tied to map movement, though there are some, such as going to a business to get a job, which is an event. Please verify these claims.

But the fact that we are going to have to make modifications to this wiring as part of the simulation enrichments I want to do today is why I think we should place the enrichment rework before `038-history-asset-pipeline.md`, the offline generation. I want offline generation to be running all of the aspects of the live sim except waiting for visual movement/triggers, and we need to build this framework while also creating or adding some new aspects to it.

So I will describe those additions below, and I need you to use them to create a coherent architecture proposal, which we will then refine into tasks for the `/docs/tasks/` folder. Bump the number of `038-history-asset-pipeline.md` when we finish, so that it comes after the new tasks. Renumbering must include updating all links, task indexes, references, and dependencies that currently point to `038-history-asset-pipeline.md`.

It is important that we plan the below using a framework mindset. Everything you need to add should answer this question: “Does this fit one of the current file-based schema structures, like events, jobs, etc.?” If the answer is no, you need to either create a new structure or extend the expressive power of one of the existing ones.

Here is my vision:

# **Shared simulation contract**

Before the individual systems below are implemented, define one shared simulation lifecycle.

Every action and event should have an unambiguous simulated timestamp. When multiple things happen in the same in-game hour, their logs must also contain a deterministic sequence number or causation chain so their ordering is reproducible in both bootstrap and live simulation.

Each hourly tick should broadly follow this order:

1. Advance currently running continuous Actions.  
2. Resolve sequence steps and pool child Actions that are due during this tick.  
3. Resolve scheduled or automated Event triggers that are due during this tick.  
4. Evaluate probabilistic Event eligibility.  
5. Commit Events that occurred and append them to the Person’s Event log.  
6. Dispatch committed Event lifecycle notifications to Brain hooks and other simulation systems.  
7. Resolve Brain and job-related Action intents.  
8. Start, interrupt, complete, or wait on Actions through the shared Action engine.  
9. Persist logs, inventory/world changes, and any deferred materialization requests.

The exact order can be refined during implementation, but it must be deterministic and shared by bootstrap and live simulation.

# **24 ticks per day**

* Let’s evaluate event eligibility and happening per in-game hour ticks, not per day. Every day is going to have 24 hours, so 24 ticks. At every in-game hour/tick, probabilistic event eligibility evaluation happens for everyone and is processed for people.

* Existing daily probabilities cannot simply be reused per hour. For events whose current probability means “chance of happening at least once per day,” convert the baseline to an hourly probability that preserves approximately the same daily likelihood:

   `hourlyProbability = 1 - (1 - dailyProbability) ^ (1 / 24)`

* This conversion only applies to equivalent baseline probabilities. Events with time windows, gradients, cooldowns, or more complex requirements must be reviewed individually.

* Events must support occurrence limits and cooldowns where needed. A life event such as “Started working” should not be eligible every hour after it has already occurred. The schema should make it possible to define scopes such as once ever, once per day, once per job, once per relationship, or once within a configurable time period.

* Requirements must be evaluated against the state at the beginning of the relevant simulation phase, and committed changes must be visible to later phases in the same tick in a deterministic way.

# **Objects**

* We need to implement a file, `objects.json`, to define objects that will populate our world.  
* `objects.json` must define object archetypes, not individual runtime objects. A runtime object should be an Object Instance with its own unique ID, archetype ID, quantity where applicable, state/attributes, owner or container, and simulated creation history.  
* When a Person receives or acquires an Object Instance from the list, it is placed in their inventory, a property Person will have called `Possessions`.

For the purposes of this game, let’s make a distinction between Property and Possession.

Property is like real estate, cars, etc. Possessions are more intended for things people manipulate and interact with in their day-to-day lives, like an apple, a notebook, a backpack, etc.

Big furniture is kind of a gray area, I realize. Let’s not deal with that ambiguity yet. You can put furniture in the JSON, and it can exist, like, inside a house, but at least at first, since it cannot be easily carried, picked up, or pocketed, it does not ever make it into the Possessions of a Person.

An item, for now, is put into Possessions when a person is actively carrying it. This also means a person’s car is not put into Possessions. It still belongs to the person, just not in Possessions. A person’s possessions would look more like this, for example: a cellphone, two packs of gum, a pencil, and a backpack.

* Possessions should be represented as an inventory/container system rather than only a flat list, even if the first implementation exposes a flat list. This will allow objects such as a pencil to be inside a backpack, or a raw dough to be inside a bowl, without creating a second incompatible inventory model later.  
* We should enrich this metadata as much as possible, even for things we might not use yet: object dimensions/size, weight, properties indicating whether it is reasonably possible to carry it, fit in a pocket, stack with identical objects, be consumed, be equipped, or be placed in the world.  
* All dimensions and weights should use normalized units.  
* The schema should distinguish at least:  
  * `carryable`  
  * `pocketable`  
  * `stackable`  
  * `consumable`  
  * `placeable`  
  * `defaultContainerBehavior`  
* The object system must support world ownership and location in addition to Person ownership. An object may belong to a Person, a business, a building, a room, or no owner at all.

# **Events validation**

* Standardize the parsing of data JSON files in our framework, like events, actions, skills, jobs, businesses, objects, and object-action relationships, allowing validation functions to be defined for each file type and implement basic validators for all existing files.  
* Use one central data-schema registry. Every file-based data structure must register:  
  * Its parser.  
  * Its structural validator.  
  * Its semantic and cross-reference validator.  
  * Its schema version, where appropriate.  
* Structural validation should check required fields, types, enum values, defaults, and invalid JSON shape.  
* Semantic validation should check cross-file references, duplicate IDs, invalid requirement queries, invalid object/action/event references, invalid parameter bindings, invalid child Action graphs, invalid sequence loops, and incompatible trigger definitions.  
* Subtasks:  
  * Document the need to create a validator every time a new file-based data schema is implemented in `CLAUDE.md`.  
  * Write and wire up a test or script running all validators against the current state of the JSON files in CI as a gate.  
  * Add representative invalid fixtures so validators are tested rather than only run against valid data.  
  * Ensure that data loading fails loudly during development and CI, rather than silently skipping invalid entries.

# **Events additions/changes**

* We need to have a new `triggers` property where different types of triggers can be defined for an Event.  
* All trigger types are optional individually, but if an Event lacks any trigger at all, an error should be thrown by the Events validator.  
* “Manual” means programmatically callable by other code. It does not mean only player-manual. Actions, Brains, job systems, and other simulation systems may invoke manual Events through the Event engine.  
* All Event invocations must record a trigger source and causation ID so the Event log can show whether an Event was caused by probability, an Action, a Brain hook, a scheduled rule, a job system, or another system.

The trigger types are:

* `manual`, meaning this life Event can be triggered for a Person by other code through a function call.  
* `probabilistic`, which is the current model. Most, if not all, currently existing trigger parameters should be moved here. Evaluate whether any existing trigger configuration or parameter is better left as a global Event config instead.  
* `automated`, meaning the Event is scheduled or generated by a deterministic rule that does not require an arbitrary external caller at the moment it occurs. This is for things such as “in 8 ticks,” “at 08:00,” “every Monday,” or “after a configured delay.” Automated triggers must be represented as scheduled work in the simulation timeline, not as invisible direct mutations.

This is the model where eligibility for a probabilistic Event happening is evaluated at every tick. See whether current trigger configurations of existing Events need adjustments to account for the tick now being per hour.

An Event may have more than one trigger type. For example, “Stopped working” might be manually triggered by completion of a Work Action, while also having an automated shift-end fallback if the Person is still working at the end of their shift.

# **Actions**

Just like we have a file with life Events, we are going to have one with Actions, and here is how it relates to current systems and what interfacing capabilities we need to implement.

## **What they are**

Actions correspond to normal actions people do in their lives: go to sleep, cook a meal, go to work, take a shower.

A lot of Actions are going to have one or more Event counterparts that are triggered by, or are a direct or indirect consequence of, the Action. This also means that not all Events are now triggered probabilistically.

Actions must have the power to trigger Events. When a Person uses the Action Work, a life Event “Started working” should be triggered when the Work Action actually starts, not merely when the Person begins commuting to work.

Other parts of the code can also trigger Events. For example, the Event “Stopped working” should be triggered when the Person finishes or is interrupted out of their shift.

This will require an extensive revision of Events alongside the implementation work for Actions. These two lists, Events and Actions JSON files, should be tightly coupled at the data level, meaning we as coders need to manage the relationship of Actions and Events carefully.

The data validator must verify both directions of this relationship. An Action cannot reference a missing Event, and an Event that is declared as Action-caused should reference a valid Action or valid source category.

## **Shared requirements system**

Like Events, Actions can have requirements, which can be the presence of past Events and now past Actions in the log.

We should also rely on and enhance the query syntax we already have for creating more complex requirements. Requirement syntax/schema should be a shared system between Actions and Events.

The first implementation task must inventory the existing query syntax. The long-term goal should be one explicit, versioned, JSON-safe query expression system rather than separate ad hoc filters in Events and Actions.

The new Status field, as well as a Person’s location, past Events and past Actions with parameterized time-range lookups, any of their attributes, and stats thresholds when they are implemented in the future, should all have specific ways of being used as requirements.

The Action of picking up or pocketing an object from the environment, for example, requires the object to exist in the environment/building the Person is in, and the object having it indicated in its metadata that it is pocketable.

## **Parameters**

Actions should define parameters that can be required or optional.

For example, the Action of cooking should have a parameter such as `food` or `recipe`, whose value can reference an Object archetype, Object Instance, or recipe-like data definition, depending on the Action’s purpose.

The type system must distinguish Object archetypes from Object Instances. “Cake” as a recipe target is different from “this specific raw dough object in the Person’s Possessions.”

Other parameter examples could be a parameter `target` of type `Person` when punching someone.

Parameters must support named bindings from parent Actions and sequences, such as `$parent.food`, `$previous.output`, or `$action.target`, while validators ensure that every referenced parameter exists and has a compatible type.

## **Consequences**

Yet another fully fledged scripting capability we need to implement is Action Consequences.

The idea is that the Consequences of an Action are direct effects that Action has on the Person object, surroundings, or other people. So, keeping to the example above of baking a cake, we need to have variable support so whatever was passed as a parameter of what was being cooked can be placed in the Person’s Possessions as an Object.

Consequences must be a bounded declarative data system, not arbitrary code embedded in JSON. At minimum, it must support:

* Add, remove, move, consume, transform, or transfer Object Instances.  
* Change Object state or attributes.  
* Modify a Person, target Person, business, building, or world location through approved operations.  
* Trigger manual Events.  
* Schedule automated Events.  
* Bind generated outputs to named variables for later sequence steps.  
* Declare ownership of outputs, such as Person, employer, business, world, or target Person.

Consequences should be executed atomically where possible. If a required input object is missing or a target is invalid, the Action should fail or become blocked without partially applying unrelated consequences.

## **Type**

There are going to be two types of Action: `continuous` and `discrete`.

While discrete Actions are very granular things people do that look good in a log, like “Cut onion,” “Grab pencil,” or “Heat bowl of water,” a continuous Action reads more like a status, like “Cooking a filet,” “Writing,” or “Working Out.”

Discrete Actions resolve their consequences as soon as they are invoked.

Continuous Actions take multiple ticks. They must have a lifecycle such as:

* `pending`  
* `waiting_for_materialization`  
* `running`  
* `completed`  
* `interrupted`  
* `blocked`  
* `failed`

Continuous Actions can end either when Brain interrupts them, when a job shift or another obligation requires interruption, when an Action-specific completion condition is reached, or, for sequence-based Actions, when the sequence ends.

Every Action log entry should include an Action instance ID, Action definition ID, Person ID, parameters snapshot, start timestamp, end timestamp where applicable, outcome, parent Action instance ID where applicable, and causation ID.

## **Children, continuous Actions only**

This is the part that will make this system very powerful from an expressive-power standpoint. It is going to allow us to represent from very simple Actions such as grabbing a pencil to complex everyday activities.

There should be two modes for declaring children of a continuous Action: `sequence` and `pool`.

### **Pool**

`pool` is simpler. You declare references to discrete tasks with base probability and per-tick probability modifier. Meaning it defines how rare that Action is and how often it happens while doing that activity per tick.

For playing on a playground, “Tossing sand” should be a common occurrence, potentially multiple times per tick.

The exact schema must make the following explicit:

* The base chance or selection weight.  
* The per-tick chance.  
* The maximum occurrences per tick.  
* Cooldowns or maximum total occurrences, where needed.  
* Requirement checks for each child Action.  
* Whether a child Action may repeat immediately.

Take measures to make sure we interleave child Actions happening on the same tick. Otherwise, we will get multiple entries of “Tossed sand” per tick. That is as far as we will go toward sub-tick simulation.

A reasonable default is that identical child Actions cannot appear consecutively within the same tick unless no other eligible child Action exists.

### **Sequence**

`sequence` is a little more involved, as it makes the continuous Action something with a beginning and an end, and also allows us to orchestrate more coherent sequences of Actions with a beginning and end.

It must also make children-to-parent interactions possible.

For “Baking ,” make it a series of sequential discrete Actions that first result in a raw dough in the Person’s Possessions, then require that raw dough for the next Action, then result in baked dough, then add cream, then add topping, and finally produce a Cake.

The parent Continuous Action should not also create a second Cake at completion. Parent completion should be able to reference, validate, transfer ownership of, or expose the final child output, but must not duplicate an object already created by the sequence.

You do not have to create hyper-specific Action-object relationships either. For example, no Action for “Add cream to baked dough.” It should be “Add to .”

But this means we need to track valid and invalid object-combination transitions.

This will require another JSON, `object-action-relationships.json`.

This cannot remain only a simple one-object-to-one-object relationship table, because “Add to ” can require multiple inputs, consume one object, modify another object, and produce one or more outputs.

The schema should therefore support:

* An Action ID.  
* Multiple input Object archetypes or Object states.  
* Quantity requirements.  
* Whether each input is consumed, retained, transformed, or merely required.  
* One or more outputs.  
* Output quantities and state.  
* Parameter bindings.  
* Ownership/container targets for outputs.  
* Optional contextual requirements, such as kitchen availability or an oven object in the location.

The first version should remain declarative and intentionally limited, but it must be expressive enough for multi-input transformations.

# **Brain**

We are going to introduce a new game system, `Brain.ts`.

Every Person object should have a Brain, just like they currently have a SocialLife.

The Brain is going to do and have several things:

* A `status` field representing the Person’s broad current simulation state.  
* A reference to the Person’s currently active continuous Action, when applicable.  
* A queue or set of proposed Action intents for the current tick.  
* Brain-owned hook registrations and decision ordering.  
* A decision system for selecting continuous Actions during free time.  
* Future support for stats like happiness, hunger, energy, boredom, ambition, generosity, etc, but those are out of scope for this task.

The `status` field should not directly contain an arbitrary continuous Action name. It should be a small, stable state enum such as:

* `idle`  
* `sleeping`  
* `commuting`  
* `working`  
* `performing_action`  
* `waiting_for_materialization`

The actual activity should be represented separately by `activeActionInstanceId` and its Action definition. This lets UI and requirements ask either “is the Person working?” or “is the Person currently baking a cake?” without making status itself an unbounded field.

Brain will be responsible for initiating and prioritizing Actions, but it must not duplicate Action execution logic. The Action engine validates requirements, applies consequences, advances continuous Actions, and writes logs. Brain decides which Action the Person should attempt next.

Brain is, essentially, in this initial incarnation, an orchestrator for triggering Actions based on simple logic and logic hooks we will put elsewhere in the code.

The most important hook source will be committed Events, which means much of Brain processing will occur on a tick when Events are generally fired, but there can be exceptions.

## **Brain decision model**

Brain should not simply choose from a fixed hard-coded list of Actions. The variety we are creating in Actions, Objects, Events, Jobs, locations, and relationships should directly influence what a Person does.

The Action data itself should contain most of the knowledge required for this. Brain should primarily be a generic candidate-selection and prioritization system, not a growing list of special-case behavior branches.

Every Action should be able to declare:

* Requirements, which determine whether the Action is currently possible.  
* Selection weight, which determines how likely Brain is to choose the Action when it is possible.  
* Selection modifiers, which increase or decrease that weight based on Person and world context.  
* Cooldowns, repetition limits, and recent-history exclusions.  
* Preferred contexts, such as location types, time of day, nearby people, owned objects, household type, age range, or relationship context.  
* Whether it is an obligation-like Action, a leisure Action, a social Action, a recovery Action, or another broad behavior category.

Requirements are hard gates. They answer questions such as:

* Is this Person old enough or young enough?  
* Is the Person in a compatible location?  
* Does the Person have a required object?  
* Is there a required nearby Person?  
* Is the Person currently unemployed, employed, retired, in school, or on shift?  
* Has a required Event or Action occurred before?  
* Has the Action been performed too recently?  
* Is the relevant object or target Person actually available in the current location?

Selection modifiers are not hard gates. They create variety among otherwise valid Actions.

For example, “Visit relatives” may be valid for many people, but should become more likely when:

* The Person has nearby relatives.  
* The Person has not interacted with that relative recently.  
* The Person is older.  
* The Person has duplicate or surplus possessions that can be given away.  
* The Person is in a location from which the relative can be reached.  
* A recent Event or Action created a reason to visit, such as a birthday, illness, retirement, job loss, or moving house.

Likewise, “Play on playground” may be valid only for children at a park or playground, but should become more likely for certain ages, when friends or siblings are nearby, during daytime, and when the Person has been idle for a while.

The Brain should not require a future personality-stat system before this can work. The first version can generate substantial variety from existing facts:

* Age and age band.  
* Job, school, retirement, and shift schedule.  
* Current location and nearby buildings.  
* Home, household, and family relationships.  
* Nearby People.  
* Possessions and accessible world objects.  
* Recent Event and Action history.  
* Relationship type and relationship recency.  
* Time of day, day of week, and season if available.  
* Existing Person attributes, skills, life history, and future extensible tags.

Future traits such as generosity, sociability, ambition, cleanliness, or risk tolerance can later become additional selection modifiers without changing Brain’s core architecture.

## **Free-time continuous Action selection**

When a Person has no higher-priority obligation, and is not already in a continuous Action that should continue, Brain should select a free-time continuous Action.

Examples of free-time continuous Actions include:

* Sleeping.  
* Resting.  
* Wandering around.  
* Sitting in a park.  
* Visiting relatives.  
* Visiting friends.  
* Spending time at home.  
* Reading.  
* Watching television.  
* Cooking.  
* Gardening.  
* Exercising.  
* Playing at a playground.  
* Shopping.  
* Browsing a store.  
* Going to the beach.  
* Going to a bar.  
* Studying.  
* Cleaning.  
* Working on a hobby.  
* Caring for children.  
* Socializing at work during breaks.  
* Running errands.

The selection process should broadly work like this:

1. Resolve mandatory or high-priority intents first:

   * Active job shift.  
   * School attendance.  
   * Required commute.  
   * Existing continuous Action that should continue.  
   * Scheduled automated Event or Action.  
   * Immediate consequences of recently committed Events.  
2. Build a candidate list of eligible continuous Actions:

   * Load all Actions that are valid for the Person’s current state.  
   * Filter them using the shared requirement system.  
   * Exclude Actions that are on cooldown, recently repeated too often, incompatible with the current location, or incompatible with an ongoing obligation.  
   * Include location-transition Actions where the desired Action is not available at the Person’s current location.  
3. Score the remaining candidates:

   * Start from the Action’s base selection weight.  
   * Apply Action-defined selection modifiers.  
   * Apply anti-repetition penalties.  
   * Apply recent-history bonuses or penalties.  
   * Apply social and relationship context.  
   * Apply object and environment context.  
   * Apply a controlled random factor.  
4. Select one Action through weighted random selection:

   * The selection must be deterministic for a given simulation seed and tick, so bootstrap generation is reproducible.  
   * The result should be varied, but not chaotic.  
   * The same Person should not repeatedly select the same Action unless their context genuinely makes it highly likely.  
5. Begin the Action through the normal Action engine:

   * If a location transition is required, Brain should first propose a commute/travel Action.  
   * Once arrival occurs, the target Action should begin through the same lifecycle in live and bootstrap simulation.

This means that two People with different ages, jobs, family structures, possessions, locations, and recent histories can make very different choices even when they have the same broad status of `idle`.

## **Continuous Action examples**

### **Wandering around**

“Wandering around” is an important general-purpose free-time continuous Action.

It can be eligible when:

* The Person is awake.  
* The Person is not on shift or in school.  
* The Person is in a walkable or public location, or can reasonably leave their current location.  
* The time of day is appropriate.  
* The Person is not already committed to a higher-priority Action.

It may become more likely when:

* The Person is young or retired.  
* The Person has been at home for a long time.  
* The Person lives near parks, shops, beaches, streets, or other walkable locations.  
* The Person has recently completed a passive Action such as resting, reading, or watching television.  
* The Person has nearby friends, relatives, or acquaintances.  
* The Person has no urgent obligations.

Its child pool may include discrete Actions such as:

* Looked at a storefront.  
* Sat on a bench.  
* Talked to a passerby.  
* Greeted a neighbor.  
* Picked up a flyer.  
* Found a coin.  
* Picked up a pencil.  
* Pocketed a small object.  
* Dropped an object.  
* Bought a snack.  
* Looked at a notice board.  
* Called a relative.  
* Took a shortcut.  
* Went into a shop.  
* Visited a park.  
* Returned home.

Some of these should be rare, some common, and some conditional.

For example, “Pocketed a small object” should require:

* A nearby Object Instance exists in the environment.  
* The object is `carryable` and `pocketable`.  
* The Person has enough carrying capacity or a compatible container.  
* The object is not currently owned by another Person, unless the Action represents theft or borrowing and has its own rules.  
* The object is not protected by business ownership or another location rule.

This gives natural variety to People’s Possessions over long simulations. A Person may slowly accumulate pens, flyers, snacks, toys, coins, small tools, receipts, notebooks, or other contextually plausible objects without requiring every inventory item to be manually authored as a one-off Event.

### **Visiting relatives**

“Visiting relatives” should be a continuous social Action.

It can be eligible when:

* The Person has one or more living relatives.  
* The relative has a known home or current location.  
* The Person is not on shift or otherwise obligated.  
* The relationship is not currently blocked by an Event, requirement, or distance rule.  
* The Person can travel to the relative’s location.

It should become more likely when:

* The relative has not been visited recently.  
* A recent Event affected the relative.  
* The Person is older.  
* The Person is retired or has more free time.  
* The relative is elderly, ill, recently widowed, recently unemployed, or otherwise in a state that creates a reason for contact.  
* The Person and relative have a close relationship.  
* The Person has possessions that are appropriate to give away.

Its children may include:

* Talked to relative.  
* Had a meal together.  
* Watched television together.  
* Helped clean the house.  
* Gave advice.  
* Borrowed an object.  
* Returned a borrowed object.  
* Gave a gift.  
* Gave away an old possession.  
* Received a possession.  
* Played with a child relative.  
* Argued.  
* Apologized.  
* Left early.  
* Stayed overnight.

The Action “Gave away an old possession” should be a discrete Action that transfers an actual Object Instance from one Person’s Possessions to another Person’s Possessions.

It should be more likely when:

* The giver is older.  
* The giver has duplicate objects.  
* The giver has carried an object for a long time.  
* The object is appropriate for gifting.  
* The recipient is a child, younger relative, or someone with a relevant need.  
* The object has a relationship or life-history meaning, when those systems exist.

This should not require a hard-coded “old people give possessions” behavior in Brain. Instead, the Action declaration should have selection modifiers that make the Action more likely for older age bands and appropriate relationship contexts.

### **Playing at a playground**

“Playing at a playground” can be eligible when:

* The Person is a child.  
* The Person is at, or can travel to, a playground or park.  
* It is an appropriate time of day.  
* The Person is not in school or another obligation.

Its child pool may include:

* Tossed sand.  
* Climbed a structure.  
* Used a swing.  
* Ran around.  
* Played with a sibling.  
* Played with a friend.  
* Argued with another child.  
* Found a toy.  
* Pocketed a small toy.  
* Lost a possession.  
* Shared a snack.  
* Went home.

Some children should have requirements based on nearby People, playground objects, possessions, age, or the current location.

### **Spending time at home**

“Spending time at home” should not be one generic behavior with no detail. It should be a broad continuous Action whose child pool can surface the person’s possessions, household, age, and room/location.

Possible child Actions include:

* Read a book.  
* Watched television.  
* Used a computer.  
* Cooked something.  
* Cleaned a room.  
* Called a relative.  
* Repaired an object.  
* Looked for an object.  
* Packed a backpack.  
* Rearranged possessions.  
* Took a shower.  
* Took a nap.  
* Played with a child.  
* Helped with homework.  
* Argued with a household member.  
* Gave an object to a household member.  
* Threw away an object.

The presence of a book, television, computer, kitchen, shower, child, or other household member should be expressed through requirements and selection modifiers, not through Brain-specific code.

## **Social Actions and peer interaction**

People should not only act on the world. They should also regularly act on other People.

The Action system should support social Actions whose parameters include one or more target People.

Examples include:

* Talk to Person.  
* Greet Person.  
* Ask Person for help.  
* Give Object to Person.  
* Borrow Object from Person.  
* Return Object to Person.  
* Share food with Person.  
* Invite Person somewhere.  
* Visit Person.  
* Argue with Person.  
* Apologize to Person.  
* Help Person with a task.  
* Play with Person.  
* Teach Person something.  
* Ask Person for advice.  
* Offer Person a job lead.  
* Give Person a ride.  
* Celebrate with Person.  
* Attend an Event with Person.

Target selection should also be generic and data-driven.

For example, “Give Object to Person” may require:

* A valid target Person nearby or reachable.  
* A relationship matching allowed types, such as family, friend, neighbor, coworker, or acquaintance.  
* A carryable Object Instance in the giver’s Possessions.  
* An Object that is allowed to be gifted.  
* A target that can receive the object.  
* No blocking relationship state or recent conflict rule.

Its selection modifiers may favor:

* Parents giving objects to children.  
* Grandparents giving possessions to grandchildren.  
* Older People giving possessions to younger relatives.  
* People giving duplicate possessions away.  
* People giving useful objects to someone whose recent Events indicate a need.  
* Friends exchanging small objects.  
* Coworkers lending work-related objects.  
* People returning objects they previously borrowed.

This creates long-term social and inventory history. A Person may own an object because they bought it, found it, borrowed it, received it from a relative, inherited it, or acquired it through work.

These transfers should always be represented as Action consequences and logged with a causation chain.

## **Brain Hooks pattern**

The Brain Hooks pattern should be an explicit, deterministic extension mechanism.

A hook must not directly mutate a Person or directly write to the Action/Event log. Instead, it should inspect the simulation context and return one or more Action intents. The Brain resolves those intents, selects the winning one, and asks the Action engine to start or interrupt Actions through the normal pipeline.

A Brain Action intent should contain at least:

* The Action ID.  
* Parameter bindings.  
* The reason or source hook.  
* Priority.  
* Whether it may interrupt the current Action.  
* Whether it is optional, required, or emergency-like.  
* A causation ID linking it to the Event, shift, arrival, or tick that produced it.

Hooks should have deterministic ordering. When multiple hooks propose incompatible Actions, Brain should resolve them by priority and then by stable hook registration order or ID.

The initial hook categories should be:

* `onTick`  
* `onEventCommitted`  
* `onActionStarted`  
* `onActionCompleted`  
* `onActionInterrupted`  
* `onLocationArrived`  
* `onShiftStarted`  
* `onShiftEnded`

The first implementation can focus on `onEventCommitted` and `onTick`, but the API should leave room for the other categories.

The basic hook to implement first is `Woke up`.

When the Event “Woke up” is committed, Brain should run a handler with the following logic:

1. Determine whether the Person has a currently valid obligation:

   * An adult with an active job assignment and a shift that is active or begins within the configured preparation/commute window.  
   * A minor with a valid school assignment and an active school schedule.  
2. If the Person needs to attend work or school and is not already at the destination:

   * Propose a commute/location-transition Action.  
   * In live simulation, wait for materialization/arrival before beginning the work or school Action.  
   * In bootstrap simulation, resolve the same transition immediately through the world adapter.  
3. Once the Person is at the destination:

   * Propose the Work Action for adults with jobs.  
   * Propose the relevant school-attendance Action for minors.  
4. If the Person has no valid work or school obligation, or no reachable school exists:

   * Build the free-time continuous Action candidate list.  
   * Filter candidates through the shared Action requirements.  
   * Apply context-sensitive selection modifiers.  
   * Select a continuous Action through deterministic weighted randomness.  
   * Begin the selected Action through the normal Action engine.  
5. The eventual start of Work or school attendance must be logged as an Action. Any related Event, such as “Started working,” should be triggered by the Action consequence/lifecycle rather than by the hook directly.

Other initial Brain hooks should include:

* A shift-start hook that proposes commute or Work when the Person has not yet started an active shift.  
* A shift-end hook that requests completion or interruption of Work.  
* An arrival hook that starts the intended destination Action after commute completes.  
* A continuous-Action-completed hook that asks Brain to choose the next eligible Action.  
* A social-opportunity hook that proposes interaction Actions when compatible People are nearby.  
* An inventory-opportunity hook that proposes Actions such as pocketing, using, gifting, discarding, repairing, or storing objects when eligible.  
* A fallback idle hook that selects a low-priority valid Action when no obligation or stronger intent exists.

Brain is a future place for stats like happiness, hunger, and social needs, but those are out of scope for this task. The hook system should be designed so future need-driven hooks can propose Actions without rewriting the Action engine.

# **Jobs**

* We need to add shift start time and end time for every job.  
* Jobs must also define days of the week, timezone/calendar assumptions, and whether shifts may cross midnight.  
* Jobs should be linked to a workplace/business and a physical location where appropriate.  
* Jobs now should be able to declare their continuous and discrete Actions, with parameterized frequency for both.  
* Jobs should not directly own a second competing Action state machine. Brain should remain the single owner of a Person’s active Action state.

Instead, jobs should have a Job Orchestrator, or Job Activity Director, that is a counterpart to Brain in responsibility but not a duplicate of Brain in control.

The Job Orchestrator should:

* Know which Persons are assigned to the job and whether they are currently on shift.  
* Publish high-priority work-related Action intents to each Person’s Brain.  
* Define eligible continuous work Actions and discrete work Actions, with frequencies and requirements.  
* Wait for the Brain/Action engine to complete or interrupt Actions.  
* Track workplace outputs and business inventory.  
* Trigger job-related Events through the normal Event engine.

The Job Orchestrator should randomly propose discrete Actions on ticks, sometimes multiple, subject to the same pooling, interleaving, cooldown, and eligibility rules used by continuous Action children.

Think of the Job Orchestrator as a context-specific Action source. Brain decides how a Person acts; the Job Orchestrator describes which work Actions are available, expected, and high priority while the Person is on duty.

The existing idea that jobs should “confiscate” any Object product of their continuous Actions should be implemented through consequence ownership rules instead.

For example:

* A factory-produced item can be created directly into business inventory with ownership `employer`.  
* A personal lunch prepared during a break can go into the Person’s Possessions.  
* A tool borrowed from the workplace can remain business-owned but temporarily carried by the Person.

Do not indiscriminately confiscate every object produced by someone at work.

# **Pre-initiative tasks**

These are tasks we should consider pre-work, since they are mostly generating data names that will later serve as a basis for creating our data assets, so we should complete them on a second pass after the initial planning.

You do not need to write a `.md` file for each of these. You can just write one large task for them.

You can choose to do them before or after writing the final `.md` files for the actual tasks on the list below, whichever works best. The preliminary tasks are:

* List as many settings as possible: hospital, classroom, bedroom, kitchen, office, park, beach, pool, dentist, etc. Go for at least 40 settings, more if possible. Fill each with about 30 items on average or more that you would find in each setting. Some settings are going to have fewer objects than that, but this is a good technique to ensure a good variety of objects across many domains. Then fill the list’s easier-to-expand settings with more objects until you have at least 1,200 object names post-dedupe. You can remove the settings names from this list later, but I suspect many of them will be useful for listing businesses that can have these objects, so save them somewhere temporarily.  
* Of course, since you are an LLM, if this procedure is not the best way to write 1,200 object names across varied knowledge domains, feel free to use a different technique. This is how a human would ensure a good variety of objects. You could even not write this yourself. If the best approach is to build a script, use a dataset, or otherwise generate and normalize the lists, do it.  
* Using a similar technique, list at least 100 businesses, just the names, like pharmacy, gym, cemetery, bar, etc.  
* Again, using whatever technique you are using, list the names of at least four jobs/positions for each business, for a total of at least 400 before deduping. Many jobs will share position names.  
* The same way, list at least five continuous Action names per job on the job name list, and at least five discrete Action names per job for people to do at random while at work, like “Complain about the time” or “Misplace a document.” Many jobs will share these Actions, which is fine. At the end of this exercise, we will have hundreds of things people do at work.  
* Finally, list at least 500 probabilistic and 500 manual Events post-dedupe, since many of them are both.  
* Give all these lists a pass categorizing things and making sure entities talk to one another.  
* The output of this task should preserve traceability where useful: object-to-setting, business-to-setting, job-to-business, Action-to-job, and Event-to-Action relationships. The final runtime JSON does not need to retain every planning category, but the planning artifact should.

# **Actual tasks**

Each item below should have its own `.md` task file. You can add your own tasks to this list, split them up more granularly, merge them, or reorder them as needed during planning.

The list below should be treated as an initial suggestion.

1. Discovery and compatibility baseline:

   * Verify the current simulation architecture, tick timing, map-materialization behavior, file schemas, loaders, query syntax, and existing `038` task dependencies.  
   * Document differences between current implementation and this proposal.  
2. Implement the data schema registry, validator framework, and CI gate:

   * Implement basic validators for all existing files.  
   * Update `CLAUDE.md` with the validator requirement for every new file-based schema.  
3. Implement the shared hourly simulation clock and execution context:

   * Add the 24-ticks-per-day lifecycle.  
   * Add daily-to-hourly probability migration rules.  
   * Add the live/bootstrap materialization adapter contract.  
4. Implement Objects and Person Possessions:

   * Implement object archetypes, Object Instances, world ownership, inventory/container behavior, and Person Possessions.  
5. Implement Event trigger properties:

   * Add `manual`, `probabilistic`, and `automated` triggers.  
   * Add causation/source logging.  
   * Migrate existing Event trigger configuration.  
6. Implement Actions without consequences:

   * Implement Action definitions, parameters, shared requirements, logs, lifecycle states, discrete Actions, continuous Actions, child pools, and sequences.  
7. Implement and backfill shift times and work Action declarations on Jobs:

   * Add shift schedules, job/workplace linkage, continuous work Actions, and discrete work Actions.  
   * Use the previously generated list of Actions to determine what makes sense for each job.  
8. Implement Brain and the Hooks pattern:

   * Implement Person Brain state, Action intent resolution, deterministic hooks, Woke Up behavior, commute/arrival integration, shift hooks, and idle fallback behavior.  
9. Implement the Job Orchestrator:

   * Implement job-derived Action intent proposals, work Action selection, business inventory handling, and shift-end behavior.  
10. Revise and backfill all existing Events:

* Evaluate the need for each Event to:  
  * Become an Action instead of an Event.  
  * Be linked to one or more Actions by being a consequence of those Actions.  
  * Have its `triggers` property modified or added.  
  * Have its probability/cooldown migrated for hourly ticks.  
11. Implement Action Consequences and object-action relationships:  
* Implement the bounded consequence DSL.  
* Implement `object-action-relationships.json` with multi-input/multi-output support.  
* Add ownership, transformation, consumption, and output binding behavior.  
12. Fill Objects JSON with at least 1,200 objects people can hold or carry with them:  
* Use the object names previously listed in the planning phase.  
* Fill JSON properties contextually based on the object itself.  
13. Backfill Actions with data:  
* Fill the Actions JSON file with continuous and discrete Actions a Person can do based on the previously listed Action data.  
* Add job-specific and general-purpose Actions.  
14. Fill the Events file:  
* Add the previously listed probabilistic and manual Events.  
* Ensure all Event-to-Action relationships validate.  
15. Fill `object-action-relationships.json`:  
* Add valid object transformations based on context and sequence-based continuous Actions.  
16. Document the relationships between Actions and Events:  
* Create a table, flowchart, diagram, or other useful artifact showing existing Action/Event relationships, trigger sources, and important lifecycle flows.  
17. Renumber `038-history-asset-pipeline.md`:  
* Move it after these tasks.  
* Update all indexes, links, references, dependencies, and any task numbering conventions affected by the renumbering.

The implementation order should keep the schema/validator framework, hourly lifecycle, materialization boundary, and Action lifecycle ahead of large data backfills. Otherwise we will generate a large amount of data against unstable schemas and semantics. One thing I did not touch here at all is Skills. It’s gonna need a rework, but this scope was already massive as is. Wire the existing skill system as possible to the new stuff where it makes sense, and document that we’ll revisit later.

Create a branch for this session, and start tackling it, please.