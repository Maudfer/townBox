import type GameManager from 'game/GameManager';

import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import Workplace from 'game/world/Workplace';
import { CityStats } from 'types/City';
import { Tool } from 'types/Cursor';
import constructionConfig from 'json/construction.json';
import { formatTimestamp } from 'util/time';

// The integration-test determinism hook (task 008). Installed on `window.__townbox` ONLY in test mode
// (GameManager.isTestMode) — never in normal production — so the opaque Phaser canvas + real-time sim become
// deterministically assertable from Playwright. It is a read + control seam over the live game, exposed through
// GameManager (which owns the Clock/Field/City) so tests never reach into game internals directly.
//
// Time control: on install the RAF-driven clock is PAUSED, so in-game time only advances when a test calls
// stepTicks(n). stepTicks drives the exact same newDay/newTick/timeChanged cadence the frame loop does, one
// tick at a time and awaited, so `place → stepTicks(24) → assert arrived` has zero wall-clock flakiness.

// Maps the harness's string tool names to the Tool enum used by the placement/build path.
const BUILD_TOOLS: Record<'road' | 'soil' | 'house' | 'work', Tool> = {
    road: Tool.Road,
    soil: Tool.Soil,
    house: Tool.House,
    work: Tool.Work,
};

export interface TileInfo {
    type: 'road' | 'house' | 'work' | 'soil' | 'none';
    row: number;
    col: number;
    // For buildings: whether it is occupied (a house with residents / a workplace with a business).
    occupied?: boolean;
    // The current sprite key (roads change theirs with auto-tiling as neighbours appear).
    assetName?: string | null;
}

export interface PersonInfo {
    personId: string | null;
    name: string;
    x: number;
    y: number;
    indoors: boolean;
    travelStep: string;
    currentBuilding: string | null;
    jobTitle: string | null;
    homeKey: string | null;
    age: number;
}

export interface VehicleInfo {
    x: number;
    y: number;
}

export interface StructureCounts {
    roads: number;
    houses: number;
    workplaces: number;
    occupiedHouses: number;
    businesses: number;
}

export interface ScreenPoint {
    x: number;
    y: number;
}

// --- Movement trace (observation sessions): posthumous pixel-movement / destination / action auditing ---
// Screenshots can't see motion; the tracer can. While active it samples every update frame (scaled sim
// delta), records per-person state-change timelines + positional breadcrumbs, and flags anomalies
// (teleports, render-layer jumps, stuck walkers, sprite overlaps, sprite-audit violations) for
// after-the-fact analysis. Opt-in via startTrace(); zero cost while off.

export interface TraceCrumb {
    ms: number;      // accumulated effective (sim-scaled) ms since startTrace
    tick: number;
    x: number;
    y: number;
    step: string;
    indoors: boolean;
}

export interface TraceStateEvent {
    ms: number;
    tick: number;
    date: string;
    personId: string;
    name: string;
    x: number;
    y: number;
    changed: string[]; // which of the tracked fields changed this frame
    step: string;
    indoors: boolean;
    building: string | null;
    destination: string | null;
    vehicle: boolean;
    action: string | null;       // active instance defId
    actionStatus: string | null; // pending / waiting_for_materialization / running / …
    actionLocation: string | null; // the instance's effective location requirement
    ambulatory: boolean;
}

export interface TraceAnomaly {
    // 'disembark' is the by-design car-exit position sync (V8/M2): classified out of 'teleport' so a real
    // teleport (a bug) alerts at zero noise. 'teleport' means an unexplained logical jump.
    kind: 'teleport' | 'disembark' | 'renderJump' | 'stuck' | 'overlap' | 'spriteAudit';
    ms: number;
    tick: number;
    date: string;
    personId?: string;
    name?: string;
    detail: Record<string, unknown>;
}

export interface TraceReport {
    tracing: boolean;
    frames: number;
    simMs: number;
    startTick: number;
    endTick: number;
    peopleTracked: number;
    totalAnomalies: number;
    anomaliesByKind: Record<string, number>;
    topOffenders: { personId: string; name: string; anomalies: number }[];
}

export interface ActivityCensusRow {
    personId: string;
    name: string;
    x: number;
    y: number;
    indoors: boolean;
    travelStep: string;
    ambulatory: boolean;
    action: string | null;
    actionStatus: string | null;
    actionLocation: string | null;
    currentBuilding: string | null;
    destinationBuilding: string | null;
    jobTitle: string | null;
}

