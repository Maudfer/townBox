# [Content] Backfill Action requirements from building context

- **Type:** Content / Migration
- **Labels:** `actions`, `objects`, `content`, `progression-arc`
- **Depends on:** [068](068-generalize-actions-and-events_DONE.md) (generic verbs), [069](069-object-placement-tags.md) + [070](070-contextual-object-generation.md) (context exists to require)

## Goal

Actions consume the generated world: `cooking` needs a kitchen context and ingredients/tools; `writing` needs a
writing instrument; showering needs a bathroom context; playground play needs a playground context; pocketing
needs a real loose instance present. Generic object verbs transfer **real instances** — the era of
requirement-free activities and conjured objects ends here.

## Background (verified)

The machinery all exists: `objectAtLocation`/`carries` predicates match archetype/tag/flag (and params after
067); OAR `context` supports `objectAtLocation` (the oven precedent — and tag-based queries already validate);
070 fills buildings. What's missing is the **data pass**: most of the 255 actions have thin or no environmental
requirements, and some consequences create objects from nothing where a transfer is now correct.

## Requirements

- **Requirement backfill** over the leisure/maintenance/social/work repertoires (the 068 classification table
  is the worklist): each activity that plausibly needs context declares it via `objectAtLocation` (placement-tag
  or archetype/flag queries — e.g. cooking: a `kitchen`-context fixture like stove/oven + `carries`/OAR
  ingredients; watching TV: a television at location — some of these exist, audit and align; shower: a
  `bathroom` fixture; playground play: `playground` context). Prefer **tag queries** over archetype lists where
  the intent is "any suitable X" — that's what the tag axis is for.
- **No conjuring audit:** sweep every `createObject` consequence — each either becomes a move/transfer of a
  real instance (grab/pocket/buy-from-stock), stays justified (genuine creation: cooking outputs, work
  products, purchases where stock modeling is explicitly deferred — each with a comment/marker), or is removed.
  Resolve 068's marked `buy` fallback where 070 now stocks the relevant business type (shops sell from
  location/business stock; money via the existing `adjustMoney`).
- **Sequence bindings:** continuous activities bind their generic children to the objects their requirements
  established (writing binds `grab(object=pencil-or-instrument)`; cooking chains keep OAR identity flows) —
  per-child requirements in pools re-checked (043 machinery).
- **Reachability, extended:** grow the 053-pattern reachability test into a **world-aware** one — for every
  action requirement, some plausibly generated building (fixture town: house + one of each business) satisfies
  it, so no activity is dead-on-arrival in normal play. Requirements satisfiable only in exotic worlds get
  flagged and fixed (weaken the requirement or extend 069 data).
- Anti-frustration balance note: Brain's hard-gate filter already excludes unsatisfiable actions from free-time
  selection — after this pass, verify selection variety on the fixture town doesn't collapse (a person at home
  must still have a healthy candidate set; tune requirements/weights, record before/after counts in the PR).

## Non-goals

New activities. Consent/person-target contracts (072–074). Economy stock/restock loops (070 non-goal carried).
Grammar changes (067 closed).

## Testing

- Per-flagship-activity tests: cooking blocked without kitchen context / runs with it; writing requires an
  instrument via binding; shower/playground gates hold; pocketing only fires with a real loose instance and
  moves exactly it.
- The world-aware reachability suite passes for every action in the manifest.
- Conjuring audit pinned: `test/consequences.test.ts`-style assertions that grab/buy move existing instances
  (inventory count conservation where applicable).
- Free-time variety guard on the fixture town (candidate-set floor).
- `npm run docs:sim` regenerated; validators green.
