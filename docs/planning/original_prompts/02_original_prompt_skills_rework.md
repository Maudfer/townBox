Can you write the tasks to add features to our life simulation system? First, let me give you context. There are instructions below on how to get context into the system, what to do, and stuff that should be documented (which you can put on CLAUDE.md or README.md). Info:

This repository contains a city builder prototype with a complex person simulation. The next big planned task on it is to transition from loading-time generation to offline generation, what we call the pre-game bootstrap: a pool of pre-simulated people, with thousands of individuals simulated non-visually for hundreds of in-game years and rich life event logs, skills, relationships, etc. The offline generation will allow it to be richer and uncompromised in fidelity. That task has already been planned.

To get more context on the system and that plan, please start by reading the entirety of `/README.md`, `/CLAUDE.md` and `/docs/tasks/README.md`. Also read the entirety of docs\planning\original_prompts\01_original_prompt_sim_revamp.md, but keeping in mind it was already implemented. Just so you understand the systems we put in place.

This will give you a very good idea of how the simulation works. The expected output of this session is to write task files in docs\tasks\, then we'll implement them. Plan the changes described here, judging architectural feasability and compatibility to what already exists, trying to find gaps and loose ends we are leaving behind, and patch those when writing the tasks. This should be a planning and validation pass. Try to see if everything we are implementing here is being consumed and if the resulting simulation seems to make sense, with closed loops (for example, an earlier version of this document had a problem where it would be impossible for people to get jobs because without College, they wouldn't have the skills. Look for similar gaps. Objects that will never be used, actions and events never triggered, skills never consumed, etc).

Please notice that what I want to plan today should serve both real-time generation and bootstrap alike. They should be the exact same system, with the only difference being that certain actions and events should wait for materialization in the world, such as a person arriving at their job, and should resolve immediately when being simulated in the bootstrap.

The repository now also includes recently implemented simulation systems that this work must build on rather than duplicate:

* An hourly simulation lifecycle shared by live simulation and bootstrap simulation.  
* An Action system with discrete and continuous Actions, parameterized requirements, child pools, and sequences.  
* An Event system with manual, probabilistic, and automated triggers.  
* An Object and Possessions system, where runtime Object Instances can exist in the world, belong to a building or business, or be carried by a Person.  
* A recently implemented Brain orchestrator system that evaluates hooks and selects or prioritizes Actions for a Person. Brain decides what a Person should attempt; the Action engine validates, executes, and logs it.  
* A recently implemented Job Orchestrator system that provides work-related Action intents and work context to a Person’s Brain without becoming a separate competing Action state machine.  
* Shared live/bootstrap materialization handling, where a required location transition waits for map arrival in live simulation and resolves immediately through the bootstrap world adapter.

The exact names and current APIs for these systems must be confirmed from the current documentation and code. This document describes the required behavior and architecture, not a replacement for that source-of-truth discovery.

The main goal of this initiative is to make time, skill acquisition, work progression, environmental context, and interpersonal Actions materially affect the simulation. None of these should become data systems that are generated but consumed by nothing.

# **Integration guardrails**

The following relationships are required:

* Calendar data must be consumed by Brain, school attendance, and job schedules.  
* Skills must be consumed by job hiring, job rank progression, Action requirements, and later Action selection modifiers where relevant.  
* Buildings populated with Objects must be consumed by Action requirements and Object-transfer consequences. Objects should not merely be decorative bootstrap data.  
* Consent must be evaluated through the target Person’s Brain and must affect Action execution and logs.  
* Action failure must be handled by both the Action engine and Brain. A failed Action cannot apply its normal consequences.  
* All random decisions, including consent, free-time selection, object placement, and skill assortment during bootstrap, must be deterministic for a given simulation seed and tick.

# **Calendar**

* We need to implement weekends.  
* Children do not go to school on weekends.  
* For now, adults work every day, seven days a week, to make it simpler initially.  
* The calendar must expose at least:  
  * Absolute simulation day.  
  * In-game hour.  
  * Day of week.  
  * `isWeekend`.  
  * Year and age progression support.  