export interface TownboxTestApi {
    // --- Time control ---------------------------------------------------
    // Advance the simulation deterministically by `n` in-game hour ticks (default 1), awaiting each tick's
    // full newDay/newTick lifecycle. Resolves once the sim has fully processed all `n` ticks.
    stepTicks(n?: number): Promise<void>;
    // Drives the render/movement loop deterministically: emits `count` `update` frames of `deltaMs` each, so
    // on-map travel (people walking, cars driving via Field.update) progresses a known amount per call instead
    // of at wall-clock RAF pace. The clock stays paused; only positions/travel advance.
    pumpFrames(count?: number, deltaMs?: number): Promise<void>;
    pause(): void;
    resume(): void;
    getTick(): number;
    getDate(): string;

    // --- Canvas targeting + save (for real clicks / fixture recording) --
    // Centers the camera on tile (row, col) and returns the viewport pixel where that tile now sits, so a test
    // can issue a REAL canvas click there. Returns null if the tile/camera isn't available.
    focusTile(row: number, col: number): ScreenPoint | null;
    // The current world serialized to the save-string format (compressed + base64). Used by the fixture
    // recorder to capture a built scenario without going through localStorage.
    savePayload(): string;

    // --- Deterministic build controls (fixture recording) ---------------
    // Places a structure via the SAME resolve-placement + `tileClicked` path a real click uses (roads snap to
    // the supertile grid, buildings soft-snap to a road side), AWAITING the async household/business setup.
    // Returns the resolved anchor "row-col", or null when the placement is invalid. `tool` is one of
    // 'road' | 'soil' | 'house' | 'work'. (Real canvas clicks are still exercised by the canvas suite.)
    // `blueprintKey` (W7): pins the business exactly like a construction-menu pick — scenario scripts can
    // place a hospital/police station without hand-emitting tileClicked (the aliveness-3 session's #1 gap).
    build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number, blueprintKey?: string): Promise<string | null>;

    // Scenario staffing (W7): a REAL hire into a specific workplace and job title — WorkLife set, rank
    // recorded, the position consumed — so forced scenarios (a doctor on duty, an officer on shift) don't
    // monkey-patch Workplace internals. Returns true when the hire landed.
    hireAs(personId: string, workplaceKey: string, title: string): boolean;

    // Scenario event forcing (W7): EventEngine.invoke with the live state/clock plumbed — one call to make
    // someone fall seriously ill, get arrested, or adopt a dog. Returns the invoke outcome's ok.
    forceEvent(eventId: string, personId: string, params?: Record<string, string | number | boolean>): boolean;

    // Payload-safe person selection (W7): opens the person inspector through the same bus event a real
    // click dispatches — the PersonSelected payload is the Person INSTANCE, and hand-built payloads have
    // crashed the HUD before (the W0 error boundary now contains it; this makes it unnecessary).
    selectPerson(personId: string): boolean;
    // Bulldozes whatever occupies the tile (coherent teardown), awaiting eviction/closure side effects.
    bulldoze(row: number, col: number): Promise<void>;

    // --- World reads ----------------------------------------------------
    tileAt(row: number, col: number): TileInfo;
    structureCounts(): StructureCounts;
    // Anchor identifiers ("row-col") of the placed buildings, split by kind — for targeting a click.
    buildings(): { houses: string[]; workplaces: string[] };
    people(): PersonInfo[];
    personById(personId: string): PersonInfo | null;
    vehicles(): VehicleInfo[];
    cityStats(): CityStats | null;

    // --- Event history --------------------------------------------------
    // The number of committed life-event/action log entries for a pool person (for asserting the sim ran).
    historyLength(personId: string): number;

    // --- Debug escape hatch (observation sessions) -----------------------
    // The live GameManager, for read-only console inspection of every engine/store (needs, mood, the
    // social graph, the per-person log, incidents, …) during manual observation passes. Test mode only —
    // the harness itself never installs outside test mode, so this leaks nothing into normal play.
    debug(): unknown;

    // Advances `ticks` in-game hours, interleaving `framesPerTick` update frames after each tick so on-map
    // movement (commutes, venue walks, chases) actually progresses between ticks. stepTicks alone starves
    // LiveWorld transitions — nobody arrives anywhere, so location-gated actions (sleep at home, work at
    // the workplace) silently stall. This is the honest way to fast-forward live play in an observation
    // or scenario session.
    stepGame(ticks: number, framesPerTick?: number, deltaMs?: number): Promise<void>;

    // --- Movement trace (observation sessions) ---------------------------
    // Begins per-frame sampling of every materialized person: state-change timelines, positional
    // breadcrumbs, and anomaly detection (teleports, render jumps, stuck walkers, overlaps). Restarting
    // clears the previous trace.
    startTrace(): void;
    stopTrace(): void;
    traceReport(): TraceReport;
    // Anomalies, newest last. `kind` filters; `limit` caps (default 200).
    traceAnomalies(kind?: string, limit?: number): TraceAnomaly[];
    // One person's state-change timeline (travel steps, buildings, actions), newest last.
    traceEvents(personId: string, limit?: number): TraceStateEvent[];
    // One person's positional breadcrumbs (sampled every ~250 sim-ms), newest last.
    traceCrumbs(personId: string, limit?: number): TraceCrumb[];
    // A one-call snapshot of what everyone is doing right now (action, status, location, travel state).
    activityCensus(): ActivityCensusRow[];

    // Sprite-vs-state invariants (W8 / proposal simulation-aliveness-3): the standing audit every
    // observation session and the integration suite can assert. All-zero counters = a truthful street.
    auditSprites(): {
        vehicles: number;
        peopleInFlight: number;          // travelStep !== idle
        orphanControlledVehicles: number; // controlled but no person links to it — the P0-2 leak class
        occupiedDriverlessVehicles: number; // occupant flag set but no person links — phantom drivers
        visibleIndoorsPeople: number;     // sim says inside, sprite says visible — the linger class
        orphanSprites: number;            // scene sprite whose backing entity left a live list — V8/M2
    };
}

