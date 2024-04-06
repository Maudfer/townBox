import Phaser from 'phaser';

import GameManager from '@/GameManager';
import Tile from '@/Tile';
import Person from '@/Person';

import { PixelPosition, TilePosition } from '@/types/Position';
import { Cursor } from '@/types/Cursor';
import { Image } from '@/types/Phaser';

type Pointer = Phaser.Input.Pointer;
type CameraControl = Phaser.Cameras.Controls.SmoothedKeyControl | null;
type SceneConfig = Phaser.Types.Scenes.SettingsConfig;

export default class MainScene extends Phaser.Scene {
    private gameManager: GameManager;
    private cameraController: CameraControl;
    private cursor: Cursor;

    constructor(gameManager: GameManager, sceneConfig: SceneConfig) {
        super(sceneConfig);
        this.gameManager = gameManager;

        this.cursor = null;
        this.cameraController = null;

        this.gameManager.on('tileUpdated', {callback: this.drawTile, context: this});
        this.gameManager.on('personSpawned', {callback: this.drawPerson, context: this});
    }

    init(_: any): void { }

    preload(): void {
        this.load.setBaseURL('./');

        // People
        this.load.image('person', 'person.png');

        // Roads
        this.load.image('road_0011', 'road_0011.png');
        this.load.image('road_0101', 'road_0101.png');
        this.load.image('road_0110', 'road_0110.png');
        this.load.image('road_0111', 'road_0111.png');
        this.load.image('road_1001', 'road_1001.png');
        this.load.image('road_1010', 'road_1010.png');
        this.load.image('road_1011', 'road_1011.png');
        this.load.image('road_1100', 'road_1100.png');
        this.load.image('road_1101', 'road_1101.png');
        this.load.image('road_1110', 'road_1110.png');
        this.load.image('road_1111', 'road_1111.png');

        // 1x1x1 Buildings
        this.load.image('building_1x1x1_1', 'building_1x1x1_1.png');
        this.load.image('building_1x1x1_2', 'building_1x1x1_2.png');
        this.load.image('building_1x1x1_3', 'building_1x1x1_3.png');
        this.load.image('building_1x1x1_4', 'building_1x1x1_4.png');
        this.load.image('building_1x1x1_5', 'building_1x1x1_5.png');
        this.load.image('building_1x1x1_6', 'building_1x1x1_6.png');

        // 1x1x2 Buildings
        this.load.image('building_1x1x2_1', 'building_1x1x2_1.png');
        this.load.image('building_1x1x2_2', 'building_1x1x2_2.png');

        // 2x1x1 Buildings
        this.load.image('building_2x1x1_1_left', 'building_2x1x1_1_left.png');
        this.load.image('building_2x1x1_1_right', 'building_2x1x1_1_right.png');

        // 2x2x1 Buildings
        this.load.image('building_2x2x1_1_down-left', 'building_2x2x1_1_down-left.png');
        this.load.image('building_2x2x1_1_down-right', 'building_2x2x1_1_down-right.png');
        this.load.image('building_2x2x1_1_up-left', 'building_2x2x1_1_up-left.png');
        this.load.image('building_2x2x1_1_up-right', 'building_2x2x1_1_up-right.png');
    }

    create(): void {
        this.drawGrid(this);

        this.input.mouse.disableContextMenu();
        this.setCursor('road', 'road_1100');

        this.input.keyboard.addKey('F1').on('down', () => {
            this.setCursor('building_1x1x1_1', 'building_1x1x1_1');
        });

        this.input.keyboard.addKey('F2').on('down', () => {
            this.setCursor('building_1x1x1_2', 'building_1x1x1_2');
        });

        this.input.keyboard.addKey('F3').on('down', () => {
            this.setCursor('building_1x1x1_3', 'building_1x1x1_3');
        });

        this.input.keyboard.addKey('F4').on('down', () => {
            this.setCursor('building_1x1x1_4', 'building_1x1x1_4');
        });

        this.input.keyboard.addKey('F5').on('down', () => {
            this.setCursor('building_1x1x1_5', 'building_1x1x1_5');
        });

        this.input.keyboard.addKey('F6').on('down', () => {
            this.setCursor('building_1x1x1_6', 'building_1x1x1_6');
        });

        this.input.keyboard.addKey('F7').on('down', () => {
            this.setCursor('building_1x1x2_1', 'building_1x1x2_1');
        });

        this.input.keyboard.addKey('F8').on('down', () => {
            this.setCursor('building_1x1x2_2', 'building_1x1x2_2');
        });

        this.input.keyboard.addKey('F9').on('down', () => {
            this.setCursor('road', 'road_1100');
        });

        this.input.keyboard.addKey('F10').on('down', () => {
            this.setCursor('eraser', null);
        });

        this.input.keyboard.addKey('P').on('down', () => {
            const pointer = {
                x: this.input.activePointer.worldX,
                y: this.input.activePointer.worldY
            };
            this.gameManager.trigger("personNeeded", pointer);
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
            acceleration: 0.75, // originally was 0.06
            drag: 0.002, // originally was 0.0005
            maxSpeed: 0.35 // originally was 1.0
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
        if (this.cursor && this.cursor.entity !== null) {
            this.cursor.entity.destroy();
            this.cursor.entity = null;
        } else if (!this.cursor) {
            this.cursor = {
                tool: "",
                entity: null
            };
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

    private drawGrid(scene: MainScene): void {
        const gridParams = this.gameManager.gridParams;
        const backgroundColor = 0x057605;

        const grid = scene.add.grid(
            gridParams.gridX,
            gridParams.gridY,
            gridParams.width,
            gridParams.height,
            gridParams.cells.width,
            gridParams.cells.height,
            backgroundColor
        );

        this.gameManager.gridParams.bounds = grid.getBounds();
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

        const imageX = pixelPosition.x;
        const imageY = pixelPosition.y + (gridParams.cells.height / 2);

        const image = this.add.image(imageX, imageY, textureName);
        image.setDepth(tilePosition.row * 10);
        image.setOrigin(0.5, 1);

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
    }
}