* The initial week should be seven days long, with Saturday and Sunday as weekend days.  
* Holidays, school vacations, paid time off, shift rotation, and reduced workweeks are out of scope for this initiative. The calendar must not be designed in a way that prevents them later.

The recently implemented Brain orchestrator should use the calendar when deciding whether a Person has a mandatory activity.

For this first version:

* A Person aged 7 through 17 should attend school on weekdays if they have a valid school assignment and a reachable school.  
* A Person should stop attending school when they turn 18\.  
* Once a Person turns 18, Brain should begin allowing job-search Actions instead of school attendance.  
* Adults with a job should attend their assigned job shift every day of the week.  
* A child without a valid school assignment or reachable school should not magically receive school attendance or school skill progression. They should follow normal free-time Brain behavior instead.

Schools need a formal assignment and schedule contract, even if they reuse existing building, business, or institution structures. A school assignment should identify at least:

* The school/building.  
* The Person attending.  
* The applicable weekday schedule.  
* Whether the assignment is currently valid.  
* The start and end of the school day.

Do not silently model school as a Job unless that is explicitly selected as a repository-wide design decision. It has similar scheduling behavior, but it differs in rank progression, compensation, and skill awarding.

# **Skills**

We currently have a skill system with its own JSON file, but it is very rudimentary: essentially just a list of strings Persons can have that are required by jobs. The current values in the JSON are very generalistic, like `MedicalSkill`, `EngineeringSkill`, etc.

Let’s drop the `Skill` suffix from skill names, and completely rework the skill system and how it is wired to the simulation.

## **Skill model**

A Person’s Skills should now have a `proficiency` floating-point value from `0.0` through `100.0`.

This does not mean everybody should have every Skill with proficiency `0.0`. A Person acquires a Skill the first time they gain any positive proficiency with it. Skill records with `0.0` proficiency should not be stored on a Person.

A Person Skill record should contain at least:

* Skill ID.  
* Current proficiency.  
* First acquired timestamp.  
* Last progressed timestamp.  
* Optional provenance, such as school attendance, a specific job, a job-training grant, an Action, bootstrap initialization, or a future learning system.

The system should preserve enough provenance to explain why a Person has a Skill. For example, a Person may have `Suture Wounds` because they received entry-level job training, progressed while working at a clinic, or both.

Skills should be capped at `100.0` unless an explicitly future-proofed system introduces a different cap. Do not allow accidental overflow.

## **Skill dependencies**

The Skill declarations in the JSON file should have a dependency system similar to NPM and to the one implemented for Events: flat in the file, but parsed into a dependency graph.

Skills can have more than one prerequisite, so the correct internal data structure is a directed acyclic graph, not a strict tree. The graph can still be presented as a tree-like dependency view in tools or documentation.

A Skill declaration should support at least:

* Skill ID.  
* Display name.  
* Dependencies.  
* Minimum proficiency required in each dependency.  
* Tags or categories where useful.  
* Whether it is a basic school Skill.  
* Optional metadata used by jobs, Actions, and future UI.

A dependency should be declared in a form conceptually like:

* `skillId`  
* `minimumProficiency`

For example, `Suture Wounds` might require certain proficiency in `Biology`, `Hand Coordination`, and `Use Sterile Equipment`.

The validator must reject:

* Missing dependency references.  
* Cyclic dependencies.  
* Duplicate skill IDs.  
* Invalid proficiency thresholds.  
* Skills with generic legacy names ending in `Skill`.  
* A non-basic Skill that uses a broad field-of-study name rather than a specific ability.  
* Dependencies that cannot realistically be satisfied by their declared job-training or progression paths.

A dependent Skill cannot receive proficiency unless its declared dependencies are satisfied. The only exception is an explicit onboarding/training grant that grants the full required dependency closure atomically and validates it before committing.

## **Basic Skills**

Basic school Skills are the only Skills where it is allowed to use fields-of-study names, such as Biology, as Skill names.

Write at least the following basic Skills into the file:

