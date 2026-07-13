import Phaser from 'phaser';

import City from './City';

import Clock from 'game/Clock';
import ActionEngine from 'game/actions/ActionEngine';
import Agenda from 'game/actions/Agenda';
import Brain from 'game/actions/Brain';
import { assertValidData } from 'game/data/schemas';
import Economy from 'game/economy/Economy';
import EventEngine from 'game/events/EventEngine';
import Habits from 'game/population/Habits';
import Mood from 'game/population/Mood';
import Needs from 'game/population/Needs';
import Population from 'game/population/Population';
import SocialGraph from 'game/population/SocialGraph';
import Traits from 'game/population/Traits';
import DebugTools from 'game/scene/DebugTools';
import MainScene from 'game/scene/MainScene';
import Field from 'game/world/Field';
import TitleScene from 'game/scene/TitleScene';
import { createTestApi } from 'game/TestHarness';


import Inventory from 'game/objects/Inventory';
import SchoolRegistry from 'game/skills/SchoolRegistry';
import SkillBook from 'game/skills/SkillBook';
import SocialLife from 'game/population/SocialLife';
import SaveManager from 'game/save/SaveManager';
import {
    HistoryHydrationRef,
    HistoryHydrationSource,
    loadCommittedAsset,
    loadSelectedWorldFromHttp,
    reopenHydrationSource,
} from 'game/history/HistoryAssetSource';
import { selectStartingWorld, SelectedWorld } from 'game/history/HistoryAssetSelection';
import { PersonId } from 'types/Genealogy';
import config from 'json/config.json';
import toolAssets from 'json/toolAssets.json';
import { Toolbelt } from 'types/Cursor';
import { EventListeners, Handler } from 'types/EventListener';
import { EventPayloads, UpdateEvent } from 'types/Events';
import { FieldParams, GridParams, ScreenParams } from 'types/Grid';
import { PixelPosition, TilePosition } from 'types/Position';
import { DEFAULT_SAVE_SLOT, HistoryHydrationSave } from 'types/Save';
import { MS_PER_TICK } from 'util/time';

export default class GameManager {
    private eventListeners: EventListeners = {};

    public scene: MainScene;
    public field: Field | null;
    public city: City | null;
    public population: Population | null;
    public clock: Clock | null;
    public eventEngine: EventEngine | null;
    public actionEngine: ActionEngine | null;
    public brain: Brain | null;
    public economy: Economy | null;
    public inventory: Inventory | null;
    public schools: SchoolRegistry | null;
    public skillBook: SkillBook | null;
    public socialGraph: SocialGraph | null;
    public needs: Needs | null;
    public agenda: Agenda | null;
    public traits: Traits | null;
    public mood: Mood | null;
    public habits: Habits | null;

    // Last emitted time markers, so time events fire only on actual change (not every frame).
    private lastDayEmitted: number;
    private lastTickEmitted: number;
    private lastMinuteEmitted: number;

    public gridParams: GridParams;
    public toolbelt: Toolbelt;

    public saveManager: SaveManager;
    private pendingLoad: string | null;
    private skipSplash: boolean;

    // Integration-test determinism seam (task 008). `testMode` is set ONLY when the page opts in (a `?test=1`
    // URL param or a `window.__TOWNBOX_TEST` global set before boot) — never in normal production. When on, the
    // RAF-driven clock is paused (`timePaused`) so in-game time advances only via advanceTicks(), and a read/
    // control API is installed on `window.__townbox` once the game is initialized.
    private testMode: boolean;
    private timePaused: boolean;

    // Lazy history hydration (task 012 follow-up): which asset generation/window this world was selected from,
    // who already has their pre-game history installed, and the live reader (rebuilt on demand after a load).
    private historyHydration: {
        ref: HistoryHydrationRef;
        hydrated: Set<PersonId>;
        source: HistoryHydrationSource | null;
        reopenAttempted: boolean;
    } | null;