// Tracked per-person state for the movement tracer.
interface TraceLast {
    x: number;
    y: number;
    ax: number | null; // rendered sprite position (asset), for render-layer jump detection
    ay: number | null;
    step: string;
    indoors: boolean;
    building: string | null;
    destination: string | null;
    vehicle: boolean;
    action: string | null;
    actionStatus: string | null;
    actionLocation: string | null;
    ambulatory: boolean;
}

interface TraceRecord {
    name: string;
    crumbs: TraceCrumb[];
    events: TraceStateEvent[];
    anomalies: number;
    lastCrumbMs: number;
    stillMs: number;
    stuckFlagged: boolean;
    last: TraceLast | null;
}

// Mirrors Person's private walking speed (px/ms) for legit-step math in teleport detection.
const TRACE_PERSON_SPEED = 0.02;
const TRACE_TELEPORT_MIN_PX = 20;
const TRACE_STUCK_MS = 2500;
const TRACE_CRUMB_INTERVAL_MS = 250;
const TRACE_CRUMB_CAP = 4000;
const TRACE_EVENT_CAP = 4000;
const TRACE_ANOMALY_CAP = 10000;
const TRACE_OVERLAP_DIST_PX = 4;
const TRACE_OVERLAP_COOLDOWN_MS = 5000;