* Math  
* Reading  
* Writing  
* Speaking  
* Biology  
* Geography  
* History  
* Physics  
* Chemistry  
* Digital Literacy  
* Problem Solving  
* Physical Coordination  
* Music

These basic Skills should have no prior Skill requirements.

The list may be expanded, but it must remain intentional. “Basic” should mean a broadly taught foundational capability, not merely a convenient bucket for unrelated Skills.

All other Skills should be named for specific abilities people have, not fields of study.

For example, `EngineeringSkill` should not be renamed to `Engineering`. It should be broken into specific abilities such as:

* Read Technical Drawings  
* Draft Technical Plans  
* Use Measuring Tools  
* Perform Structural Inspection  
* Diagnose Mechanical Failure  
* Troubleshoot Electrical Circuit  
* Weld Metal  
* Calibrate Equipment  
* Operate Lathe  
* Use CAD Software  
* Estimate Material Requirements  
* Perform Quality Inspection  
* Plan Maintenance Work  
* Assemble Mechanical Components  
* Interpret Safety Standards  
* Test Mechanical System  
* Configure Control Panel  
* Repair Plumbing Fixture  
* Analyze Load Requirements  
* Document Technical Work

The actual data backfill should create at least 20 specific Skills for every existing generic Skill family, with appropriate dependencies on basic Skills and other specific Skills.

For example, a medical family should contain specific abilities such as `Take Patient History`, `Measure Vital Signs`, `Administer Medication`, `Suture Wounds`, `Apply Bandage`, `Perform Basic Examination`, and `Use Sterile Equipment`, rather than retaining a generic `MedicalSkill`.

## **Skill acquisition and progression**

Pretty much the only Person objects with no Skills should be newborn babies.

This creates a necessary requirement beyond school attendance: children who are older than newborn but younger than seven must also have age-appropriate Skills.

For this initial version:

* Newborns may begin with no Skills.  
* Children aged one through six should receive a small, age-appropriate foundational Skill set through a simple bootstrap and age-milestone system.  
* This does not require a full preschool simulation yet.  
* The early-childhood system should grant only relevant foundational Skills, such as Speaking, Physical Coordination, Reading readiness, or basic social capabilities if those exist in the data.  
* It should not award all basic school Skills prematurely.  
* Children aged seven through seventeen should have school-derived proficiency based on their simulated attendance history.  
* Adults generated as adults should get all basic Skills at `60.0` for now, plus an assortment of other Skills at different levels. This makes sense because we’ll eventually evolve the system to a point where a professional musician, for example, needs music 80.0, and a famous one will have like music at 95.0. Document that idea please.

Adults should not receive arbitrary random advanced Skills with no contextual explanation. Their assortment should be biased by:

* Current job and rank.  
* Prior job history if present.  
* Age.  
* Relevant past Actions and Events where available.  
* Household or environmental context where useful.  
* Bootstrap seed, for deterministic variety.

## **School skill progression**

Make changes to Brain so people start going to school at 7, and stop at 18, when they start searching for a job.

Brain should cause basic Skill awarding at school, but not per Action at first. Let’s make it more general: award Skills once per completed school day attended.

The Action engine should remain responsible for confirming that the school attendance Action completed. A dedicated Skill Progression service should then award the school-day progression. Brain decides that the Person attends school; it should not directly mutate Skill values outside the normal simulation lifecycle.

If a child attends school every eligible weekday from age 7 until age 18, they should finish with every basic Skill at `60.0` proficiency.

The progression rate must be calculated from the actual calendar rather than using a loose fixed estimate:

* Let `totalEligibleSchoolDays` be the number of weekdays between the Person’s seventh birthday and eighteenth birthday.  
* Let `schoolDailyGain` be:  
  `60.0 / totalEligibleSchoolDays`  
* On each successfully completed school day, award `schoolDailyGain` to every basic Skill.  
* Clamp each basic Skill at `60.0` through normal school progression.  
* A child who misses school days naturally finishes with lower proficiency.  
* A child who begins school late or loses their school assignment should not be automatically normalized back to `60.0`.

