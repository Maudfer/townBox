# [Core] Actions: definitions, parameters, shared requirements, lifecycle, pools & sequences

- **Type:** Core system / Simulation + Data
- **Labels:** `framework`, `actions`, `data`, `enrichment-arc`
- **Depends on:** [040](040-hourly-ticks-and-execution-boundary_DONE.md) (lifecycle phases 1–2 & 8, boundary, logs), [041](041-objects-and-possessions.md) (object requirements), [042](042-event-triggers-and-causation.md) (actions trigger manual events)
- **Blocks:** [044](044-action-consequences-and-object-action-relationships.md) (consequences), [045](045-job-shifts-and-work-actions.md)–[047](047-job-orchestrator.md) (brain/jobs consume actions), [051](051-actions-data-backfill.md) (content)
- **Explicitly deferred to 044:** consequences. Actions in this task log, lifecycle, and trigger events — they do not yet mutate objects/world.

## Goal

The Action system of [038 §7](038-simulation-enrichment-architecture_DONE.md): a new **`actions.json`** schema plus a scene-free **`ActionEngine`**. Actions are what people *do* (sleep, cook, commute, work, shower); Events are what *happened*. Discrete Actions are instantaneous and log-worthy ("Cut onion"); continuous Actions span ticks with a full lifecycle and can orchestrate children.

## Background (verified)

- No action/activity concept exists in the simulation layer; the only "doing" state is the visual `TravelStep` travel machine (038 §1.3).
- The requirement/query substrate to reuse is the `Predicate` AST (`util/predicate.ts:9–47`) + `SimulationContext` (`types/Simulation.ts:21`); its full grammar is inventoried in 038 §1.6. **First implementation step: re-verify that inventory against current code** (it may have drifted by the time this task starts) and extend the *one* system rather than forking an Actions-only filter dialect. Long-term: one explicit, versioned, JSON-safe query expression system shared by Events and Actions.

## Requirements

### Schema — `actions.json`
- Per action: `id`, `label`, `type: 'discrete' | 'continuous'`, `category` (obligation / leisure / social / recovery / …), **requirements** (shared predicate system), **parameters**, **selection** metadata (base weight, modifiers, cooldowns, preferred contexts — consumed by Brain in 046 but defined here so the schema is complete), optional `children` (continuous only), optional event links (`triggersEvents`: which manual events fire on start/complete/interrupt — validated both directions per 038 §6/§7).
- Registered in the 039 registry: structural + semantic validation (dangling event refs, dangling child action refs, sequence loops, parameter binding type mismatches).

### Requirements (shared system, extended)
- Extend the predicate grammar with: past-**Action** log queries (mirror of `hasEvent` — `hasAction` with time-range/count params over the 040 log), Person **location** checks (via `WorldAdapter.locationOf`), Brain `status` (enum lands in 046; validator-gate until then), **possessions/objects-at-location** checks (041), and parameterized time ranges. Version the grammar (`predicateVersion`) as part of this extension.
- Requirement evaluation is mode-agnostic: everything resolves through the `ExecutionContext`.

### Parameters
- Typed, required/optional: `Person`, `ObjectArchetype`, `ObjectInstance`, `recipe`/data-ref, scalars. The type system **distinguishes archetype refs from instance refs** ("cake" the recipe vs. "this dough in my Possessions").
- Named bindings across the action graph: `$parent.<param>`, `$previous.output`, `$action.target`. The validator checks every referenced binding exists and is type-compatible.

### Lifecycle & engine
- Discrete: invoked → requirements checked → committed → logged (consequences later attach at this commit point, 044).
- Continuous: `pending → waiting_for_materialization → running → completed | interrupted | blocked | failed`. Location-needing actions request transitions through the 040 boundary and sit in `waiting_for_materialization` (live) or pass through it same-tick (bootstrap). Ends by: external interruption (Brain/obligation, 046), an action-specific completion condition (duration ticks or predicate), or sequence end.
- Runs inside the 040 `TickRunner` phases: advance continuous (1), resolve due children (2), start/interrupt/complete/wait (8).
- **Log entries** (040 log, `kind: 'action'`): action instance id, definition id, person id, parameters snapshot, start/end ticks, outcome, parent instance id, causation id.
- Event integration: lifecycle transitions fire the declared manual Events through `EventEngine.invoke` with `triggerSource: 'action'` and the action instance as causation (e.g. Work start → `started_working` — the event fires when the Action *starts*, not when commuting begins).

### Children (continuous only)
- **`pool`**: refs to discrete children with base weight/selection chance, per-tick chance, `maxPerTick`, cooldowns / max total occurrences, per-child requirements, immediate-repeat allowance. Same-tick selections are **interleaved**: identical children may not run consecutively within a tick unless no other eligible child exists (this is the limit of sub-tick simulation).
- **`sequence`**: ordered steps (discrete or nested continuous refs), each step consuming `$previous`/`$parent` bindings; step failure policies (`blockParent | skipStep | failParent`); parent completion may validate/transfer/expose the final child output but must **not duplicate** outputs (enforced when consequences land in 044).

## Non-goals

Consequences & object transformations (044). Brain/selection runtime (046). Content beyond a handful of exercising fixtures (051). UI beyond appending action entries to the existing person log window.

## Testing

- Validator fixtures: dangling refs, sequence loops, bad bindings, archetype-vs-instance type mismatch.
- Engine: discrete commit + log; continuous full lifecycle including interruption and blocked; pool interleaving rule; sequence binding flow; boundary behavior identical-records in live vs. bootstrap modes (per 040's harness).
- Determinism: same seed → identical action logs; pool child selection reproducible.
