import Phaser from 'phaser';

import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import Building from 'game/world/Building';
import House from 'game/world/House';
import Soil from 'game/world/Soil';
import Tile from 'game/world/Tile';
import Workplace from 'game/world/Workplace';
import assetManifest from 'json/assets.json';
import config from 'json/config.json';
import inputConfig from 'json/input.json';
import { AssetManifest } from 'types/Assets';
import { Cursor, Tool } from 'types/Cursor';
import { FireStateChange } from 'types/Events';
import constructionConfig from 'json/construction.json';
import { Image, SceneConfig } from 'types/Phaser';
import { PixelPosition, TilePosition } from 'types/Position';
import { hashStringToSeed } from 'util/random';
import { directionToRadianRotation } from 'util/tools';

type Pointer = Phaser.Input.Pointer;
type CameraControl = Phaser.Cameras.Controls.SmoothedKeyControl | null;
type Grid = Phaser.GameObjects.Grid | null;

let Game: GameManager;

export default class MainScene extends Phaser.Scene {
    private cameraController: CameraControl;
    private grid: Grid;

    private cursor: Cursor;
    private cursorActive: boolean;

    constructor(gameManager: GameManager, sceneConfig: SceneConfig) {
        super(sceneConfig);

        Game = gameManager;
        this.cameraController = null;
        this.grid = null;

        this.cursor = null;
        this.cursorActive = true;

        Game.on("tileSpawned", { callback: this.drawTile, context: this });
        Game.on("personSpawned", { callback: this.drawPerson, context: this });
        // Activity bubbles (task 093 / J2): refresh label text/visibility once per in-game minute.
        Game.on("timeChanged", { callback: this.refreshActivityLabels, context: this });
        Game.on("timeChanged", { callback: this.refreshTrashPiles, context: this });
        Game.on("timeChanged", { callback: this.refreshFormations, context: this });
        Game.on("vehicleSpawned", { callback: this.drawVehicle, context: this });
        // Fire particles (task 116): flames anchor on a burning building, doused on resolution.
        Game.on("fireStateChanged", { callback: this.handleFireStateChanged, context: this });
        Game.on("gameLoaded", { callback: this.clearFireEmitters, context: this });
        // Particles follow the time scale (W10): flames speed up, slow down, and freeze with the world.
        Game.on("timeScaleChanged", { callback: this.syncEmitterTimeScales, context: this });

        Game.on("windowDragStart", { callback: () => {
            this.cursorActive = false;
        }, context: this });

        Game.on("windowDragStop", { callback: () => {
            this.cursorActive = true;
        }, context: this });
    }

    init(): void { }

    preload(): void {
        const assets: AssetManifest = assetManifest;

        this.load.setBaseURL(assets.baseURL);
        assets.assets.forEach(asset => {
            if (asset.type === "image") {
                this.load.image(asset.key, `${asset.key}.png`);
            }
        });
    }