For reference, if school were modeled as exactly 52 weeks per year for 11 years, there would be `2,860` school days and each completed day would award approximately `0.020979` proficiency per basic Skill. The actual implementation should use the Person-specific calendar count so that attendance from age 7 to 18 reaches exactly `60.0` regardless of weekday alignment.

School attendance must award no more than one school progression credit per Person per calendar day. Interrupting and resuming the same school Action must not grant multiple daily Skill credits.

## **Job skill progression**

Skill awarding at Jobs should follow a similarly concrete model.

For the initial simplified calendar, adults work every day. Therefore:

* Ten years of full daily work equals `3,650` completed work days.  
* A primary working Skill should go from `0.0` to `100.0` after ten years of qualifying full daily work.  
* The base daily proficiency gain for a primary Skill is:  
  `100.0 / 3650 = approximately 0.02739726`

Each completed work day should award this amount to the primary Skills declared by the Person’s current job rank.

A job rank may also declare secondary Skills, with a multiplier below `1.0`, allowing them to progress more slowly. For example:

* Primary Skill multiplier: `1.0`  
* Secondary Skill multiplier: `0.25`  
* Daily gain: `0.02739726 * multiplier`

The system must award work progression once per successfully completed work day, not once per child Action inside a job. A Person should not level a Skill faster simply because their Job Action has more discrete child Actions.

Jobs should explicitly declare which Skills they develop and at what multiplier. Job requirements and job progression should not be inferred only from Action names.

# **Jobs**

We will need to backfill existing Jobs with different Skill requirements, using the new Skill sets.

The biggest change to Jobs is proficiency requirements and ranks.

Every Job should now declare a set of different ranks in the Jobs JSON, with different proficiency requirements for each Skill at each rank.

Every Job is required to have exactly one entry-level rank.

A rank should declare at least:

* Rank ID.  
* Display name.  
* Whether it is the entry-level rank.  
* Required Skills and minimum proficiency for each.  
* Skills progressed by working in that rank.  
* Progression multiplier for each progressed Skill.  
* Optional rank-specific Actions or Action weighting.  
* Optional promotion evaluation behavior.

The Job assignment for a Person must store their current rank. The Job Orchestrator should use this rank when selecting available work Actions and awarding daily work Skill progression.

## **Entry-level job-training shortcut**

For now, we should short-circuit what would be College as a future feature.

Out of school, people will start looking for Jobs.

Let people grab entry-level Jobs even for professions that have non-basic Skill requirements, such as a doctor. However, this must be a controlled onboarding/training shortcut, not a way for people to farm Skills.

The behavior should be:

1. A Person searches for available Jobs after they leave school at 18\.  
2. Normal strict hiring should first evaluate whether the Person already meets the requirements of any available rank.  
3. A Person who already satisfies a non-entry rank can be considered for that rank through the normal strict path.  
4. If the Person does not qualify through the strict path, they may be considered for an available entry-level rank through the training shortcut.  
5. The shortcut is allowed only for the entry-level rank.  
6. It can grant only the explicitly declared non-basic Skills needed to meet that entry-level rank’s minimum requirements.  
7. It must grant those Skills only when the job offer is accepted and the Person is actually hired.  
8. It must not grant Skills merely because a Person repeatedly attempts to apply for a Job.  
9. After the grant, the full dependency graph and all rank requirements must be revalidated.  
10. The Person is assigned to the entry-level rank only. The shortcut cannot directly place someone into a non-entry rank.

For example, an entry-level doctor rank may require low values, in the tens, for Skills such as `Suture Wounds`, `Take Patient History`, and `Use Sterile Equipment`.

When a Person is hired into that entry-level doctor rank through the shortcut, the required non-basic Skills can be awarded up to the declared minimum values, provided all required dependency Skills are also satisfied or explicitly included in the training grant closure.

This is intentionally a temporary College/training shortcut. It must be documented in the Job schema and code as such so it can later be replaced by a more complete education, licensing, certification, or apprenticeship system.

Do not hide this behavior inside generic job matching code. Make it an explicit `entryTrainingGrant` or equivalent rank-level configuration.

## **Promotion and rank consumption**

