import Phaser from 'phaser';

import GameManager from 'app/GameManager';
import Tile from 'app/Tile';
import Soil from 'app/Soil';
import Person from 'app/Person';
import Vehicle from 'app/Vehicle';
import { directionToRadianRotation } from 'util/tools';

import { PixelPosition, TilePosition } from 'types/Position';
import { Cursor, Tool } from 'types/Cursor';
import { Image, SceneConfig } from 'types/Phaser';
import { AssetManifest } from 'types/Assets';

import assetManifest from 'json/assets.json';
import inputConfig from 'json/input.json';

type Pointer = Phaser.Input.Pointer;
type CameraControl = Phaser.Cameras.Controls.SmoothedKeyControl | null;
type Grid = Phaser.GameObjects.Grid | null;

export default class MainScene extends Phaser.Scene {
    private gameManager: GameManager;
    private cameraController: CameraControl;
    private cursor: Cursor;
    private grid: Grid;

    constructor(gameManager: GameManager, sceneConfig: SceneConfig) {
        super(sceneConfig);
        this.gameManager = gameManager;

        this.cursor = null;
        this.cameraController = null;
        this.grid = null;

        this.gameManager.on("tileSpawned", { callback: this.drawTile, context: this });
        this.gameManager.on("personSpawned", { callback: this.drawPerson, context: this });
        this.gameManager.on("vehicleSpawned", { callback: this.drawVehicle, context: this });
    }

    init(_: any): void { }

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

        inputConfig.inputMappings.forEach(mapping => {
            this.input.keyboard?.addKey(mapping.key).on('down', () => {
                this.setCursor(mapping.tool as Tool);
            });
        });

        this.input.keyboard.addKey('P').on('down', () => {
            const pointer = {
                x: this.input.activePointer.worldX,
                y: this.input.activePointer.worldY
            };
            this.gameManager.emit("personNeeded", pointer);
        });

        this.input.keyboard.addKey('V').on('down', () => {
            const pointer = {
                x: this.input.activePointer.worldX,
                y: this.input.activePointer.worldY
            };
            this.gameManager.emit("vehicleNeeded", pointer);
        });

        this.input.keyboard.addKey('G').on('down', () => {
            this.toggleGrid();
        });

        this.input.on('pointermove', (pointer: Pointer) => {
            if (pointer.isDown) {
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

        this.gameManager.emit("sceneInitialized", this);
        console.info('Scene intialized.');
    }

    update(time: number, timeDelta: number): void {
        this.gameManager.emit("update", { time, timeDelta });
        this.cameraController?.update(timeDelta);
        this.handleHover();
    }

    private handleHover(): void {
        const cursor = this.getCursor();
        if (!cursor?.asset) {
            return;
        }

        const mouseX = this.input.activePointer.worldX;
        const mouseY = this.input.activePointer.worldY;
        const mousePixelPosition: PixelPosition = { x: mouseX, y: mouseY };

        const tilePosition = this.gameManager.pixelToTilePosition(mousePixelPosition);
        if (tilePosition === null) {
            this.hideCursor();
            return;
        }

        const tileCenter = this.gameManager.tileToPixelPosition(tilePosition);
        if (tileCenter === null) {
            this.hideCursor();
            return;
        }

        const imageX = tileCenter.x;
        const imageY = tileCenter.y + (this.gameManager.gridParams.cells.height / 2);
        cursor.asset.setPosition(imageX, imageY);
        this.unhideCursor();
    }

    private handleClick(pointer: Pointer): void {
        const pixelPosition: PixelPosition = { x: pointer.worldX, y: pointer.worldY };

        const tilePosition = this.gameManager.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            return;
        }

        const cursor = this.getCursor();
        if (cursor === null) {
            return;
        }

        this.gameManager.emit("tileClicked", { position: tilePosition, tool: cursor.tool });
    }

    getCursor(): Cursor {
        return this.cursor;
    }

    setCursor(tool: Tool): void {
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
        const assetName = this.gameManager.toolbelt[this.cursor.tool as Tool];
        if (!assetName) {
            return;
        }

        const asset: Image = this.add.image(0, 0, assetName);
        asset.setAlpha(0.5);
        asset.setOrigin(0.5, 1);
        asset.setDepth((this.gameManager.gridParams.rows * 10) + 1);

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
        const gridParams = this.gameManager.gridParams;
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
        grid.setDepth((this.gameManager.gridParams.rows * 10) + 100);

        this.gameManager.gridParams.bounds = grid.getBounds();
        this.grid = grid;
    }

    private drawTile(tile: Tile): void {
        const gridParams = this.gameManager.gridParams;

        const tilePosition: TilePosition = tile.getPosition();
        if (tilePosition === null) {
            return;
        }

        const pixelPosition = this.gameManager.tileToPixelPosition(tilePosition);
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
            // We need to set the Y coordinate as a bottom value for buildings, otherwise tall buildings will be (incorrectly) centralized on the tile
            const imageX = pixelPosition.x;
            const imageY = pixelPosition.y + (gridParams.cells.height / 2);
            image = this.add.image(imageX, imageY, assetName);
            image.setOrigin(0.5, 1);
        }
        image.setDepth(tile.calculateDepth());

        const existingTileAsset = tile.getAsset();
        if (existingTileAsset) {
            existingTileAsset.destroy();
        }

        tile.setAsset(image);
    }

    private drawPerson(person: Person): void {
        const position: PixelPosition = person.getPosition();
        if (position === null) {
            return;
        }

        const personSprite: Image = this.add.image(position.x, position.y, 'person');
        personSprite.setOrigin(0.5, 0.5);
        person.setAsset(personSprite);

        person.setRedrawFunction((_: number) => {
            const personAsset = person.getAsset();
            if (personAsset === null) {
                return;
            }

            const position = person.getPosition();
            if (position === null) {
                return;
            }

            const direction = person.getDirection();
            const rotation = directionToRadianRotation(direction);
            
            personAsset.setRotation(rotation);
            personAsset.setPosition(position.x, position.y);
            personAsset.setDepth(person.getDepth());
        });
    }

    private drawVehicle(vehicle: Vehicle): void {
        const position: PixelPosition = vehicle.getPosition();
        if (position === null) {
            return;
        }

        const vehicleSprite: Image = this.add.image(position.x, position.y, 'vehicle');
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