    create(): void {
        this.drawGrid(this);

        if (!this.input || !this.input.mouse || !this.input.keyboard) {
            return;
        }

        this.input.mouse.disableContextMenu();
        this.setCursor(Tool.Road);

        // Civic placeholder textures (task 108): flat colored 48x48 squares generated at boot — the
        // construction menu's civic tiles. Saves persist assetName, so these keys must exist before any
        // load redraws.
        for (const entry of (constructionConfig as { entries: { id: string; color?: string }[] }).entries) {
            if (!entry.color || this.textures.exists('civic_' + entry.id)) {
                continue;
            }
            const graphics = this.add.graphics();
            graphics.fillStyle(Number.parseInt(entry.color.slice(1), 16), 1);
            graphics.fillRect(0, 0, 48, 48);
            graphics.generateTexture('civic_' + entry.id, 48, 48);
            graphics.destroy();
        }

        // Construction-menu picks (task 108): arm the placement cursor with the chosen building. The pick
        // rides every tileClicked until another tool is selected.
        Game.on("constructionSelected", {
            callback: (pick: import('types/Events').ConstructionPick) => {
                this.constructionPick = { ...(pick.blueprintKey !== undefined ? { blueprintKey: pick.blueprintKey } : {}), ...(pick.asset !== undefined ? { asset: pick.asset } : {}) };
                this.setCursor(pick.tool, pick.asset);
            },
            context: this,
        });

        // Tool selection flows through the `toolSelected` bus event so the keyboard and the React toolbar
        // stay in sync (task 030): both the keys below and the toolbar emit it; the scene consumes it here.
        Game.on("toolSelected", {
            callback: (tool: Tool) => {
                this.constructionPick = null; // a plain tool change disarms any construction pick (task 108)
                if (tool === Tool.Construction) {
                    this.hideCursor(); // the menu window (Hud) takes over; the pick arms the real cursor
                    return;
                }
                this.setCursor(tool);
            },
            context: this,
        });

        inputConfig.inputMappings.forEach(mapping => {
            this.input.keyboard?.addKey(mapping.key).on('down', () => {
                Game.emit("toolSelected", mapping.tool as Tool);
            });
        });

        this.input.keyboard.addKey('Esc').on('down', () => {
            Game.emit("toolSelected", Tool.Select);
        });

        // Debug-only spawn keys (P: person, V: vehicle). Off by default so the only people/cars in normal play
        // are placed by the simulation (households, newborns, commuters). See task 016.
        if (config.debug.spawnKeys) {
            this.input.keyboard.addKey('P').on('down', async () => {
                const pointer = {
                    x: this.input.activePointer.worldX,
                    y: this.input.activePointer.worldY
                };
                const person = await Game.emitSingle("personSpawnRequest", pointer);
                person?.enableWander();
            });

            this.input.keyboard.addKey('V').on('down', () => {
                const pointer = {
                    x: this.input.activePointer.worldX,
                    y: this.input.activePointer.worldY
                };
                Game.emit("vehicleSpawnRequest", pointer);
            });
        }

        this.input.keyboard.addKey('G').on('down', () => {
            this.toggleGrid();
        });

        // The observation scaffolding (task 117, masterSwitch-gated like the other debug overlays):
        // T cycles the time throttle (1×/4×/16× — a frame-delta multiplier on the clock), and a fixed
        // overlay line tracks the town's vitals (people / employed / open incidents / worst service).
        if (config.debug.masterSwitch) {
            this.debugOverlay = this.add.text(8, 8, '', {
                fontSize: '11px', color: '#aef2ae', backgroundColor: 'rgba(0, 0, 0, 0.6)',
                padding: { x: 5, y: 3 },
            }).setScrollFactor(0).setDepth(1_000_000);
            this.input.keyboard.addKey('T').on('down', () => {
                Game.cycleTimeScale();
                this.refreshDebugOverlay();
            });
            Game.on("timeChanged", { callback: this.refreshDebugOverlay, context: this });
        }

        this.input.on('pointermove', (pointer: Pointer) => {
            // Drag-paint for build/bulldoze tools; the Select (inspector) tool only acts on a discrete click.
            if (pointer.isDown && this.getCursor()?.tool !== Tool.Select) {
                this.handleClick(pointer);
            }
        });

        this.input.on('pointerdown', (pointer: Pointer) => {
            this.handleClick(pointer);
        });

        // Camera
        this.cameras.main.zoom = 1.75;
        const cameraControlParams = {
            camera: this.cameras.main,
            left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            zoomIn: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
            zoomOut: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            maxZoom: 1.75,
            minZoom: 0.3,
            zoomSpeed: 0.04, // originally was 0.02
            acceleration: 0.75, // originally was 0.06
            drag: 0.002, // originally was 0.0005
            maxSpeed: 0.45 // originally was 1.0
        };
        this.cameraController = new Phaser.Cameras.Controls.SmoothedKeyControl(cameraControlParams);

        Game.emit("sceneInitialized", this);
        console.info('Scene intialized.');
    }

    update(time: number, timeDelta: number): void {
        Game.emit("update", { time, timeDelta });
        this.cameraController?.update(timeDelta);
        this.handleHover();
    }