Ranks cannot exist only as hiring metadata. They must be consumed by the simulation.

The Job Orchestrator should evaluate whether a Person qualifies for the next rank at a deterministic interval, such as every 30 completed work days or another explicit rank-evaluation cadence.

Promotion should require:

* The Person currently holds the Job.  
* The Person meets all Skill requirements for the next rank.  
* The rank exists in the same Job progression.  
* Any optional time-in-rank or Event requirements are satisfied.

The first version does not need salary, performance reviews, or manager approval, but it must ensure that skill progression can result in observable career progression.

# **Actions and Events**

Let’s do a full sweep on the recently created Actions and Events in their respective JSON files looking for candidates for generalization.

We do not want to have a discrete Action that is `Grab a pencil`, whose consequence is adding a pencil object to the inventory of that Person.

We want `Grab X`, with a consequence adding X to the Person’s Possessions.

A Continuous Action of type sequence may then bind or hardcode that generic parameter. For example, `Writing` may require a pencil and include a child `Grab` Action whose `object` parameter is bound to `pencil`.

Discrete Actions should be as general as possible, as should Events that are a consequence of Discrete Actions.

This does not mean all Actions should become vague untyped commands. Generic Actions must remain strongly parameterized and validated.

For example, `Grab X` should require:

* A parameter representing an Object archetype, Object Instance, or constrained Object selector.  
* A matching Object Instance exists in the current building.  
* The Object Instance is accessible.  
* The Object is carryable.  
* The Object is pocketable if the destination is a pocket-like container rather than merely being carried.  
* The Person has a compatible inventory/container destination.  
* The Object is not protected by a conflicting ownership or access rule.

Its consequence should move a concrete Object Instance from the building or world inventory into the Person’s Possessions. It should not conjure a new pencil from nothing.

The same approach should be used for Actions such as:

* Give X to Person.  
* Borrow X from Person.  
* Return X to Person.  
* Consume X.  
* Place X.  
* Store X.  
* Discard X.  
* Use X.  
* Buy X.  
* Sell X.  
* Repair X.  
* Clean X.

A sequence-based Continuous Action may bind specific values, such as `pencil`, `raw dough`, or `baked dough`, while the underlying discrete Action remains reusable.

## **Event generalization**

Events should not merely duplicate every low-level Action log entry.

Actions already record that a Person grabbed a pencil. Events should be used when a meaningful state change, history entry, or downstream simulation trigger is needed.

For example, generic Events may make sense for:

* Object Acquired.  
* Object Given.  
* Object Received.  
* Object Lost.  
* Object Consumed.  
* Job Applied For.  
* Job Started.  
* Job Rank Promoted.  
* School Started.  
* School Completed.  
* Action Failed.  
* Action Declined.

The Event should be parameterized with the relevant Object, target Person, Job, rank, failure reason, or Action instance rather than creating a separate Event for every specific pencil, cake, or object type.

The Action/Event backfill pass should identify cases where:

* A specific Action should become generic.  
* A specific Event should become generic.  
* An Event is redundant because the Action log already captures everything required.  
* An Event should be retained because Brain, Jobs, relationships, or future systems need to react to it.  
* A sequence should bind a generic Action to a specific object or target.  
* Existing parameter names or types are inconsistent and need migration.

# **Contextual building objects and tags**

Buildings should be filled on generation with all kinds of random Objects that are contextual to them being a house or a particular business.

Look into the planning file in the docs folder where Objects were separated by setting. Use that data as input, but do not store runtime data as the original one-category-per-list document.

Instead, create a many-to-many tag system.

Each Object definition should have a list of placement/context tags, and each building or business definition should also have a set of tags.

For example:

* A house may have tags such as `bedroom`, `bathroom`, `kitchen`, `living-room`, `laundry`, `storage`, and `home-office`.  
* A school may have tags such as `classroom`, `staff-room`, `cafeteria`, `playground`, and `office`.  
* A clinic may have tags such as `reception`, `exam-room`, `medical-storage`, `office`, and `waiting-room`.  
* A park may have tags such as `playground`, `bench-area`, `walking-path`, and `outdoor`.  
* An Object such as a toothbrush may have `bathroom`.  
* A pencil may have `classroom`, `office`, `home-office`, and `school-supplies`.  
* A frying pan may have `kitchen`.  
* A medical bandage may have `exam-room`, `medical-storage`, and `first-aid`.

