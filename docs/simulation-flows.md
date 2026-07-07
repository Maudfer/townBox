# Simulation flows: how Actions, Events, Objects and the Brain interlock

The enrichment arc (tasks 038–053) made Actions and Events deliberately coupled *at the data level*:
actions fire events on lifecycle transitions, events are invokable by actions and systems, and object
transformations ride on action commits. This document walks the load-bearing flows through real,
shipped data so a contributor can hold the whole loop in their head. The mechanical, always-current
relationship tables are generated from the manifests into
[simulation-relationships.md](simulation-relationships.md) (`npm run docs:sim`; a checked-diff test
keeps it honest).

Cast of components (all under `src/app/game/`): `TickRunner` (the shared 9-phase per-tick lifecycle,
both execution modes), `Brain` (stateless decisions → intents), `JobOrchestrator` (the job-context
Brain hook), `ActionEngine` (discrete commits + continuous instances), `EventEngine` (rolls, invokes,
schedules), `Consequences` (the bounded mutation DSL + OAR executor), `Inventory` (object instances),
and the **execution boundary** (`WorldAdapter`: `LiveWorld` resolves transitions via real commutes,
`BootstrapWorld` immediately — same records either way, never an `if bootstrap`).

## 1. Waking up → obligation → commute → work

The daily anchor. `sleep` completing fires `woke_up`; the Brain reacts to the commit, the Job
Orchestrator starts the shift's work action at the person's own workplace, and the action's location
requirement is what actually causes the commute — "Started working" is logged on *arrival*, never at
departure.

```mermaid
sequenceDiagram
    participant AE as ActionEngine
    participant EE as EventEngine
    participant B as Brain (hooks)
    participant W as WorldAdapter
    AE->>EE: sleep completes → invoke woke_up (source: action, causation: lifecycle entry)
    EE-->>B: onEventCommitted(woke_up)
    B->>B: JobOrchestrator hook: on shift? rotate the job's continuous work repertoire
    B->>AE: intent: start working_the_kitchen @ own workplace (locationOverride)
    AE->>W: requestTransition(person, building:key) — instance: waiting_for_materialization
    Note over W: LiveWorld: TravelStep commute, resolves on arrival<br/>BootstrapWorld: resolves this tick
    W-->>AE: handle arrived → instance: running
    AE->>EE: onStart → invoke started_working
    Note over B: status derives from the instance:<br/>commuting → working (nothing new serialized)
```

## 2. Shift end → completion, and the automated fallback

Off shift, the orchestrator requests completion: employer-owned work outputs are already in the
business inventory, and `stopped_working` commits. If nothing does it (a stuck lifecycle, an edge the
orchestrator missed), the event's own **automated schedule rule** — `afterEvent started_working
+12 ticks` with a `once: perDay` limit — sweeps the same event through the persisted queue, so a
workday always closes exactly once, whichever path fires first (048).

```mermaid
flowchart LR
    A[started_working commits] -->|schedules| Q[(automated queue<br/>afterEvent +12 ticks)]
    A --> S[shift runs]
    S -->|off shift| O[JobOrchestrator: complete work action]
    O -->|onComplete/onInterrupt| E[stopped_working<br/>limit: once perDay]
    Q -->|12 ticks later| E
    E -.->|already committed today?<br/>limit suppresses the double| E
```

## 3. Cook-and-eat: object transformations on action commits (044/053)

Continuous actions orchestrate discrete children; each discrete commit applies the FIRST satisfiable
object-action-relationship entry against the person's carried instances — two-phase atomic, so a
missing ingredient is a typed `inputsUnavailable` with zero mutations. Ingredients come from the
shopping actions, so the whole chain is reachable in normal play.

```mermaid
flowchart TD
    ST[shopping_trip] -->|pool child| BG[bought_groceries: +flour, +tomato]
    ST -->|pool child| FI[picked_up_fresh_ingredients: +potato, +onion, +lettuce, +egg]
    CM[cooking_meal @ home<br/>requires carries ingredient] -->|pool child| P[plated_the_meal]
    P -->|OAR, first satisfiable| R1[lettuce + tomato → 2× caesar_salad]
    P -.-> R2[2× potato + onion → 2× meatloaf_slice]
    P -.-> R3[bread + butter → 2× garlic_bread]
    CM -->|pool child| EAT[ate_a_meal<br/>consumes one carried meal]
    CM -->|onComplete| EV((tried_new_recipe))
    R1 -->|provenance = commit seq| EAT
```

The bake-a-cake reference chain (044) is the same shape with a **sequence** instead of a pool:
`mix_dough` (flour+eggs → `raw_dough`, bound as `$previous.output`) → `bake_dough` (transformed in
place, oven required at the location) → `add_topping` (+cream → one `cake`, identity preserved).

## 4. A gift, end to end: the causation chain

Social object transfer with every link recorded. Ownership and containment are independent axes
(041), and each arrow below lands in the ONE append-only per-person log with a `causationId` pointing
at what caused it — the inspector renders the chain directly.

```mermaid
sequenceDiagram
    participant B as Brain (free-time)
    participant AE as ActionEngine
    participant C as Consequences
    participant I as Inventory
    participant EE as EventEngine
    B->>AE: intent: gave_object_to_person (target: relative) — requires carries giftable
    AE->>AE: commit → log entry seq N (triggerSource: brain)
    AE->>C: consequence op: transferObject {carried: giftable} → owner: targetPerson
    C->>I: transferOwnership(instance) — container unchanged (still carried by the giver)
    AE->>EE: onComplete → invoke gave_gift (source: action, causationId: N)
    EE->>EE: commit gave_gift → log entry seq N+1, causationId N
    Note over I,EE: the instance's provenance, the action entry, and the event entry<br/>all trace back to seq N — one auditable chain
```

## Where the boundaries are

- **Pure data:** new events, actions, OAR entries, archetypes, job repertoires — files only, gated by
  the schema registry (039) and the reachability/statistical tests.
- **Code changes:** new effect kinds, Context attributes, consequence ops, predicate node types,
  Brain hooks. Deliberate and rare (038's flexibility line).
- **Execution boundary:** anything that needs physical presence requests a transition through the
  `WorldAdapter` and waits (`waiting_for_materialization`); only the *wait* differs between live and
  bootstrap. If you find yourself writing `if (mode === 'bootstrap')`, stop — that's the line the
  whole arc exists to hold.