    private handleHover(): void {
        const cursor = this.getCursor();
        if (!cursor?.asset) {
            return;
        }

        if (!this.cursorActive) {
            this.hideCursor();
            return;
        }

        const mouseX = this.input.activePointer.worldX;
        const mouseY = this.input.activePointer.worldY;
        const mousePixelPosition: PixelPosition = { x: mouseX, y: mouseY };

        const tilePosition = Game.pixelToTilePosition(mousePixelPosition);
        if (tilePosition === null) {
            this.hideCursor();
            return;
        }

        // Resolve the actual placement (road grid snap / building road-side soft-snap) so the preview always
        // shows where the structure will land, tinting red when the placement is invalid.
        const placement = Game.field
            ? Game.field.resolvePlacement(cursor.tool, tilePosition)
            : { position: tilePosition, valid: true };

        if (placement.position === null) {
            this.hideCursor();
            return;
        }

        const tileCenter = Game.tileToPixelPosition(placement.position);
        if (tileCenter === null) {
            this.hideCursor();
            return;
        }

        const imageX = tileCenter.x;
        const imageY = tileCenter.y + (Game.gridParams.footprint.height / 2);
        cursor.asset.setPosition(imageX, imageY);

        if (placement.valid) {
            cursor.asset.clearTint();
        } else {
            cursor.asset.setTint(0xff0000);
        }

        this.unhideCursor();
    }

    private handleClick(pointer: Pointer): void {
        if (!this.cursorActive) {
            this.hideCursor();
            return;
        }

        const pixelPosition: PixelPosition = { x: pointer.worldX, y: pointer.worldY };

        const cursor = this.getCursor();
        if (cursor === null) {
            return;
        }

        // The Select tool is the universal inspector: hit-test people first, then the structure (Field.selectAt
        // needs the pixel position, which the tile-based tileClicked flow would discard).
        if (cursor.tool === Tool.Select) {
            Game.field?.selectAt(pixelPosition);
            return;
        }

        const tilePosition = Game.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            return;
        }

        // Place at the same resolved position the preview shows, and ignore the click when the placement is
        // invalid (e.g. a building too far from a road side or on top of another structure).
        const placement = Game.field
            ? Game.field.resolvePlacement(cursor.tool, tilePosition)
            : { position: tilePosition, valid: true };

        if (!placement.valid || placement.position === null) {
            return;
        }

        Game.emit("tileClicked", {
            position: placement.position,
            tool: cursor.tool,
            ...(this.constructionPick ?? {}),
        });