    constructor() {
        // Fail loudly on invalid data files before anything consumes them (task 039). The registry validated
        // in CI too, so shipping builds never trip this — it exists to stop a dev session from running against
        // a manifest whose errors would otherwise be silently ignored (e.g. a typo'd event effect kind).
        assertValidData();

        // A structure (road/building/soil) occupies a square footprint of FOOTPRINT_TILES x FOOTPRINT_TILES tiles.
        // The world keeps the same number of footprints as the legacy tile grid (128x128), but each footprint is
        // now subdivided into finer tiles, giving placement granularity at the sub-footprint level.
        const FOOTPRINT_TILES = 3;

        const footprintParams: FieldParams = {
            rows: 128,
            cols: 128
        };

        const fieldParams: FieldParams = {
            rows: footprintParams.rows * FOOTPRINT_TILES,
            cols: footprintParams.cols * FOOTPRINT_TILES
        };

        const screenParams: ScreenParams = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        const gridWidth = 6144;
        const gridHeight = 6144;

        const cellWidth = gridWidth / fieldParams.cols;
        const cellHeight = gridHeight / fieldParams.rows;

        const gridParams: GridParams = {
            width: gridWidth,
            height: gridHeight,

            rows: fieldParams.rows,
            cols: fieldParams.cols,

            gridX: screenParams.width / 2,
            gridY: screenParams.height / 2,

            cells: {
                width: cellWidth,
                height: cellHeight,
            },

            footprint: {
                tiles: FOOTPRINT_TILES,
                width: cellWidth * FOOTPRINT_TILES,
                height: cellHeight * FOOTPRINT_TILES,
            },
        };

        this.gridParams = gridParams;
        this.toolbelt = toolAssets as Toolbelt;

        this.scene = new MainScene(this, { key: 'MainScene', active: false });
        this.field = null;
        this.city = null;
        this.population = null;
        this.clock = null;
        this.eventEngine = null;
        this.actionEngine = null;
        this.brain = null;
        this.economy = null;
        this.inventory = null;
        this.schools = null;
        this.skillBook = null;
        this.socialGraph = null;
        this.needs = null;
        this.agenda = null;
        this.traits = null;
        this.mood = null;
        this.habits = null;
        this.lastDayEmitted = -1;
        this.lastTickEmitted = -1;
        this.lastMinuteEmitted = -1;

        this.saveManager = new SaveManager(this);
        this.pendingLoad = null;
        this.skipSplash = false;

        // Detect opt-in test mode. Pause time up front so no ticks slip through before the harness installs.
        this.testMode = GameManager.detectTestMode();
        this.timePaused = this.testMode;
        this.historyHydration = null;

        // Debug auto-load: if a build ships with an embedded save, queue it and skip the splash screen.
        const autoLoad = config.debug.autoLoad;
        if (autoLoad && autoLoad.enabled && autoLoad.save) {
            this.pendingLoad = autoLoad.save;
            this.skipSplash = true;
        }

        // Test-only boot parametrization (task 008, §3), active ONLY in test mode. `?boot=new` skips the splash
        // straight into a fresh game (cold-start pool); `?boot=asset` does the same but through the REAL
        // history-asset path (lazy hydration and all); `?boot=load` skips it and queues a load from the default
        // save slot (which the test seeds into localStorage before boot). Lets a scenario fixture boot
        // deterministically without clicking the canvas splash buttons.
        if (this.testMode) {
            const boot = GameManager.testBootMode();
            if (boot === 'new' || boot === 'asset') {
                this.skipSplash = true;
            } else if (boot === 'load') {
                const payload = GameManager.readDefaultSaveSlot();
                if (payload) {
                    this.pendingLoad = payload;
                    this.skipSplash = true;
                }
            }
        }

        const titleScene = new TitleScene(this);

        const phaserConfig: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            scale: {
                mode: Phaser.Scale.RESIZE,
                autoCenter: Phaser.Scale.CENTER_BOTH,
            },
            render: {
                antialias: true,
                roundPixels: false,
            },
            backgroundColor: '#427328',
            scene: [titleScene, this.scene],
        };