// Builds the read/control API object over a live GameManager.
export function createTestApi(game: GameManager): TownboxTestApi {
    const describePerson = (person: Person): PersonInfo => {
        const position = person.getPosition();
        const building = person.getCurrentBuilding();
        const job = person.work.getJob();
        const home = person.social.getHome();
        return {
            personId: person.social.getPersonId(),
            name: person.social.getFullName(),
            x: position?.x ?? 0,
            y: position?.y ?? 0,
            indoors: person.isIndoors(),
            travelStep: String(person.getTravelStep()),
            currentBuilding: building ? building.getIdentifier() : null,
            jobTitle: job ? job.title : null,
            homeKey: home ? home.getIdentifier() : null,
            age: person.social.getAge(),
        };
    };

    // Shared by auditSprites() and the tracer's periodic invariant pass.
    const computeSpriteAudit = () => {
        const field = game.field;
        const people = field ? field.getPeople() : [];
        const vehicles = field ? field.getVehicles() : [];
        const linked = new Set(people.map(person => person.getVehicle()).filter(vehicle => vehicle !== null));
        return {
            vehicles: vehicles.length,
            peopleInFlight: people.filter(person => String(person.getTravelStep()) !== 'idle').length,
            orphanControlledVehicles: vehicles.filter(vehicle => vehicle.isControlled() && !linked.has(vehicle)).length,
            // A car with occupants but no DRIVER aboard can't move — a phantom-passenger car (task 130).
            occupiedDriverlessVehicles: vehicles.filter(vehicle => vehicle.isOccupied() && !vehicle.hasDriver()).length,
            visibleIndoorsPeople: people.filter(person => person.isIndoors() && person.getAsset()?.visible === true).length,
            orphanSprites: game.scene?.countOrphanSprites?.() ?? 0,
        };
    };

    // Reads a person's active instance into the census/trace shape.
    const describeActivity = (personId: string): { action: string | null; actionStatus: string | null; actionLocation: string | null } => {
        const engine = game.actionEngine;
        const active = engine ? engine.activeInstanceOf(personId) : null;
        if (!active || !engine) {
            return { action: null, actionStatus: null, actionLocation: null };
        }
        const location = active.locationOverride ?? engine.getDefinition(active.defId)?.location ?? null;
        return { action: active.defId, actionStatus: String(active.status), actionLocation: location ?? null };
    };

    // ---- Movement tracer state (opt-in; the update handler below no-ops while inactive) ----
    const trace = {
        active: false,
        frames: 0,
        ms: 0,
        startTick: 0,
        people: new Map<string, TraceRecord>(),
        anomalies: [] as TraceAnomaly[],
        overlapCooldown: new Map<string, number>(),
        lastAudit: null as ReturnType<typeof computeSpriteAudit> | null,
    };

    const pushAnomaly = (anomaly: TraceAnomaly): void => {
        if (trace.anomalies.length >= TRACE_ANOMALY_CAP) {
            return;
        }
        trace.anomalies.push(anomaly);
        if (anomaly.personId) {
            const rec = trace.people.get(anomaly.personId);
            if (rec) {
                rec.anomalies += 1;
            }
        }
    };

    const sampleTrace = (rawDelta: number): void => {
        const delta = game.effectiveTimeDelta(rawDelta);
        if (delta <= 0) {
            return;
        }
        trace.ms += delta;
        trace.frames += 1;
        const tick = game.clock?.getCurrentTick() ?? 0;
        const date = game.clock ? formatTimestamp(game.clock.getTimestamp()) : '';
        const people = game.field ? game.field.getPeople() : [];

        for (const person of people) {
            const personId = person.social.getPersonId();
            if (!personId) {
                continue;
            }
            let rec = trace.people.get(personId);
            if (!rec) {
                rec = {
                    name: person.social.getFullName(), crumbs: [], events: [], anomalies: 0,
                    lastCrumbMs: -Infinity, stillMs: 0, stuckFlagged: false, last: null,
                };
                trace.people.set(personId, rec);
            }

            const position = person.getPosition();
            const x = position?.x ?? 0;
            const y = position?.y ?? 0;
            const asset = person.getAsset();
            const ax = asset && asset.visible ? asset.x : null;
            const ay = asset && asset.visible ? asset.y : null;
            const step = String(person.getTravelStep());
            const indoors = person.isIndoors();
            const building = person.getCurrentBuilding()?.getIdentifier() ?? null;
            const destination = person.getDestinationBuilding()?.getIdentifier() ?? null;
            const vehicle = person.getVehicle() !== null;
            const ambulatory = person.isAmbulatory();
            const { action, actionStatus, actionLocation } = describeActivity(personId);

            const last = rec.last;
            if (last) {
                const dist = Math.hypot(x - last.x, y - last.y);

                // Teleport: a logical-position jump beyond what one frame of walking can cover. The
                // by-design car-exit sync (exit-car → walk-to-destination, sprite hidden while driving)
                // is classified as 'disembark' so a real 'teleport' means a bug and alerts at zero noise
                // (V8/M2). Runtime speed is read from the person, so this stays honest once V10 lands
                // per-kind speeds.
                const runtimeSpeed = person.getSpeed?.() ?? TRACE_PERSON_SPEED;
                const maxLegit = Math.max(TRACE_TELEPORT_MIN_PX, runtimeSpeed * delta * 1.5 + 2);
                if (dist > maxLegit && (!last.indoors || !indoors)) {
                    const isDisembark = last.step === 'exit-car' || last.step === 'driving' || last.vehicle;
                    pushAnomaly({
                        kind: isDisembark ? 'disembark' : 'teleport', ms: trace.ms, tick, date, personId, name: rec.name,
                        detail: {
                            from: { x: last.x, y: last.y }, to: { x, y }, dist: Math.round(dist),
                            deltaMs: Math.round(delta), stepBefore: last.step, stepAfter: step,
                            indoorsBefore: last.indoors, indoorsAfter: indoors,
                            action, actionStatus,
                        },
                    });
                }

                // Render jump: the sprite moved much further than the logical position (formation-offset
                // slot flips, depth-sync issues) — the "clip/short-teleport" class the displacement jitter
                // may have introduced.
                if (ax !== null && ay !== null && last.ax !== null && last.ay !== null) {
                    const renderDist = Math.hypot(ax - last.ax, ay - last.ay);
                    if (renderDist > dist + 6 && renderDist > 8) {
                        pushAnomaly({
                            kind: 'renderJump', ms: trace.ms, tick, date, personId, name: rec.name,
                            detail: {
                                logicalDist: Math.round(dist), renderDist: Math.round(renderDist),
                                step, action, actionStatus,
                            },
                        });
                    }
                }

                // Stuck: a walking travel step that hasn't moved for a sustained stretch of sim time.
                const walkingStep = step === 'walk-to-car' || step === 'walk-to-destination';
                if (walkingStep && dist < 0.01) {
                    rec.stillMs += delta;
                    if (rec.stillMs > TRACE_STUCK_MS && !rec.stuckFlagged) {
                        rec.stuckFlagged = true;
                        pushAnomaly({
                            kind: 'stuck', ms: trace.ms, tick, date, personId, name: rec.name,
                            detail: { x, y, step, stillMs: Math.round(rec.stillMs), action, actionStatus, destination },
                        });
                    }
                } else if (dist >= 0.01) {
                    rec.stillMs = 0;
                    rec.stuckFlagged = false;
                }

                // State-change timeline: any tracked field flipping lands one event with the full snapshot.
                const changed: string[] = [];
                if (step !== last.step) { changed.push('step'); }
                if (indoors !== last.indoors) { changed.push('indoors'); }
                if (building !== last.building) { changed.push('building'); }
                if (destination !== last.destination) { changed.push('destination'); }
                if (vehicle !== last.vehicle) { changed.push('vehicle'); }
                if (action !== last.action) { changed.push('action'); }
                if (actionStatus !== last.actionStatus) { changed.push('actionStatus'); }
                if (ambulatory !== last.ambulatory) { changed.push('ambulatory'); }
                if (changed.length > 0 && rec.events.length < TRACE_EVENT_CAP) {
                    rec.events.push({
                        ms: trace.ms, tick, date, personId, name: rec.name, x, y, changed,
                        step, indoors, building, destination, vehicle,
                        action, actionStatus, actionLocation, ambulatory,
                    });
                }
            }

            // Positional breadcrumbs, ring-buffered.
            if (trace.ms - rec.lastCrumbMs >= TRACE_CRUMB_INTERVAL_MS) {
                rec.lastCrumbMs = trace.ms;
                rec.crumbs.push({ ms: trace.ms, tick, x, y, step, indoors });
                if (rec.crumbs.length > TRACE_CRUMB_CAP) {
                    rec.crumbs.shift();
                }
            }

            rec.last = {
                x, y, ax, ay, step, indoors, building, destination, vehicle,
                action, actionStatus, actionLocation, ambulatory,
            };
        }

        // Overlap pass (throttled): visible outdoor people stacked within a few pixels — the "one sprite"
        // class the formation offsets were meant to fix.
        if (trace.frames % 30 === 0) {
            const visible = people.filter(person => !person.isIndoors() && person.social.getPersonId());
            for (let i = 0; i < visible.length; i++) {
                for (let j = i + 1; j < visible.length; j++) {
                    const a = visible[i]!;
                    const b = visible[j]!;
                    const pa = a.getPosition();
                    const pb = b.getPosition();
                    if (!pa || !pb) {
                        continue;
                    }
                    const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
                    if (dist >= TRACE_OVERLAP_DIST_PX) {
                        continue;
                    }
                    const idA = a.social.getPersonId()!;
                    const idB = b.social.getPersonId()!;
                    const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
                    const lastAt = trace.overlapCooldown.get(key) ?? -Infinity;
                    if (trace.ms - lastAt < TRACE_OVERLAP_COOLDOWN_MS) {
                        continue;
                    }
                    trace.overlapCooldown.set(key, trace.ms);
                    pushAnomaly({
                        kind: 'overlap', ms: trace.ms, tick, date, personId: idA, name: a.social.getFullName(),
                        detail: {
                            other: idB, otherName: b.social.getFullName(), dist: Math.round(dist * 10) / 10,
                            at: { x: Math.round(pa.x), y: Math.round(pa.y) },
                            actionA: describeActivity(idA).action, actionB: describeActivity(idB).action,
                            stepA: String(a.getTravelStep()), stepB: String(b.getTravelStep()),
                        },
                    });
                }
            }
        }

        // Sprite-audit pass (throttled): record a violation anomaly whenever an invariant counter changes
        // to a nonzero value.
        if (trace.frames % 300 === 0) {
            const audit = computeSpriteAudit();
            const previous = trace.lastAudit;
            const violated = audit.orphanControlledVehicles > 0 || audit.occupiedDriverlessVehicles > 0
                || audit.visibleIndoorsPeople > 0 || audit.orphanSprites > 0;
            const changedSincePrevious = !previous
                || previous.orphanControlledVehicles !== audit.orphanControlledVehicles
                || previous.occupiedDriverlessVehicles !== audit.occupiedDriverlessVehicles
                || previous.visibleIndoorsPeople !== audit.visibleIndoorsPeople
                || previous.orphanSprites !== audit.orphanSprites;
            if (violated && changedSincePrevious) {
                pushAnomaly({ kind: 'spriteAudit', ms: trace.ms, tick, date, detail: { ...audit } });
            }
            trace.lastAudit = audit;
        }
    };

    // One registration for the harness's lifetime; the guard keeps it free while not tracing. (Never use
    // game.off('update') here — it would clobber Field/clock handlers on the same event.)
    game.on('update', {
        callback: (payload: { time: number; timeDelta: number }) => {
            if (trace.active) {
                sampleTrace(payload.timeDelta);
            }
        },
        context: game,
    });

    return {
        async stepTicks(n = 1): Promise<void> {
            await game.advanceTicks(n);
        },
        async pumpFrames(count = 60, deltaMs = 16): Promise<void> {
            for (let i = 0; i < count; i++) {
                // The clock's advanceTime handler is paused in test mode, so this drives ONLY Field.update
                // (movement) — not the simulation clock.
                await game.emit('update', { time: i * deltaMs, timeDelta: deltaMs });
            }
        },
        pause(): void {
            game.pauseTime();
        },
        resume(): void {
            game.resumeTime();
        },
        getTick(): number {
            return game.clock?.getCurrentTick() ?? 0;
        },
        getDate(): string {
            return game.clock ? formatTimestamp(game.clock.getTimestamp()) : '';
        },

        focusTile(row: number, col: number): ScreenPoint | null {
            const pixel = game.tileToPixelPosition({ row, col });
            if (!pixel || !game.scene) {
                return null;
            }
            game.scene.centerCameraOn(pixel.x, pixel.y);
            const canvas = typeof document !== 'undefined' ? document.querySelector('canvas') : null;
            if (!canvas) {
                return null;
            }
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        },

        savePayload(): string {
            return game.saveManager.serialize();
        },

        async build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number, blueprintKey?: string): Promise<string | null> {
            const field = game.field;
            if (!field) {
                return null;
            }
            const toolEnum = BUILD_TOOLS[tool];
            const placement = field.resolvePlacement(toolEnum, { row, col });
            if (!placement.valid || !placement.position) {
                return null;
            }
            // A pinned blueprint rides exactly like a construction-menu pick (task 108) — including the
            // civic placeholder texture the menu would arm. The textures are generated per menu ENTRY id
            // (civic_landfill), not per blueprint key (sanitation_depot) — resolve through the menu config
            // so harness placements render like real ones (the black-square foot-gun, closed for good).
            const menuEntry = blueprintKey !== undefined
                ? (constructionConfig as { entries: { id: string; blueprint?: string; color?: string }[] }).entries
                    .find(entry => entry.blueprint === blueprintKey)
                : undefined;
            await game.emit('tileClicked', {
                position: placement.position, tool: toolEnum,
                ...(blueprintKey !== undefined ? { blueprintKey, asset: `civic_${menuEntry?.id ?? blueprintKey}` } : {}),
            });
            // Field.build fires houseBuilt/workplaceBuilt fire-and-forget; its household/business setup runs on
            // microtasks. Yield a macrotask so those complete before we return (materialized residents present).
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            return `${placement.position.row}-${placement.position.col}`;
        },

        hireAs(personId: string, workplaceKey: string, title: string): boolean {
            const field = game.field;
            const person = (field ? field.getPeople() : []).find(candidate => candidate.social.getPersonId() === personId);
            const workplace = field?.getStructures().find(structure =>
                structure instanceof Workplace && structure.getIdentifier() === workplaceKey) as Workplace | undefined;
            if (!person || !workplace || person.work.getJob() !== null) {
                return false;
            }
            const preferred = workplace.getOpenPositions().find(position => position.title === title);
            if (!preferred) {
                return false;
            }
            const job = workplace.hire(person, () => true, preferred);
            if (!job) {
                return false;
            }
            person.work.setJob(job);
            person.work.setWorkplace(workplace);
            return true;
        },

        forceEvent(eventId: string, personId: string, params?: Record<string, string | number | boolean>): boolean {
            const clock = game.clock;
            // Route through City so a forced event's signals/commits land their world consequences (V8/M2):
            // a forced crime files a real incident, a forced marriage cohabits. The raw-invoke fallback keeps
            // pre-City test doubles working (arcScenarios constructs no City).
            if (game.city && clock) {
                return game.city.forceEventAndConsume(eventId, personId, clock.getCurrentTick(), params);
            }
            const engine = game.eventEngine;
            const population = game.population;
            if (!engine || !population || !clock) {
                return false;
            }
            const { outcome } = engine.invoke(
                population.getState(), eventId, personId, clock.getCurrentTick(), clock.getTicksPerYear(),
                { source: 'system', causationId: null }, {}, {}, params
            );
            return outcome.ok;
        },

        selectPerson(personId: string): boolean {
            const person = (game.field ? game.field.getPeople() : []).find(candidate => candidate.social.getPersonId() === personId);
            if (!person) {
                return false;
            }
            void game.emit('PersonSelected', person);
            return true;
        },

        async bulldoze(row: number, col: number): Promise<void> {
            const field = game.field;
            if (!field) {
                return;
            }
            const placement = field.resolvePlacement(Tool.Bulldoze, { row, col });
            const position = placement.valid && placement.position ? placement.position : { row, col };
            await game.emit('tileClicked', { position, tool: Tool.Bulldoze });
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        },

        tileAt(row: number, col: number): TileInfo {
            const field = game.field;
            if (!field || !field.isValidPosition(row, col)) {
                return { type: 'none', row, col };
            }
            const tile = field.getTile(row, col);
            const assetName = tile ? tile.getAssetName() : null;
            if (tile instanceof House) {
                return { type: 'house', row, col, occupied: tile.getResidents().length > 0, assetName };
            }
            if (tile instanceof Workplace) {
                return { type: 'work', row, col, occupied: tile.getBusiness() !== null, assetName };
            }
            if (tile instanceof Road) {
                return { type: 'road', row, col, assetName };
            }
            if (tile instanceof Soil) {
                return { type: 'soil', row, col, assetName };
            }
            return { type: 'none', row, col };
        },

        structureCounts(): StructureCounts {
            const field = game.field;
            const counts: StructureCounts = {
                roads: 0, houses: 0, workplaces: 0, occupiedHouses: 0, businesses: 0,
            };
            for (const structure of field ? field.getStructures() : []) {
                if (structure instanceof House) {
                    counts.houses += 1;
                    if (structure.getResidents().length > 0) {
                        counts.occupiedHouses += 1;
                    }
                } else if (structure instanceof Workplace) {
                    counts.workplaces += 1;
                    if (structure.getBusiness()) {
                        counts.businesses += 1;
                    }
                } else if (structure instanceof Road) {
                    counts.roads += 1;
                }
            }
            return counts;
        },

        buildings(): { houses: string[]; workplaces: string[] } {
            const houses: string[] = [];
            const workplaces: string[] = [];
            for (const structure of game.field ? game.field.getStructures() : []) {
                if (structure instanceof House) {
                    houses.push(structure.getIdentifier());
                } else if (structure instanceof Workplace) {
                    workplaces.push(structure.getIdentifier());
                }
            }
            return { houses, workplaces };
        },

        people(): PersonInfo[] {
            return (game.field ? game.field.getPeople() : []).map(describePerson);
        },

        personById(personId: string): PersonInfo | null {
            const match = (game.field ? game.field.getPeople() : []).find(
                person => person.social.getPersonId() === personId
            );
            return match ? describePerson(match) : null;
        },

        vehicles(): VehicleInfo[] {
            return (game.field ? game.field.getVehicles() : []).map((vehicle: Vehicle) => {
                const position = vehicle.getPosition();
                return { x: position?.x ?? 0, y: position?.y ?? 0 };
            });
        },

        cityStats(): CityStats | null {
            return game.city ? game.city.getCityStats() : null;
        },

        historyLength(personId: string): number {
            const log = game.eventEngine?.getPersonLog(personId);
            return log ? log.length : 0;
        },

        debug(): unknown {
            return game;
        },

        async stepGame(ticks: number, framesPerTick = 60, deltaMs = 32): Promise<void> {
            for (let t = 0; t < ticks; t++) {
                await game.advanceTicks(1);
                for (let i = 0; i < framesPerTick; i++) {
                    await game.emit('update', { time: i * deltaMs, timeDelta: deltaMs });
                }
            }
        },

        startTrace(): void {
            trace.active = false;
            trace.frames = 0;
            trace.ms = 0;
            trace.startTick = game.clock?.getCurrentTick() ?? 0;
            trace.people.clear();
            trace.anomalies = [];
            trace.overlapCooldown.clear();
            trace.lastAudit = null;
            trace.active = true;
        },

        stopTrace(): void {
            trace.active = false;
        },

        traceReport(): TraceReport {
            const anomaliesByKind: Record<string, number> = {};
            for (const anomaly of trace.anomalies) {
                anomaliesByKind[anomaly.kind] = (anomaliesByKind[anomaly.kind] ?? 0) + 1;
            }
            const topOffenders = Array.from(trace.people.entries())
                .filter(([, rec]) => rec.anomalies > 0)
                .sort((a, b) => b[1].anomalies - a[1].anomalies)
                .slice(0, 10)
                .map(([personId, rec]) => ({ personId, name: rec.name, anomalies: rec.anomalies }));
            return {
                tracing: trace.active,
                frames: trace.frames,
                simMs: Math.round(trace.ms),
                startTick: trace.startTick,
                endTick: game.clock?.getCurrentTick() ?? 0,
                peopleTracked: trace.people.size,
                totalAnomalies: trace.anomalies.length,
                anomaliesByKind,
                topOffenders,
            };
        },

        traceAnomalies(kind?: string, limit = 200): TraceAnomaly[] {
            const matches = kind ? trace.anomalies.filter(anomaly => anomaly.kind === kind) : trace.anomalies;
            return matches.slice(-limit);
        },

        traceEvents(personId: string, limit = 300): TraceStateEvent[] {
            return (trace.people.get(personId)?.events ?? []).slice(-limit);
        },

        traceCrumbs(personId: string, limit = 1000): TraceCrumb[] {
            return (trace.people.get(personId)?.crumbs ?? []).slice(-limit);
        },

        activityCensus(): ActivityCensusRow[] {
            return (game.field ? game.field.getPeople() : [])
                .filter(person => person.social.getPersonId() !== null)
                .map(person => {
                    const personId = person.social.getPersonId()!;
                    const position = person.getPosition();
                    const job = person.work.getJob();
                    const activity = describeActivity(personId);
                    return {
                        personId,
                        name: person.social.getFullName(),
                        x: position?.x ?? 0,
                        y: position?.y ?? 0,
                        indoors: person.isIndoors(),
                        travelStep: String(person.getTravelStep()),
                        ambulatory: person.isAmbulatory(),
                        action: activity.action,
                        actionStatus: activity.actionStatus,
                        actionLocation: activity.actionLocation,
                        currentBuilding: person.getCurrentBuilding()?.getIdentifier() ?? null,
                        destinationBuilding: person.getDestinationBuilding()?.getIdentifier() ?? null,
                        jobTitle: job ? job.title : null,
                    };
                });
        },

        auditSprites() {
            return computeSpriteAudit();
        },
    };
}