Because we are not simulating individual rooms inside a building and will not do so, tags should represent available environmental context inside the building rather than precise room coordinates.

The generation algorithm should:

1. Resolve the building’s tags from its building type, business definition, and any explicit overrides.  
2. Find Object definitions whose placement tags intersect with the building’s tags.  
3. Use per-Object generation metadata to choose plausible Object Instances.  
4. Create instances with deterministic seeded randomness.  
5. Assign initial owner/container/location to the building, business, household, or other appropriate world inventory.  
6. Avoid absurd duplicates through maximum counts, uniqueness rules, and weighted generation controls.

Object placement metadata should support at least:

* Placement tags.  
* Generation weight.  
* Minimum and maximum instances per building.  
* Whether the Object is unique per building.  
* Whether it is a fixture, consumable, reusable item, or loose carryable Object.  
* Ownership default.  
* Accessibility rules where needed.

This must be validated. An Object with placement tags should reference known tags, and business/building definitions should not reference tags that do not exist.

The recently implemented Object and Possessions system should be extended so Action requirements can query Objects available in the current building.

For example:

* `Cooking` should require a suitable kitchen context and required ingredients/tools.  
* `Writing` should require access to a pencil, pen, computer, or another valid writing instrument.  
* `Taking a shower` should require a bathroom context.  
* `Playing at a playground` should require a playground-compatible building or outdoor context.  
* `Pocketing an Object` during `Wandering around` should require a valid loose Object Instance in the current building.

# **Person-targeted Actions, consent, and failure**

With Actions that involve another Person as a parameter and where that target is not the same Person performing the Action, we need a property named `askFirst`.

Punching someone does not ask consent first.

Kissing, hugging, giving an Object, borrowing an Object, inviting someone somewhere, and marrying require consent.

For this first version, every Action targeting another Person must have an explicit interaction contract, including:

* Which parameter identifies the target Person.  
* Whether the Action requires the target to be in the same building.  
* Whether `askFirst` is required.  
* Whether the Action can target the acting Person.  
* How failure should affect a parent sequence, if the Action is used as a sequence child.

For this initiative, Actions targeting another Person should require the target to be in the same building. Do not introduce remote interactions such as phone calls or online communication yet.

This should be expressed as an Action-level capability, such as `requiresSameBuilding`, rather than copied as a fragile requirement-query fragment onto every Action.

The Action validator must reject Person-targeted Actions that do not explicitly declare their co-location behavior.

## **Consent flow**

When a Person attempts an Action with `askFirst: true`:

1. The initiating Person’s Brain proposes the Action through normal Action selection.  
2. The Action engine validates all normal requirements, including same-building co-location.  
3. Before normal consequences run, the Action engine makes a consent request to the target Person’s Brain.  
4. The target Brain evaluates the request using the Action, source Person, target Person, parameters, relationship context, and current tick.  
5. For now, the target Brain should return `yes` with an 80% deterministic seeded probability and `no` otherwise.  
6. Future work should replace this placeholder with contextual logic based on relationship quality, personality, mood, past Events, current activity, risk, and Action type.  
7. If consent is accepted, the Action continues normally.  
8. If consent is declined, the Action resolves as failed.

The initial 80% chance must be deterministic for a given simulation seed, Action instance, source Person, target Person, and tick. Bootstrap generation must not create different social histories merely because execution order changed.

## **Action failure**

This means we need to handle Action Failure in both Brain and logs.

An Action should have an explicit outcome lifecycle, including at least:

* Completed.  
* Failed.  
* Interrupted.  
* Blocked.  
* Waiting for materialization.

A consent decline should resolve as:

* Outcome: `failed`.  
* Failure reason: `consent_declined`.  
* No normal Action consequences.  
* No successful Action Event consequences.  
* A traceable Action log entry containing source Person, target Person, Action parameters, timestamp, causation ID, and failure reason.

A generic `Action Failed` or `Action Declined` Event may be triggered only where downstream simulation needs it. Do not create redundant life Events for every failed low-level interaction by default.

Brain should consume the failed Action result:

* Remove the failed intent from the current decision cycle.  
* Do not automatically retry the same Action.  
* Do not immediately select the same Action again in response to the failure.  
* Continue normal decision-making at the next appropriate hook or tick.  
* Respect any Action-configured cooldown after failure.

For sequence-based continuous Actions, a child Action failure should fail or interrupt the parent sequence by default unless the sequence explicitly declares the child optional or provides an alternate branch. A rejected `Give X to Person` should not silently continue a sequence as though the Object changed hands.

# **Data and backfill expectations**

This initiative includes substantial data backfill work.

The data work should include:

* At least 15 basic Skills.  
* At least 20 specific Skills replacing each current generic Skill family.  
* Dependency relationships between basic and specific Skills.  
* Job rank definitions for every existing Job.  
* Skill requirements and daily progression declarations for each rank.  
* Explicit entry-level training grants where the temporary College shortcut is needed.  
* Generalized Actions replacing overly specific object Actions.  
* Generalized Events where an Event remains useful after Action generalization.  
* Building/business tags.  
* Object placement tags and generation metadata.  
* Co-location and consent declarations for Person-targeted Actions.  
* Updated Action requirements that consume Objects generated in buildings.

Every migration should be validated against existing logs, seed data, and bootstrap generation where applicable. Do not leave legacy generic Skills or obsolete highly specific Actions as silent unused data.

# **Actual tasks**

Each item below should become its own `.md` task file. The exact numbering should follow the current task index and dependency conventions in `/docs/tasks/README.md`.

1. Discovery and migration baseline  
   * Inventory the current Calendar, Brain, Skills, Jobs, Actions, Events, Objects, Buildings, and bootstrap APIs.  
   * Identify legacy Skill IDs, generic Actions, generic Events, Job definitions, and relevant data files.  
   * Confirm existing school/building assignment behavior.  
   * Record migration assumptions and compatibility risks before changing data schemas.  
2. Implement calendar weekday support  
   * Add deterministic day-of-week calculation.  
   * Add `isWeekend`.  
   * Ensure hourly ticks resolve to a stable calendar date and weekday.  
   * Add tests covering weekday rollover across years.  
3. Implement school scheduling and weekend behavior  
   * Define school assignment and weekday schedule behavior.  
   * Update Brain so Persons aged 7 through 17 attend school on weekdays when validly assigned.  
   * Prevent school attendance on weekends.  
   * Update Brain so Persons age out of school and become job-search eligible at 18\.  
   * Preserve the same behavior in live and bootstrap execution contexts.  
4. Rework the Skill schema and validator  
   * Replace string-only Skills with proficiency-bearing Skill definitions and Person Skill records.  
   * Remove the `Skill` suffix from Skill IDs and names.  
   * Implement dependency graph parsing and validation.  
   * Reject cycles, missing dependencies, invalid thresholds, and generic legacy Skills.  
   * Add Skill-related validation to CI.  
5. Define and backfill basic Skills  
   * Add at least 15 basic school Skills with no dependencies.  
   * Confirm that only basic Skills may use broad fields-of-study names.  
   * Add useful metadata and tags for future Job and Action integration.  
6. Replace generic Skill families with specific Skills  
   * Break every existing generic Skill family into at least 20 specific ability-based Skills.  
   * Add appropriate dependency relationships.  
   * Create explicit migration mappings or replacement rules for old data.  
   * Ensure no legacy generic Skills remain silently referenced.  
7. Implement Person Skill initialization and early-childhood seeding  
   * Ensure newborns may have no Skills.  
   * Ensure non-newborn Persons receive age-appropriate foundational Skills.  
   * Seed school-age Persons from school attendance history.  
   * Seed adults with all basic Skills at `60.0` and contextual non-basic Skills.  
   * Make bootstrap generation deterministic.  