        new Phaser.Game(phaserConfig);
        const debugTools = new DebugTools();

        const postSceneInit = async (_: Phaser.Scene) => {
            if (config.debug.masterSwitch) {
                this.on("tileSpawned", { callback: debugTools.drawTileDebugInfo, context: this }) // Huge performance hit, disabled by default
                this.on("roadBuilt", { callback: debugTools.drawRoadCurbs, context: this });
                this.on("roadBuilt", { callback: debugTools.drawRoadLanes, context: this });
            }

            // Clock first: it is the single source of in-game time, read by the genealogy (via SocialLife)
            // and the household draw. A load restores its elapsed time during deserialize.
            this.clock = new Clock();
            SocialLife.setClock(this.clock);

            this.field = new Field(this, fieldParams.rows, fieldParams.cols);
            this.city = new City(this);

            // Genealogy pool: a fresh game selects a slice of the offline history asset (task 055); a load
            // leaves it empty here and restores the saved pool into this instance during deserialize. The
            // asset install below (startNewGameWorld) needs the engines, so they are constructed first.
            this.population = new Population();

            // Engine B (life events): owns the compiled event graph + per-person history. Runs over
            // materialized people each day via City.handleNewDay; a load restores its history during deserialize.
            this.eventEngine = new EventEngine();

            // The Action engine (task 043) shares the event engine's LifeLog, so events and actions land in
            // ONE totally-ordered per-person log. A load restores its instances during deserialize.
            this.actionEngine = new ActionEngine(undefined, this.eventEngine.getLifeLog());

            // The Brain (task 046): the stateless per-person decision layer over the Action engine.
            this.brain = new Brain(this.actionEngine);

            // Economy: per-person/business money balances + the ledger. A load restores balances during
            // deserialize; balances are otherwise seeded at household/business placement.
            this.economy = new Economy();

            // Object instances & Possessions (task 041). A load restores instances during deserialize;
            // instances are otherwise created by consequences (044) and world seeding.
            this.inventory = new Inventory();

            // School assignments (task 058): the persistent student-side registry. A load restores
            // assignments during deserialize; enrollment otherwise happens via City's daily sweep.
            this.schools = new SchoolRegistry();

            // The skill store (tasks 059-062): proficiency records keyed by pool personId. A load restores
            // records during deserialize; people are otherwise seeded at materialization and progress
            // through school/work/education.
            this.skillBook = new SkillBook();

            // The elective social graph (task 083): friendship/rivalry/romance edges, serialized (save v15).
            // A load restores edges during deserialize; edges otherwise grow from real interactions.
            this.socialGraph = new SocialGraph();

            // The needs ledger (task 084): per-person motivational meters, serialized (save v16). Lazily
            // seeded per person on first read; a load restores levels during deserialize.
            this.needs = new Needs();

            // The agenda (task 085): persisted planned intents (routines, visits, joint plans).
            // A load restores entries during deserialize.
            this.agenda = new Agenda();

            // Traits (task 087): derived temperament, never stored — a provider reads the live pool.
            this.traits = new Traits(() => this.population?.getState() ?? { worldSeed: 0, people: {} });

            // Mood (task 091): valence-driven morale, serialized (v16 family). A load restores impulses.
            this.mood = new Mood();

            // Habits (task 095): vice counters with closed-form cooling, serialized (v16 family).
            this.habits = new Habits();

            // Asset-fed new game (task 055): on a fresh game, select a window of the committed history asset —
            // rebased to tick 0 with re-randomized identities — so drawn households arrive with real histories.
            // Skipped on load (the saved pool + history already carry it).
            if (this.pendingLoad === null) {
                await this.startNewGameWorld();
            }

            // Install the integration-test hook once the field/city/engines exist (task 008). Gated on test
            // mode, so `window.__townbox` never appears in a normal production session.
            if (this.testMode) {
                this.installTestHarness();
            }

            this.emit("gameInitialized", this);
        }
        this.on("sceneInitialized", { callback: postSceneInit, context: this });

