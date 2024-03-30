import Phaser from 'phaser';


export default class MainScene extends Phaser.Scene {
    constructor(gameManager) {
        super();
        this.gameManager = gameManager;
        this.cursorEntity = null;
        this.gridParams = null;

        this.gameManager.on('tileUpdated', this.drawTile);
        this.gameManager.on('personSpawned', this.drawPerson);
    }

    init(data) { }

    preload() {
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

    create(data) {
        this.drawGrid(this); //antipattern

        this.input.mouse.disableContextMenu();
        this.setCursor('road', 'road_1100');

        this.input.keyboard.addKey('S').on('down', (event) => {
            console.log('Saved.');
        });

        this.input.keyboard.addKey('F1').on('down', (event) => {
            this.setCursor('building_1x1x1_1', 'building_1x1x1_1');
        });

        this.input.keyboard.addKey('F2').on('down', (event) => {
            this.setCursor('building_1x1x1_2', 'building_1x1x1_2');
        });

        this.input.keyboard.addKey('F3').on('down', (event) => {
            this.setCursor('building_1x1x1_3', 'building_1x1x1_3');
        });

        this.input.keyboard.addKey('F4').on('down', (event) => {
            this.setCursor('building_1x1x1_4', 'building_1x1x1_4');
        });

        this.input.keyboard.addKey('F5').on('down', (event) => {
            this.setCursor('building_1x1x1_5', 'building_1x1x1_5');
        });

        this.input.keyboard.addKey('F6').on('down', (event) => {
            this.setCursor('building_1x1x1_6', 'building_1x1x1_6');
        });

        this.input.keyboard.addKey('F7').on('down', (event) => {
            this.setCursor('building_1x1x2_1', 'building_1x1x2_1');
        });

        this.input.keyboard.addKey('F8').on('down', (event) => {
            this.setCursor('building_1x1x2_2', 'building_1x1x2_2');
        });

        this.input.keyboard.addKey('F9').on('down', (event) => {
            this.setCursor('road', 'road_1100');
        });

        this.input.keyboard.addKey('F10').on('down', (event) => {
            this.setCursor('eraser', null);
        });

        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown) {
                this.handleClick(pointer);
            }
        });

        this.input.on('pointerdown', (pointer) => {
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
        this.cameraControls = new Phaser.Cameras.Controls.SmoothedKeyControl(cameraControlParams);

        console.log('Scene intialized.');
    }

    update(time, delta) {
        // this.gameManager.updateField();
        // this.gameManager.updatePeople();

        this.people.forEach(person => {
            person.walk(this.field, this);

            let tilePosition = this.getTilePosition(person.x, person.y);
            person.updateTile(tilePosition.row, tilePosition.col);

            // If the person reaches the center of the tile, decide the new direction
            if (person.isAtTileCenter(this)) {
                person.decideNewDirection(this.field);
            }
        });

        this.cameraControls.update(delta);
        this.handleHover();

        // console.log(`Update: ${time}`);
    }

    handleHover() {
        if (this.getCursor().entity !== null) {
            const tilePosition = this.getTilePosition(this.input.activePointer.worldX, this.input.activePointer.worldY);

            if (tilePosition !== null) {
                const tileCenter = this.getCellPosition(tilePosition.row, tilePosition.col);
                const imageX = tileCenter.x;
                const imageY = tileCenter.y + (this.gridParams.cells.height / 2);
                this.getCursor().entity.setPosition(imageX, imageY);
                this.unhideCursor();
            } else {
                this.hideCursor();
            }
        }
    }

    handleClick(pointer) {
        const position = this.getTilePosition(pointer.worldX, pointer.worldY);
        const tool = this.getCursor().tool;

        if (position !== null) {
            this.gameManager.trigger("tileClicked", { position, tool });
        }
    }

    setCursor(toolName, textureName) {
        this.tool = toolName;

        if (this.cursorEntity !== null) {
            this.cursorEntity.destroy();
        }

        if (textureName !== null) {
            this.cursorEntity = this.add.image(0, 0, textureName);
            this.cursorEntity.setAlpha(0.5);
            this.cursorEntity.setOrigin(0.5, 1);
            this.cursorEntity.setDepth((this.gridParams.rows * 10) + 1);
        }
    }

    unhideCursor() {
        if (this.cursorEntity !== null && !this.cursorEntity.visible) {
            this.cursorEntity.setVisible(true);
        }
    }

    hideCursor() {
        if (this.cursorEntity !== null && this.cursorEntity.visible) {
            this.cursorEntity.setVisible(false);
        }
    }

    getCursor() {
        return {
            tool: this.tool,
            entity: this.cursorEntity
        };
    }

    setGridParams(gridParams) {
        this.gridParams = gridParams;
    }

    drawGrid(scene) {
        const backgroundColor = 0x057605;

        this.grid = scene.add.grid(
            this.gridParams.gridX,
            this.gridParams.gridY,
            this.gridParams.width,
            this.gridParams.height,
            this.gridParams.cells.width,
            this.gridParams.cells.height,
            backgroundColor
        );

        this.gridParams.bounds = this.grid.getBounds();
    }

    drawTile(tile) {
        const row = tile.getRow();
        const col = tile.getCol();

        const textureName = tile.getTextureName();
        const pixelPosition = this.getCellPosition(row, col);

        if (textureName !== null) {
            const imageX = pixelPosition.x;
            const imageY = pixelPosition.y + (this.gridParams.cells.height / 2);

            const image = this.add.image(imageX, imageY, textureName);
            image.setDepth(row * 10);
            image.setOrigin(0.5, 1);

            tile.setAsset(image);
        }
    }

    drawPerson(person) {
        const { x, y } = person.getPosition();

        const personSprite = this.add.image(x, y, 'person');
        personSprite.setOrigin(0.5, 0.5);

        person.setImage(personSprite);
    }

}