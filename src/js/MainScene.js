import Phaser from 'phaser';

export default class MainScene extends Phaser.Scene {
    constructor (field) {
        super();
        this.field = field;
        this.constructions = {};
    }

    init(data) {

    }

    preload () {
        this.load.setBaseURL('./');

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

    create (data)  {
        this.drawGrid(this); //antipattern

        this.input.mouse.disableContextMenu();

        let mouseTool = 'road';

        this.input.keyboard.addKey('F1').on('up', function(event) {
            mouseTool = 'building_1x1x1_1';
        });

        this.input.keyboard.addKey('F2').on('up', function(event) {
            mouseTool = 'building_1x1x1_2';
        });

        this.input.keyboard.addKey('F3').on('up', function(event) {
            mouseTool = 'building_1x1x1_3';
        });

        this.input.keyboard.addKey('F4').on('up', function(event) {
            mouseTool = 'building_1x1x1_4';
        });

        this.input.keyboard.addKey('F5').on('up', function(event) {
            mouseTool = 'building_1x1x1_5';
        });

        this.input.keyboard.addKey('F6').on('up', function(event) {
            mouseTool = 'building_1x1x1_6';
        });

        this.input.keyboard.addKey('F7').on('up', function(event) {
            mouseTool = 'building_1x1x2_1';
        });

        this.input.keyboard.addKey('F8').on('up', function(event) {
            mouseTool = 'building_1x1x2_2';
        });

        this.input.keyboard.addKey('F9').on('up', function(event) {
            mouseTool = 'road';
        });

        this.input.keyboard.addKey('F10').on('up', function(event) {
            mouseTool = 'eraser';
        });

        this.input.on('pointerup', (pointer) => {
            this.handleCellClick(pointer.worldX, pointer.worldY, mouseTool);
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
            acceleration: 0.25, // originally was 0.06
            drag: 0.002, // originally was 0.0005
            maxSpeed: 0.25 // originally was 1.0
        };
        this.cameraControls = new Phaser.Cameras.Controls.SmoothedKeyControl(cameraControlParams);

        console.log('Scene intialized.');
    }

    update(time, delta) {
        this.field.iterateBuildQueue((tile) => {
            const row = tile.getRow();
            const col = tile.getCol();

            const pixelPosition = this.getCellPosition(row, col);
            const identifier = `${row}-${col}`;

            if(this.constructions[identifier]) {
                this.constructions[identifier].destroy();
                delete this.constructions[identifier];
            }

            const textureName = tile.getTextureName();
            if(textureName !== null){
                const imageX = pixelPosition.x;
                const imageY = pixelPosition.y + (this.gridParams.cells.height / 2);

                const image = this.add.image(imageX, imageY, tile.getTextureName());
                image.setDepth(row);
                image.setOrigin(0.5, 1);

                this.constructions[identifier] = image;
            }
        });

        this.cameraControls.update(delta);
       //console.log(`Update: ${time}`);
    }

    // gets cell center position in pixels given a specific row and col
    getCellPosition(row, col){
        let cellPositions = null;

        if(row >= 0 && row < this.field.getRows()){
            const yEdge = this.gridParams.bounds.top + (row * this.gridParams.cells.height);
            const yCenter = yEdge + (this.gridParams.cells.height / 2);
    
            const xEdge = this.gridParams.bounds.left + (col * this.gridParams.cells.width);
            const xCenter = xEdge + (this.gridParams.cells.width / 2);
    
            cellPositions = {
                x: xCenter,
                y: yCenter
            };
        }
    
        return cellPositions;
    }

    // gets tile position in row and col given X and Y in pixels
    getTilePosition(pixelX, pixelY){
        const belowTop = pixelY > this.gridParams.bounds.top;
        const aboveBottom = pixelY < this.gridParams.bounds.bottom;
        const afterLeft = pixelX > this.gridParams.bounds.left;
        const beforeRight = pixelX < this.gridParams.bounds.right;

        let position = null;

        if(belowTop && aboveBottom && afterLeft && beforeRight){
            const distance = {
                top: pixelY - this.gridParams.bounds.top,
                left: pixelX - this.gridParams.bounds.left
            };
            
            const row = Math.floor(distance.top / this.gridParams.cells.height);
            const col = Math.floor(distance.left / this.gridParams.cells.width); 

            position = {row, col};
        }

        return position;
    }

    handleCellClick(clickedX, clickedY, clickEvent){
        const position = this.getTilePosition(clickedX, clickedY);
        if(position){
            this.field.handleTileClick(position.row, position.col, clickEvent);
        }
    }

    setScreenParams(screenWidth, screenHeight){
        this.screenParams = {
            width: screenWidth,
            height: screenHeight,
            horizontalCenter: screenWidth / 2,
            verticalCenter: screenHeight / 2,
        };
    }

    setGridParams(rows, cols, gridWidth, gridHeight){
        this.gridParams = {
            width: gridWidth,
            height: gridHeight,

            rows: rows,
            cols: cols,

            cells: {
                width: gridWidth / cols,
                height: gridHeight / rows,
            }
        };
    }

    drawGrid(scene) {
        const backgroundColor = 0x057605;

        this.grid = scene.add.grid(
            this.screenParams.horizontalCenter, 
            this.screenParams.verticalCenter, 
            this.gridParams.width, 
            this.gridParams.height,
            this.gridParams.cells.width, 
            this.gridParams.cells.height, 
            backgroundColor
        );
        
        this.gridParams.bounds = this.grid.getBounds();
    }

}