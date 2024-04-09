import Phaser from 'phaser';

import GameManager from 'app/GameManager';
import Tile from 'app/Tile';
import Soil from 'app/Soil';
import Road from 'app/Road';
import Person from 'app/Person';

import { PixelPosition, TilePosition } from 'types/Position';
import { Cursor } from 'types/Cursor';
import { Image } from 'types/Phaser';
import { AssetManifest } from 'types/Assets';

import assetManifest from 'json/assets.json';
import inputConfig from 'json/input.json';

type Pointer = Phaser.Input.Pointer;
type CameraControl = Phaser.Cameras.Controls.SmoothedKeyControl | null;
type Grid = Phaser.GameObjects.Grid | null;
type SceneConfig = Phaser.Types.Scenes.SettingsConfig;

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

        this.gameManager.on('tileUpdated', { callback: this.drawTile, context: this });
        this.gameManager.on('personSpawned', { callback: this.drawPerson, context: this });
    }

    init(_: any): void { }

    preload(): void {
        const assets: AssetManifest = assetManifest;

        this.load.setBaseURL(assets.baseURL);
        assets.assets.forEach(asset => {
            if (asset.type === "image") {
                this.load.image(asset.key, asset.file);
            }
        });
    }

    create(): void {
        this.drawGrid(this);

        if (!this.input || !this.input.mouse || !this.input.keyboard) {
            return;
        }

        this.input.mouse.disableContextMenu();
        this.setCursor('road', 'road_1100');

        inputConfig.inputMappings.forEach(mapping => {
            this.input.keyboard?.addKey(mapping.key).on('down', () => {
                this.setCursor(mapping.toolName, mapping.textureName);
            });
        });

        this.input.keyboard.addKey('P').on('down', () => {
            const pointer = {
                x: this.input.activePointer.worldX,
                y: this.input.activePointer.worldY
            };
            this.gameManager.trigger("personNeeded", pointer);
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
        this.cameras.main.zoom = 2;
        const cameraControlParams = {
            camera: this.cameras.main,
            left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            zoomIn: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
            zoomOut: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            maxZoom: 5,
            minZoom: 0.32,
            zoomSpeed: 0.08, // originally was 0.02
            acceleration: 0.75, // originally was 0.06
            drag: 0.002, // originally was 0.0005
            maxSpeed: 0.45 // originally was 1.0
        };
        this.cameraController = new Phaser.Cameras.Controls.SmoothedKeyControl(cameraControlParams);

        this.gameManager.trigger("sceneInitialized", { scene: this });
        console.log('Scene intialized.');
    }

    update(time: number, delta: number): void {
        this.gameManager.trigger("update", { time, delta });
        this.cameraController?.update(delta);
        this.handleHover();
    }

    private handleHover(): void {
        const cursor = this.getCursor();
        if (!cursor?.entity) {
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
        cursor.entity.setPosition(imageX, imageY);
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

        this.gameManager.trigger("tileClicked", { position: tilePosition, tool: cursor.tool });
    }

    getCursor(): Cursor {
        return this.cursor;
    }

    setCursor(toolName: string, textureName: string | null): void {
        if (!this.cursor) {
            this.cursor = {
                tool: "",
                entity: null
            };
        }

        if (this.cursor && this.cursor.entity !== null) {
            this.cursor.entity.destroy();
            this.cursor.entity = null;
        }

        this.cursor.tool = toolName;
        if (textureName) {
            let entity: Image;
            entity = this.add.image(0, 0, textureName);
            entity.setAlpha(0.5);
            entity.setOrigin(0.5, 1);
            entity.setDepth((this.gameManager.gridParams.rows * 10) + 1);
            this.cursor.entity = entity;
        }
    }

    private unhideCursor(): void {
        if (!this.cursor) {
            return;
        }

        const entity = this.cursor.entity;
        if (entity !== null && !entity.visible) {
            entity.setVisible(true);
        }
    }

    private hideCursor(): void {
        if (!this.cursor) {
            return;
        }

        const entity = this.cursor.entity;
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

        const textureName = tile.getTextureName();
        if (textureName === null) {
            return;
        }

        let image: Image;
        if (tile instanceof Soil) {
            image = this.add.image(pixelPosition.x, pixelPosition.y, textureName);
            image.setOrigin(0.5, 0.5);

            const angles: number[] = [0, 90, 180, 270];
            const rotation = angles[Math.floor(Math.random() * angles.length)]! * (Math.PI / 180);

            image.setRotation(rotation);
        } else {
            // We need to set the Y coordinate as a bottom value for buildings, otherwise tall buildings will be (incorrectly) centralized on the tile
            const imageY = pixelPosition.y + (gridParams.cells.height / 2);
            image = this.add.image(pixelPosition.x, imageY, textureName);
            image.setOrigin(0.5, 1);
        } 
        image.setDepth(tile.calculateDepth());

        if(tile instanceof Road){
            setTimeout(() => {
                const curb = tile.getCurb();
                if (curb) {
                    const tlRect = this.add.rectangle(curb.topLeft.x, curb.topLeft.y, 1, 1, 0xff0000);
                    const trRect = this.add.rectangle(curb.topRight.x, curb.topRight.y, 1, 1, 0xff0000);
                    const brRect = this.add.rectangle(curb.bottomRight.x, curb.bottomRight.y, 1, 1, 0xff0000);
                    const blRect = this.add.rectangle(curb.bottomLeft.x, curb.bottomLeft.y, 1, 1, 0xff0000);

                    tlRect.setDepth(9000);
                    trRect.setDepth(9000);
                    brRect.setDepth(9000);
                    blRect.setDepth(9000);

                    tlRect.setOrigin(0.5, 0.5);
                    trRect.setOrigin(0.5, 0.5);
                    brRect.setOrigin(0.5, 0.5);
                    blRect.setOrigin(0.5, 0.5);

                }
                console.log(curb);
                console.log("--------------------------------");
            }, 10);
        }

        const existingTileAsset: Image = tile.getAsset();
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

        person.setRedrawFunction(() => {
            const personAsset = person.getAsset();
            if (personAsset === null) {
                return;
            }

            const position = person.getPosition();
            if (position === null) {
                return;
            }

            const movingAxis = person.getMovingAxis();
            if (movingAxis === 'x') {
                personAsset.setRotation(0);
            } else if (movingAxis === 'y') {
                personAsset.setRotation(90 * (Math.PI / 180));
            }

            personAsset.setPosition(position.x, position.y);
            personAsset.setDepth(person.getDepth());
        });
    }
}