        // The HUD signals readiness once its event listeners are registered; only then do we apply a queued load
        // (title-screen load or debug auto-load) so success/error toasts are never missed.
        this.on("hudReady", { callback: this.applyPendingLoad, context: this });
        this.on("saveGameRequest", { callback: this.handleSaveRequest, context: this });
        this.on("update", { callback: this.advanceTime, context: this });
    }

    // Sets up a fresh game's world (task 055/077 Part B). Picks a random per-game seed and SELECTS a window
    // from a committed history asset (rebased to tick 0, identities re-randomized), installing the sliced pool
    // + histories/skills/possessions. Source order: the newest SHARDED asset served over HTTP (the generator's
    // default output, fetched chunk-wise), then a small inline single-file asset, then a cold-start plain pool
    // if neither is present (§3.7). Async because the sharded path fetches only the shards the window needs.
    private async startNewGameWorld(): Promise<void> {
        const population = this.population;
        if (!population) {
            return;
        }
        // `?seed=N` pins the world seed (and therefore the asset window) — test mode only.
        const worldSeed = (this.testMode ? GameManager.testSeed() : null) ?? ((Math.random() * 0x100000000) >>> 0);

        // Test mode (task 008): `?boot=new` gets a fast cold-start pool (no asset fetch, deterministic per
        // `?seed=N`); `?boot=asset` exercises the REAL person-keyed asset path below, so the integration suite
        // can cover boot + lazy hydration end to end.
        if (this.testMode && GameManager.testBootMode() !== 'asset') {
            population.generate(worldSeed);
            return;
        }

        // 1) The person-keyed asset served over HTTP (task 012 follow-up): boot fetches ONLY the small
        //    population/objects sections; each drawn person's history hydrates on demand (hydratePeople).
        const loaded = await loadSelectedWorldFromHttp(worldSeed);
        if (loaded) {
            this.installSelectedWorld(loaded.selected);
            this.historyHydration = {
                ref: loaded.hydration.ref,
                hydrated: new Set(),
                source: loaded.hydration,
                reopenAttempted: true,
            };
            return;
        }

        // 2) Fallback: a committed single-file asset (small assets / fixtures) — eager, no hydration needed.
        const asset = loadCommittedAsset();
        const selected = asset ? selectStartingWorld(asset, worldSeed) : null;
        if (selected) {
            this.installSelectedWorld(selected);
            return;
        }

        // 3) No committed asset — cold-start a plain generated pool (the pre-036 behaviour).
        console.info("[GameManager] No committed history asset; starting from a cold-start pool.");
        population.generate(worldSeed);
    }

    // Lazy per-person history hydration (task 012 follow-up): installs the given people's pre-game skills,
    // aggregate event history, and log entries from the history asset. Called by City.setupHousehold BEFORE
    // materialization so SkillBook.initialize() sees their lived skills as `initialized`. Idempotent per
    // person; people the asset doesn't know (newborns, immigrants, cold-start worlds) are skipped silently.
    async hydratePeople(personIds: PersonId[]): Promise<void> {
        const hydration = this.historyHydration;
        if (!hydration) {
            return;
        }
        const pending = personIds.filter(id => !hydration.hydrated.has(id));
        if (pending.length === 0) {
            return;
        }

        // After a load the live reader is gone; rebuild it once from the save's pinned ref. A missing or
        // regenerated (createdAt-mismatched) asset disables hydration for the session — graceful degradation.
        if (!hydration.source && !hydration.reopenAttempted) {
            hydration.reopenAttempted = true;
            hydration.source = await reopenHydrationSource(hydration.ref);
            if (!hydration.source) {
                console.info('[GameManager] History asset unavailable for this save; pre-game histories disabled.');
            }
        }
        const source = hydration.source;
        if (!source) {
            return;
        }

        // Mark everyone up front (including ids the asset doesn't know) so no person is ever fetched twice.
        for (const id of pending) {
            hydration.hydrated.add(id);
        }
        const present = pending.filter(id => source.has(id));
        if (present.length === 0) {
            return;
        }
        const bundles = await source.fetchPeople(present);
        for (const bundle of bundles) {
            if (bundle.skills) {
                this.skillBook?.installPerson(bundle.personId, bundle.skills);
            }
            this.eventEngine?.installPersonHistory(bundle.personId, bundle.history);
            this.eventEngine?.installPersonLog(bundle.personId, bundle.log);
        }
    }

    // Save/load surface for the hydration state (SaveManager, v14).
    getHistoryHydrationState(): HistoryHydrationSave | undefined {
        if (!this.historyHydration) {
            return undefined;
        }
        return { ...this.historyHydration.ref, hydratedIds: [...this.historyHydration.hydrated] };
    }

    setHistoryHydrationState(state: HistoryHydrationSave | undefined): void {
        this.historyHydration = state
            ? {
                ref: { dir: state.dir, window: state.window, createdAt: state.createdAt },
                hydrated: new Set(state.hydratedIds),
                source: null,
                reopenAttempted: false,
            }
            : null;
    }

    // Installs a selected asset window into the live systems. Installing the SkillBook (with its `initialized`
    // set) makes City.setupHousehold's initialize() a no-op for these people, so their real proficiency
    // survives materialization instead of being re-synthesized (task 077).
    private installSelectedWorld(selected: SelectedWorld): void {
        this.population?.loadState(selected.population);
        this.eventEngine?.loadHistory(selected.eventHistory);
        this.eventEngine?.loadLog(selected.eventLog, selected.eventLogSeq);
        if (selected.skillBook) {
            this.skillBook?.loadState(selected.skillBook);
        }
        if (selected.objects) {
            this.inventory?.loadState(selected.objects);
        }
    }

    // Advances the clock from the frame delta and emits time signals only when they actually change:
    // `timeChanged` once per in-game minute (the HUD's display granularity), `newTick` once per in-game hour
    // (the canonical simulation tick, task 040), and `newDay` on each day rollover.
    private advanceTime(payload: UpdateEvent): void {
        if (!this.clock || this.timePaused) {
            return;
        }
        this.clock.advance(payload.timeDelta);

        const timestamp = this.clock.getTimestamp();
        const tick = this.clock.getCurrentTick();
        const minuteOfDay = timestamp.hour * 60 + timestamp.minute;

        if (timestamp.absoluteDay !== this.lastDayEmitted) {
            this.lastDayEmitted = timestamp.absoluteDay;
            this.emit("newDay", { timestamp, tick });
        }
        if (tick !== this.lastTickEmitted) {
            this.lastTickEmitted = tick;
            this.emit("newTick", { timestamp, tick });
        }
        if (minuteOfDay !== this.lastMinuteEmitted) {
            this.lastMinuteEmitted = minuteOfDay;
            this.emit("timeChanged", { timestamp, tick });
        }
    }

    // After a load jumps the clock, reset the change markers so we don't spuriously emit a rollover.
    private resyncTimeTracking(): void {
        if (!this.clock) {
            return;
        }
        const timestamp = this.clock.getTimestamp();
        this.lastDayEmitted = timestamp.absoluteDay;
        this.lastTickEmitted = this.clock.getCurrentTick();
        this.lastMinuteEmitted = timestamp.hour * 60 + timestamp.minute;
    }

    // --- Integration-test determinism seam (task 008) ---------------------

    // Opt-in only: a `?test=1` (or `?test`) URL query param, or a `window.__TOWNBOX_TEST === true` global set
    // before the app boots (Playwright's addInitScript). Never true in a normal production session. Wrapped in a
    // try/catch so a non-browser context (unit tests constructing GameManager) can't throw on window access.
    private static detectTestMode(): boolean {
        try {
            if (typeof window === 'undefined') {
                return false;
            }
            const global = window as unknown as { __TOWNBOX_TEST?: boolean };
            if (global.__TOWNBOX_TEST === true) {
                return true;
            }
            const params = new URLSearchParams(window.location.search);
            return params.has('test');
        } catch {
            return false;
        }
    }

    // Reads an optional `seed` URL param in test mode (a finite, non-negative integer), else null.
    private static testSeed(): number | null {
        try {
            if (typeof window === 'undefined') {
                return null;
            }
            const raw = new URLSearchParams(window.location.search).get('seed');
            if (raw === null) {
                return null;
            }
            const value = Number(raw);
            return Number.isFinite(value) && value >= 0 ? (value >>> 0) : null;
        } catch {
            return null;
        }
    }

    // Reads the `boot` URL param in test mode: 'new' | 'asset' | 'load' | null. Guarded like detectTestMode.
    private static testBootMode(): 'new' | 'asset' | 'load' | null {
        try {
            if (typeof window === 'undefined') {
                return null;
            }
            const value = new URLSearchParams(window.location.search).get('boot');
            return value === 'new' || value === 'asset' || value === 'load' ? value : null;
        } catch {
            return null;
        }
    }

    // Reads the default-slot save payload straight from localStorage (the LocalStorageProvider key format), for
    // the `?boot=load` path. Kept in sync with game/save/LocalStorageProvider.ts's `townbox:save:<slot>` key.
    private static readDefaultSaveSlot(): string | null {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return null;
            }
            return window.localStorage.getItem(`townbox:save:${DEFAULT_SAVE_SLOT}`);
        } catch {
            return null;
        }
    }

    private installTestHarness(): void {
        try {
            (window as unknown as { __townbox?: unknown }).__townbox = createTestApi(this);
            console.info('[GameManager] Test harness installed on window.__townbox (test mode).');
        } catch (error) {
            console.error('[GameManager] Failed to install test harness:', error);
        }
    }

    // Pauses/resumes the RAF-driven clock so a test controls time exclusively (see advanceTicks).
    pauseTime(): void {
        this.timePaused = true;
    }

    resumeTime(): void {
        this.timePaused = false;
        this.resyncTimeTracking();
    }

    // Advances the simulation by exactly `n` in-game hour ticks, one at a time, emitting the SAME
    // newDay/newTick/timeChanged signals the frame loop does — but AWAITED, so the returned promise resolves
    // only after every tick's async handlers (City.handleTick, the event/economy cadence) have fully run. This
    // is what makes the real-time sim deterministically assertable from a test (task 008). It updates the same
    // last-emitted markers advanceTime uses, so a subsequent resume() never double-fires the boundary.
    async advanceTicks(n: number = 1): Promise<void> {
        if (!this.clock) {
            return;
        }
        for (let i = 0; i < n; i++) {
            this.clock.advance(MS_PER_TICK);
            const timestamp = this.clock.getTimestamp();
            const tick = this.clock.getCurrentTick();
            const minuteOfDay = timestamp.hour * 60 + timestamp.minute;

            if (timestamp.absoluteDay !== this.lastDayEmitted) {
                this.lastDayEmitted = timestamp.absoluteDay;
                await this.emit("newDay", { timestamp, tick });
            }
            if (tick !== this.lastTickEmitted) {
                this.lastTickEmitted = tick;
                await this.emit("newTick", { timestamp, tick });
            }
            if (minuteOfDay !== this.lastMinuteEmitted) {
                this.lastMinuteEmitted = minuteOfDay;
                await this.emit("timeChanged", { timestamp, tick });
            }
        }
    }

    private async handleSaveRequest(): Promise<void> {
        try {
            await this.saveManager.save(DEFAULT_SAVE_SLOT);
            this.emit("gameSaved");
        } catch (error) {
            console.error("[GameManager] Save failed:", error);
            this.emit("saveFailed", error instanceof Error ? error.message : "Unknown error");
        }
    }

    private applyPendingLoad(): void {
        if (this.pendingLoad === null) {
            return;
        }
        const data = this.pendingLoad;
        this.pendingLoad = null;

        try {
            this.saveManager.deserialize(data);
            this.resyncTimeTracking();
            this.emit("gameLoaded");
            if (this.clock) {
                const timestamp = this.clock.getTimestamp();
                // The TimeChangedEvent contract carries the current HOUR tick (task 040), not the day index.
                this.emit("timeChanged", { timestamp, tick: this.clock.getCurrentTick() });
            }
        } catch (error) {
            console.error("[GameManager] Load failed:", error);
            this.emit("loadFailed", error instanceof Error ? error.message : "Unknown error");
        }
    }

    // Queues a save (from a storage slot) to be applied once the game scene and HUD are ready. Returns false when
    // no save exists in that slot. Used by the title screen's "Load Game" option.
    async prepareLoad(slot: string = DEFAULT_SAVE_SLOT): Promise<boolean> {
        const data = await this.saveManager.getProvider().load(slot);
        if (!data) {
            return false;
        }
        this.pendingLoad = data;
        return true;
    }

    shouldSkipSplash(): boolean {
        return this.skipSplash;
    }

    tileToPixelPosition(tilePosition: TilePosition): PixelPosition {
        if (tilePosition === null) {
            return null;
        }

        const { row, col } = tilePosition;

        if (row >= 0 && row < this.gridParams.rows) {
            const yEdge = this.gridParams.bounds!.top + (row * this.gridParams.cells.height);
            const yCenter = yEdge + (this.gridParams.cells.height / 2);

            const xEdge = this.gridParams.bounds!.left + (col * this.gridParams.cells.width);
            const xCenter = xEdge + (this.gridParams.cells.width / 2);

            return { x: xCenter, y: yCenter };
        }
        return null;
    }

    pixelToTilePosition(pixelPosition: PixelPosition): TilePosition {
        if (pixelPosition === null) {
            return null;
        }

        const { x: pixelX, y: pixelY } = pixelPosition;
        const { bounds } = this.gridParams;

        if (bounds && pixelY > bounds.top && pixelY < bounds.bottom && pixelX > bounds.left && pixelX < bounds.right) {
            const distance = { top: pixelY - bounds.top, left: pixelX - bounds.left };
            return {
                row: Math.floor(distance.top / this.gridParams.cells.height),
                col: Math.floor(distance.left / this.gridParams.cells.width),
            };
        }
        return null;
    }

    on<K extends keyof EventPayloads>(eventName: K, handler: Handler<EventPayloads[K]>): void {
        if (!this.eventListeners[eventName]) {
            this.eventListeners[eventName] = [];
        }
        this.eventListeners[eventName]?.push(handler);
    }

    off<K extends keyof EventPayloads>(eventName: K): void {
        delete this.eventListeners[eventName];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic bus: handler return types are heterogeneous and unknown to the emitter
    async emit<K extends keyof EventPayloads>(eventName: K, payload?: EventPayloads[K]): Promise<any[]> {
        if (!payload) {
            payload = {} as EventPayloads[K];
        }

        const handlers = this.eventListeners[eventName] || [];
        const results = await Promise.all(handlers.map(async (handler) => {
            const { callback, context } = handler;
            return context ? callback.call(context, payload) : callback(payload);
        }));

        return results;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic bus: the single handler's return type is unknown to the emitter; callers narrow it
    async emitSingle<K extends keyof EventPayloads>(eventName: K, payload?: EventPayloads[K]): Promise<any> {
        if (!payload) {
            payload = {} as EventPayloads[K];
        }

        const handlers = this.eventListeners[eventName] || [];
        if (handlers.length > 1) {
            throw new Error(`Multiple handlers registered for event: ${eventName}`);
        }

        if (handlers.length === 0) {
            throw new Error(`No handlers registered for event: ${eventName}`);
        }

        const handler = handlers[0];
        if (!handler) {
            throw new Error(`Invalid handler for event: ${eventName}`);
        }

        const { callback, context } = handler;
        const result = await context ? callback.call(context, payload) : callback(payload);

        return result;
    }
}