        // One click, one building (W9 / proposal simulation-aliveness-3): a successful BUILDING placement
        // returns the cursor to Select (the bus emit keeps the toolbar highlight and any construction pick
        // in sync). Roads and the bulldozer keep the continuous drag-paint behavior.
        if (cursor.tool === Tool.House || cursor.tool === Tool.Work) {
            Game.emit("toolSelected", Tool.Select);
        }
    }

    // The construction menu's armed pick (task 108): a pinned blueprint and/or placeholder asset that
    // rides tileClicked. Null when a plain tool is active.
    private constructionPick: { blueprintKey?: string; asset?: string } | null = null;

    getCursor(): Cursor {
        return this.cursor;
    }

    // Centers the camera on a world point so that point maps to the viewport center — used by the integration
    // test harness (task 008) to place a target tile under a deterministic screen coordinate for real clicks.
    centerCameraOn(worldX: number, worldY: number): void {
        this.cameras.main.centerOn(worldX, worldY);
    }

    setCursor(tool: Tool, assetOverride?: string): void {
        if (!this.cursor) {
            this.cursor = {
                tool,
                asset: null
            };
        }

        if (this.cursor && this.cursor.asset !== null) {
            this.cursor.asset.destroy();
            this.cursor.asset = null;
        }
        
        this.cursor.tool = tool;
        const assetName = assetOverride ?? Game.toolbelt[this.cursor.tool as Tool];
        if (!assetName) {
            return;
        }

        const asset: Image = this.add.image(0, 0, assetName);
        asset.setAlpha(0.5);
        asset.setOrigin(0.5, 1);
        asset.setDepth((Game.gridParams.rows * 10) + 1);

        this.cursor.asset = asset;
    }

    private unhideCursor(): void {
        if (!this.cursor) {
            return;
        }

        const entity = this.cursor.asset;
        if (entity !== null && !entity.visible) {
            entity.setVisible(true);
        }
    }

    private hideCursor(): void {
        if (!this.cursor) {
            return;
        }

        const entity = this.cursor.asset;
        if (entity !== null && entity.visible) {
            entity.setVisible(false);
        }
    }

    private toggleGrid(): void {
        if (!this.grid) {
            return;
        }

        this.grid.setVisible(!this.grid.visible);
    }

    private drawGrid(scene: MainScene): void {
        const gridParams = Game.gridParams;
        const lineColor = 0x000000;
        const lineAlpha = 0.1;

        const grid = scene.add.grid(
            gridParams.gridX,
            gridParams.gridY,
            gridParams.width,
            gridParams.height,
            gridParams.cells.width,
            gridParams.cells.height,
            undefined,
            undefined,
            lineColor,
            lineAlpha
        );
        grid.setDepth((Game.gridParams.rows * 10) + 100);

        Game.gridParams.bounds = grid.getBounds();
        this.grid = grid;
    }

    private drawTile(tile: Tile): void {
        const gridParams = Game.gridParams;

        const tilePosition: TilePosition = tile.getPosition();
        if (tilePosition === null) {
            return;
        }

        const pixelPosition = Game.tileToPixelPosition(tilePosition);
        if (pixelPosition === null) {
            return;
        }

        const assetName = tile.getAssetName();
        if (assetName === null) {
            return;
        }

        let image: Image;

        if (tile instanceof Soil) {
            image = this.add.image(pixelPosition.x, pixelPosition.y, assetName);
            image.setOrigin(0.5, 0.5);

            const angles: number[] = [0, 90, 180, 270];
            const rotation = angles[Math.floor(Math.random() * angles.length)]! * (Math.PI / 180);

            image.setRotation(rotation);
        } else {
            // We need to set the Y coordinate as a bottom value for buildings, otherwise tall buildings will be (incorrectly) centralized on the footprint
            const imageX = pixelPosition.x;
            const imageY = pixelPosition.y + (gridParams.footprint.height / 2);
            image = this.add.image(imageX, imageY, assetName);
            image.setOrigin(0.5, 1);
        }
        image.setDepth(tile.calculateDepth());

        // Vacant buildings (an empty house, or a workplace with no business) read as greatly desaturated so the
        // player can spot them at a glance (task: vacancy visual). drawTile re-runs on tileSpawned, so a building
        // that empties later (e.g. a household dies out) is re-evaluated when its tile is re-emitted.
        const isVacantHouse = tile instanceof House && tile.getResidents().length === 0;
        const isVacantWorkplace = tile instanceof Workplace && tile.getBusiness() === null;
        if (isVacantHouse || isVacantWorkplace) {
            this.applyVacantLook(image);
        }

        const existingTileAsset = tile.getAsset();
        if (existingTileAsset) {
            existingTileAsset.destroy();
        }

        tile.setAsset(image);
    }

    // Renders a sprite as "vacant": fully desaturated via a ColorMatrix FX, falling back to a flat gray tint
    // when FX isn't available (e.g. the Canvas renderer). preFX isn't in the bundled Phaser typings, so it is
    // accessed structurally.
    private applyVacantLook(image: Phaser.GameObjects.Image): void {
        type ColorMatrixFx = { grayscale: (value?: number) => unknown };
        const preFX = (image as unknown as { preFX?: { addColorMatrix: () => ColorMatrixFx } | null }).preFX;
        if (preFX) {
            preFX.addColorMatrix().grayscale(1);
        } else {
            image.setTint(0x808080);
        }
    }

    // The observation overlay (task 117): one fixed line of town vitals, refreshed per in-game minute.
    private debugOverlay: Phaser.GameObjects.Text | null = null;

    private refreshDebugOverlay(): void {
        if (!this.debugOverlay) {
            return;
        }
        const people = Game.field?.getPeople() ?? [];
        const employed = people.filter(person => person.work.getJob() !== null).length;
        const openIncidents = Game.incidents?.open().length ?? 0;
        const services = Game.city?.getCityStats().services ?? [];
        const worst = [...services].sort((a, b) => a.ratio - b.ratio || a.service.localeCompare(b.service))[0];
        this.debugOverlay.setText(
            `×${Game.getTimeScale()} | people ${people.length} (${employed} employed) | open incidents ${openIncidents}`
            + (worst ? ` | worst service: ${worst.label} ${(worst.ratio * 100).toFixed(0)}%` : ''),
        );
    }

    // Fire particles (task 116): a small emitter of orange/red flecks + gray smoke anchored on any building
    // with an open fire incident — created on City's ignition event, destroyed on resolution. The texture is
    // a generated 3×3 white square, tinted per particle; nothing fancy, the fire just reads as fire.
    private fireEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

    private handleFireStateChanged(change: FireStateChange): void {
        const existing = this.fireEmitters.get(change.buildingKey);
        if (!change.burning) {
            existing?.destroy();
            this.fireEmitters.delete(change.buildingKey);
            return;
        }
        if (existing) {
            return;
        }
        const structure = Game.field?.getStructures()
            .find((candidate): candidate is Building => candidate instanceof Building && candidate.getIdentifier() === change.buildingKey);
        const tile = structure?.getPosition() ?? null;
        const pixel = tile ? Game.tileToPixelPosition(tile) : null;
        if (!structure || !pixel) {
            return;
        }
        if (!this.textures.exists('fire_spark')) {
            const graphics = this.make.graphics({ x: 0, y: 0 }, false);
            graphics.fillStyle(0xffffff, 1);
            graphics.fillRect(0, 0, 3, 3);
            graphics.generateTexture('fire_spark', 3, 3);
            graphics.destroy();
        }
        const flames = this.add.particles(pixel.x, pixel.y, 'fire_spark', {
            speed: { min: 8, max: 35 },
            angle: { min: 250, max: 290 }, // upward cone
            lifespan: { min: 350, max: 900 },
            frequency: 55,
            quantity: 2,
            scale: { start: 1.8, end: 0 },
            tint: [0xff5a00, 0xff2d00, 0xffa200, 0x777777], // flames + a drift of smoke
            gravityY: -25,
        });
        flames.setDepth(structure.calculateDepth() + 5);
        // Particles ride the sim clock (W10): flames burn faster at 4×/8× and freeze on pause, like
        // everything else — the one-authority contract extended to Phaser's own emitter clock.
        flames.timeScale = Math.max(Game.getTimeScale(), 0.0001); // 0 stalls Phaser oddly; near-zero freezes
        this.fireEmitters.set(change.buildingKey, flames);
    }

    private syncEmitterTimeScales(scale: number): void {
        for (const emitter of this.fireEmitters.values()) {
            emitter.timeScale = Math.max(scale, 0.0001);
        }
    }

    // A load rebuilds the world wholesale — stale emitters would float over the wrong lots.
    private clearFireEmitters(): void {
        for (const emitter of this.fireEmitters.values()) {
            emitter.destroy();
        }
        this.fireEmitters.clear();
    }

    // Activity bubbles (task 093 / J2): a small label over each visible OUTDOOR person naming their
    // current activity — the street narrates itself. Text refreshes per in-game minute; position follows
    // the sprite each frame via the person's redraw closure. (Task 115 fixed a latent 093 gap: the labels
    // were never CREATED — the map stayed empty forever — so the street never actually narrated. They are
    // now created lazily on the first refresh that sees the person.)
    private activityLabels = new Map<Person, Phaser.GameObjects.Text>();
    // Pets on the street (task 115): a tiny brown rectangle trailing the owner while walking_the_dog runs
    // — no pathfinding of its own, it shadows the owner's sprite with a small offset.
    private petDots = new Map<Person, Phaser.GameObjects.Rectangle>();

    private refreshActivityLabels(): void {
        const field = Game.field;
        const engine = Game.actionEngine;
        if (!field || !engine) {
            return;
        }
        const roster = new Set(field.getPeople());
        for (const [person, text] of this.activityLabels) {
            if (!roster.has(person)) {
                text.destroy();
                this.activityLabels.delete(person);
            }
        }
        for (const [person, dot] of this.petDots) {
            if (!roster.has(person)) {
                dot.destroy();
                this.petDots.delete(person);
            }
        }
        for (const person of roster) {
            const personId = person.social.getPersonId();
            if (!personId) {
                continue;
            }
            let text = this.activityLabels.get(person);
            if (!text) {
                text = this.add.text(0, 0, '', {
                    fontSize: '9px', color: '#ffffff', backgroundColor: 'rgba(0, 0, 0, 0.55)',
                    padding: { x: 3, y: 1 },
                }).setOrigin(0.5, 1).setVisible(false);
                this.activityLabels.set(person, text);
            }
            // Travel narrates too (LP-2 / proposal simulation-aliveness-2 P2-1): a person en route to an
            // action is in `waiting_for_materialization` — the street's most common visible state — and
            // used to show nothing. "→ Working the register" walks past "Jogging".
            const active = engine.activeInstanceOf(personId);
            const running = !!active && active.status === 'running';
            const traveling = !!active && active.status === 'waiting_for_materialization';
            const show = (running || traveling) && !person.isIndoors();
            if (show) {
                const label = engine.getActionLabel(active!.defId);
                // Destination-first travel labels (aliveness-3 follow-up, maintainer read): "→ Sleeping"
                // over a street walker read as street-sleeping — "→ home: Sleeping" says where they are
                // going AND why. The destination resolves from the instance's own location requirement.
                const display = traveling
                    ? `→ ${this.travelDestinationName(active!.locationOverride ?? engine.getDefinition(active!.defId)?.location)}: ${label}`
                    : label;
                text.setText(display);
                text.setData('baseText', display); // the merge pass suffixes ×N onto this, never compounds
            }
            text.setVisible(show);

            // The dog appears exactly while the walk RUNS (not en route to it) and despawns with the instance.
            let dot = this.petDots.get(person);
            const walking = running && show && active!.defId === 'walking_the_dog';
            if (walking && !dot) {
                dot = this.add.rectangle(0, 0, 6, 4, 0x8b5a2b).setVisible(false);
                this.petDots.set(person, dot);
            }
            dot?.setVisible(walking);
        }

        // Label collision pass (W8e / proposal simulation-aliveness-3 Part 5.1): co-located identical
        // labels merge into one "×N" (couples on a walk, coworkers on the same rotation used to double-ink
        // the same text over itself); distinct labels sharing a block stagger vertically instead of
        // overlapping into unreadable chains. Recomputed per refresh; the per-frame redraw closure applies
        // the stored stagger offset.
        const cells = new Map<string, { first: Phaser.GameObjects.Text; base: string; count: number; stagger: number }[]>();
        for (const [person, text] of this.activityLabels) {
            text.setData('stagger', 0);
            if (!text.visible) {
                continue;
            }
            const position = person.getPosition();
            if (!position) {
                continue;
            }
            const cellKey = `${Math.round(position.x / 64)}:${Math.round(position.y / 24)}`;
            const entries = cells.get(cellKey) ?? [];
            const base = text.getData('baseText') as string ?? text.text;
            const twin = entries.find(entry => entry.base === base);
            if (twin) {
                twin.count += 1;
                twin.first.setText(`${twin.base} ×${twin.count}`);
                text.setVisible(false); // merged into the twin's ×N
            } else {
                const stagger = entries.length * 11; // distinct labels stack upward within the block
                text.setData('stagger', stagger);
                entries.push({ first: text, base, count: 1, stagger });
                cells.set(cellKey, entries);
            }
        }
    }

    // Formation offsets (W5 / proposal simulation-aliveness-3 Part 5.3): people doing the same activity in
    // the same spot — a couple's walk, two officers on one chase — used to render as ONE overlapping
    // sprite. Render-layer only: logical positions stay canonical (pathfinding/co-location untouched); each
    // group member draws with a small lateral offset by stable slot index. The chase pair groups through an
    // alias (fleeing↔chasing are one scene). Refreshed per in-game minute; applied in the redraw closure.
    private formationOffsets = new Map<Person, number>();
    private static readonly FORMATION_ALIASES: Record<string, string> = {
        fleeing_the_police: 'chase', chasing_a_suspect: 'chase',
    };

    private refreshFormations(): void {
        const field = Game.field;
        const engine = Game.actionEngine;
        this.formationOffsets.clear();
        if (!field || !engine) {
            return;
        }
        const groups = new Map<string, Person[]>();
        for (const person of field.getPeople()) {
            if (person.isIndoors()) {
                continue;
            }
            const personId = person.social.getPersonId();
            const active = personId ? engine.activeInstanceOf(personId) : null;
            if (!active) {
                continue;
            }
            const position = person.getPosition();
            if (!position) {
                continue;
            }
            const token = MainScene.FORMATION_ALIASES[active.defId] ?? active.defId;
            const cell = `${token}|${Math.round(position.x / 32)}|${Math.round(position.y / 32)}`;
            const members = groups.get(cell) ?? [];
            members.push(person);
            groups.set(cell, members);
        }
        for (const members of groups.values()) {
            if (members.length < 2) {
                continue;
            }
            members.sort((a, b) => (a.social.getPersonId() ?? '').localeCompare(b.social.getPersonId() ?? ''));
            members.forEach((person, index) => {
                this.formationOffsets.set(person, (index - (members.length - 1) / 2) * 7);
            });
        }
    }

    // Curb-bag piles (W5 / proposal simulation-aliveness-3 P1-7): the town's uncollected curb bags become
    // VISIBLE — small brown mounds at the street side of occupied homes. The sim's curb pool is one shared
    // 'outside' location (the 112 collection contract), so per-house attribution is a DISPLAY approximation:
    // N bags render as piles at the curbs of the N lowest-keyed occupied homes (bags beyond one per home
    // grow the pile). Squalor 1.0 finally LOOKS like squalor instead of a pristine street with a nagbar.
    private trashPiles = new Map<string, Phaser.GameObjects.Rectangle>();

    private refreshTrashPiles(): void {
        const field = Game.field;
        const inventory = Game.inventory;
        if (!field || !inventory) {
            return;
        }
        const curbBags = inventory.instancesAtLocation('outside')
            .filter(instance => instance.archetypeId === 'bag_of_garbage' || instance.archetypeId === 'trash_bag')
            .reduce((total, instance) => total + instance.quantity, 0);
        const homes = field.getStructures()
            .filter((structure): structure is import('game/world/House').default => structure instanceof House && structure.getResidents().length > 0)
            .sort((a, b) => a.getIdentifier().localeCompare(b.getIdentifier()));
        const seen = new Set<string>();
        homes.forEach((home, index) => {
            const key = home.getIdentifier();
            if (homes.length === 0) {
                return;
            }
            // Round-robin distribution: every home shows its share; the remainder lands lowest-key first.
            const bagsHere = Math.floor(curbBags / homes.length) + (index < curbBags % homes.length ? 1 : 0);
            if (bagsHere <= 0) {
                return;
            }
            seen.add(key);
            let pile = this.trashPiles.get(key);
            const entrance = home.getEntrance();
            if (!entrance) {
                return;
            }
            const size = Math.min(10, 3 + bagsHere); // the pile grows with neglect, capped
            if (!pile) {
                pile = this.add.rectangle(0, 0, size, Math.max(2, size - 2), 0x5b4632);
                this.trashPiles.set(key, pile);
            }
            pile.setSize(size, Math.max(2, size - 2));
            pile.setPosition(entrance.x + 10, entrance.y + 4);
            pile.setDepth(home.calculateDepth() + 1);
            pile.setVisible(true);
        });
        for (const [key, pile] of this.trashPiles) {
            if (!seen.has(key)) {
                pile.destroy();
                this.trashPiles.delete(key);
            }
        }
    }

    // A short human name for a travel destination key (the "→ home: Sleeping" labels).
    private travelDestinationName(location: string | undefined): string {
        if (!location) {
            return 'out';
        }
        if (location === 'home') {
            return 'home';
        }
        if (location === 'outside') {
            return 'outside';
        }
        if (location.startsWith('venue:')) {
            return `the ${location.slice('venue:'.length).replace(/_/g, ' ')}`;
        }
        if (location.startsWith('building:')) {
            const key = location.slice('building:'.length);
            const structure = Game.field?.getStructures().find(candidate => candidate instanceof Building && candidate.getIdentifier() === key);
            if (structure instanceof Workplace) {
                return structure.getBusiness()?.name ?? 'work';
            }
            if (structure instanceof House) {
                return `the ${structure.getHouseholdName() || 'neighbors'}' place`;
            }
        }
        if (location.startsWith('person:')) {
            return 'a visit';
        }
        return 'out';
    }

    private drawPerson(person: Person): void {
        const position: PixelPosition = person.getPosition();
        if (position === null) {
            return;
        }

        const personSprite: Image = this.add.image(position.x, position.y, 'person');
        personSprite.setOrigin(0.5, 0.5);
        person.setAsset(personSprite);

        // Sidewalk jitter (aliveness-3 follow-up, maintainer read): every pedestrian walks the EXACT curb
        // polyline, so any two at the same spot rendered perfectly stacked — the street read as one person.
        // A stable per-person render offset (±4px, derived from the id) puts people on different parts of
        // the sidewalk; render-layer only, logical positions untouched. Memoized once the id exists.
        let jitterX = 0;
        let jitterY = 0;
        let jitterForId: string | null = null;

        person.setRedrawFunction((_: number) => {
            const personAsset = person.getAsset();
            if (personAsset === null) {
                return;
            }
            const personId = person.social.getPersonId();
            if (personId && jitterForId !== personId) {
                const seed = hashStringToSeed('sidewalk#' + personId);
                jitterX = (seed % 9) - 4;
                jitterY = (Math.floor(seed / 9) % 7) - 3;
                jitterForId = personId;
            }

            const isIndoors = person.isIndoors();
            if (isIndoors) {
                // Entering a building hides EVERYTHING frame-accurately (aliveness-3 follow-up, maintainer
                // read): the old early-return hid the sprite but left the activity bubble (and the pet dot)
                // standing at the door until the next per-minute refresh — ghost labels over entrances.
                if (personAsset.visible) {
                    personAsset.setVisible(false);
                }
                const staleBubble = this.activityLabels.get(person);
                if (staleBubble?.visible) {
                    staleBubble.setVisible(false);
                }
                const stalePet = this.petDots.get(person);
                if (stalePet?.visible) {
                    stalePet.setVisible(false);
                }
                return;
            }

            if (!personAsset.visible) {
                personAsset.setVisible(true);
            }

            const position = person.getPosition();
            if (position === null) {
                return;
            }

            const direction = person.getDirection();
            const rotation = directionToRadianRotation(direction);

            personAsset.setRotation(rotation);
            // Side-by-side formations (W5) + the sidewalk jitter: both are render offsets — the formation
            // separates co-walking group members, the jitter separates everyone else on the shared curb.
            personAsset.setPosition(position.x + jitterX + (this.formationOffsets.get(person) ?? 0), position.y + jitterY);
            personAsset.setDepth(person.getDepth());

            // The activity bubble follows the sprite (task 093 / J2); text/visibility refresh per minute.
            // The stagger offset (W8e) lifts colliding labels apart within a block.
            const bubble = this.activityLabels.get(person);
            if (bubble && bubble.visible) {
                bubble.setPosition(position.x, position.y - 12 - ((bubble.getData('stagger') as number | undefined) ?? 0));
                bubble.setDepth(person.getDepth() + 2);
            }
            // The dog trails the owner (task 115): a fixed lag behind the sprite, same depth layer.
            const pet = this.petDots.get(person);
            if (pet && pet.visible) {
                pet.setPosition(position.x - 6, position.y + 5);
                pet.setDepth(person.getDepth() + 1);
            }
        });
    }

    private drawVehicle(vehicle: Vehicle): void {
        const position: PixelPosition = vehicle.getPosition();
        if (position === null) {
            return;
        }

        const vehicleSprite: Image = this.add.image(position.x, position.y, 'vehicle_md');
        vehicleSprite.setOrigin(0.5, 0.5);
        vehicle.setAsset(vehicleSprite);

        vehicle.setRedrawFunction((timeDelta: number) => {
            const vehicleAsset = vehicle.getAsset();
            if (vehicleAsset === null) {
                return;
            }

            const position = vehicle.getPosition();
            if (position === null) {
                return;
            }
            
            const currentRotation = vehicleAsset.rotation;
            const newRotation = vehicle.curve(currentRotation, timeDelta);
            vehicleAsset.setRotation(newRotation);

            vehicleAsset.setPosition(position.x, position.y);
            vehicleAsset.setDepth(vehicle.getDepth());
        });
    }
}