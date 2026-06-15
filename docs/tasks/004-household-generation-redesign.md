# [Planning] Redesign family generation → household + cross-household genealogy

- **Type:** Planning / Architecture proposal
- **Labels:** `planning`, `simulation`, `architecture`, `no-code-required`

## Summary

This is a **planning/proposal task** (not an implementation task). Produce a concrete architectural
proposal to **replace the current family-tree generation system with a household generation system**
that supports **family trees spanning multiple households** while keeping each household's
composition **coherent with the people's simulated histories**.

The desired feel is **hard simulation, à la Dwarf Fortress — not procedural hand-waving**. People
should have real histories, and their placement into households should follow from those histories.
For example: looking into a house, you find a child living with their adult brother — and checking
their parents reveals the parents are deceased. (Implementing **death** is part of enabling this
example; the proposed architecture must allow it.)

The deliverable is a written proposal (added to this task file or a linked design doc) plus, if
useful, a follow-up implementation task breakdown. **No production code is required for this task.**

## Background / current state (must be verified during exploration)

- **Trigger:** `City.setupHousehold()` runs on the `houseBuilt` event, creates a `Family(house)`,
  and calls `family.autoGenerate(Game)`.
- **`Family.ts`** generates members with a recursive, **credit-based** algorithm:
  `autoGenerate()` picks a random member count, creates a first adult, then
  `generateBaseRelationships()` → `generateSpouse()` / `generateChildren()` recurse, followed by
  `assignExtendedRelationships()` which derives siblings, grandparents, uncles/aunts, and
  nieces/nephews. It is conditional-heavy and hard to test.
- **`SocialLife.ts`** stores a `RelationshipMap` (`types/Social.ts`) with single-valued
  (father/mother/spouse) and array-valued (children/siblings/etc.) relationships, plus the person's
  `home` (`House`) and identity (name/age/gender). Names come from `@faker-js/faker` (`fakerPT_BR`).
- **Limitations to address:** the current system is complex and conditional-heavy, hard to test,
  and still **cannot represent simple real-life arrangements** like roommates, or a child living
  with an aunt because the parents died. Relationships are confined **within a single household**;
  there is no genealogy that crosses households (e.g. an elderly couple whose grown child now heads
  their own separate household with their own spouse and children).
- There is currently **no concept of time/age progression or death**.

## Goals (of the proposal)

The proposal must address, at minimum:

1. **Two-fold architecture (or a justified alternative).** Evaluate the maintainer's suggested
   approach: at **new-save creation**, generate a large pool of **thousands of intertwined family
   trees / a population genealogy**; then during gameplay, **draw from that pool** to populate
   individual households as houses are placed, preserving cross-household coherence. Propose this or
   a better-justified alternative, with trade-offs (memory, save size, determinism, performance).
2. **Cross-household family trees.** A single genealogical tree must be able to span multiple
   households; placing a house pulls a coherent slice of the existing population rather than
   inventing an isolated island.
3. **Households ≠ families.** Model a household as a *living arrangement* (who lives together and
   why) distinct from blood/marriage relations. Must naturally represent: nuclear families,
   roommates, a child living with an adult sibling or an aunt, single occupants, multi-generational
   homes, etc.
4. **History-driven coherence.** Each person should carry enough simulated history (birth, parents,
   key life events, death) that their household placement is explainable by that history.
5. **Death (enabling).** Specify how death is represented so scenarios like "lives with sibling
   because parents are deceased" are expressible. (Death mechanics/aging-over-time can be a separate
   implementation task, but the data model must support it.)
6. **Testability.** The new design must be substantially more unit-testable than the current
   recursive generator — favor pure, deterministic, seedable functions over deeply conditional
   stateful recursion.
7. **Integration points.** Specify how the new system interacts with: the `houseBuilt` flow and
   `City`, the `Person`/`SocialLife` model and `types/Social.ts`, the save/load system
   (see `003-save-load-system.md` — genealogy must be serializable; the pool likely lives in the
   save), and the future clock system (see `005-clock-and-calendar-system.md`).
8. **Migration.** Describe how to retire `Family.autoGenerate()`'s recursive logic and what changes
   to `Family.ts` / `SocialLife.ts` / `types/Social.ts` are implied.

Explicitly **non-goals / constraints:**

- **Do not go fully procedural.** Prefer the hard-simulation approach (persistent histories) over
  generating relationships on the fly with no backing history.

## Deliverables

- A written architecture proposal covering all points above, with the chosen model, data
  structures, generation algorithm (pool creation + household draw), and serialization implications.
- A proposed phased **implementation task breakdown** (candidate follow-up tickets), e.g. data model
  + pool generation, household draw on placement, death/aging, family-tree UI updates.
- Open questions / decisions requiring maintainer input, surfaced explicitly.

## Acceptance criteria

- Proposal is reviewed and approved by the maintainer before any implementation task is opened.
- The proposal demonstrably supports the "child living with adult sibling because parents are
  deceased" and "roommates" scenarios.

## Notes

- Keep the genealogy pool deterministic/seedable so saves are reproducible and testable.
- Consider how the existing D3 family-tree window (`hud/windows/HouseDetails.tsx`,
  `hud/d3/familyTree.ts`, `Family.getFamilyTree()`) would render trees that now cross households.