8. Implement school-day Skill progression  
   * Calculate each Person’s eligible weekday count between ages 7 and 18\.  
   * Award all basic Skills once per completed school day.  
   * Ensure perfect attendance reaches `60.0` at age 18\.  
   * Ensure missed attendance results in lower proficiency.  
   * Prevent duplicate progression credit in one calendar day.  
9. Implement Job rank schema and entry-level training grants  
   * Add ranks, entry-level designation, Skill requirements, progression declarations, and training-grant configuration to Jobs.  
   * Require exactly one entry-level rank per Job.  
   * Implement the explicit College/training shortcut for entry-level hiring only.  
   * Prevent Skill farming through repeated failed applications.  
   * Revalidate dependencies and requirements after onboarding grants.  
10. Implement job Skill progression and promotion  
* Award primary Job Skills at approximately `0.02739726` per completed full work day.  
* Support secondary Skill multipliers.  
* Prevent duplicate progression credit for the same Person and work day.  
* Add deterministic rank-promotion evaluation.  
* Ensure ranks affect real Job behavior and are not merely data.  
11. Backfill existing Jobs with ranks, Skills, and progression  
* Add entry-level and higher ranks to each existing Job.  
* Replace generic Skill requirements with specific Skills.  
* Add valid entry-level training grants where required.  
* Define rank-appropriate work Actions and Skill progression.  
12. Generalize Actions and Events  
* Sweep current Actions and Events for overly specific candidates.  
* Replace object-specific Actions with generic parameterized Actions where appropriate.  
* Replace redundant object-specific Events with generic parameterized Events where appropriate.  
* Preserve specific parameter bindings in sequences such as Writing, Cooking, or other continuous Actions.  
13. Implement contextual Object placement tags  
* Add many-to-many placement tags to Object definitions.  
* Add contextual tags to building and business definitions.  
* Add validation for known tags and valid generation metadata.  
* Ensure tags represent building-level environmental context rather than nonexistent room simulation.  
14. Implement deterministic contextual Object generation  
* Populate houses and businesses with plausible Object Instances based on intersecting tags.  
* Support weights, minimums, maximums, uniqueness, ownership, and accessibility.  
* Ensure generated Objects are available to Action requirements and consequences.  
* Add deterministic bootstrap tests.  
15. Backfill Action requirements from building context  
* Require contextually valid Objects and tags for Actions such as Cooking, Writing, Showering, Playing, Grabbing, Pocketing, and similar Activities.  
* Ensure generic Object Actions transfer real Object Instances rather than creating new Objects without a source.  
* Update sequences to bind generic child Actions to specific required Objects.  
16. Implement Person-targeted Action interaction contracts  
* Add target Person declaration, same-building behavior, `askFirst`, and sequence failure behavior to the Action schema.  
* Validate all Person-targeted Actions.  
* Require same-building co-location for this iteration.  
17. Implement consent evaluation and Action failure handling  
* Route consent checks through the target Person’s Brain.  
* Implement deterministic 80% placeholder approval.  
* Implement failed Action outcomes, failure reasons, logs, and no-retry behavior.  
* Ensure failed Actions do not apply normal consequences.  
* Ensure failed child Actions correctly fail or interrupt sequences by default.  
18. Backfill Person-targeted Actions  
* Mark consent-required Actions such as kissing, hugging, giving Objects, borrowing Objects, invitations, and marriage.  
* Mark non-consent Actions such as punching where appropriate.  
* Add same-building requirements.  
* Add generic failure/decline Events only where downstream systems need them.  
19. End-to-end simulation validation and documentation  
* Add deterministic tests for school weekdays, school Skill progression, job training grants, job Skill progression, promotion, contextual Object generation, generic Object Actions, consent, and Action failure.  
* Run the same scenario in live and bootstrap modes and compare simulation-state outcomes after materialization differences are resolved.  
* Document the Calendar → Brain → School/Job → Skills → Actions/Events flow.  
* Document the Building Tags → Object Generation → Action Requirements → Possessions flow.

