import Phaser from 'phaser';

export default class MainScene extends Phaser.Scene {
    constructor (field) {
        super();
        this.field = field;
    }

    init(data) {

    }

    preload () {
        this.load.setBaseURL('./');
        this.load.image('ball', 'ball.png');
    }

    create (data)  {
        console.log('Scene intialized.');
        this.drawGrid(this);

        this.input.mouse.disableContextMenu();
        this.input.on('pointerup', (pointer) => {
            this.handleCellClick(pointer.worldX, pointer.worldY);
        });
    }

    update(time, delta) {
        this.field.iterateBuildQueue((tile) => {
            const position = this.getCellPosition(tile.getRow(), tile.getCol());
            this.add.image(position.x, position.y, tile.getContent());
        });

       //console.log(`Update: ${time}`);
    }

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

    handleCellClick(clickedX, clickedY){
        const position = this.getTilePosition(clickedX, clickedY);
        if(position){
            this.field.handleTileClick(position.row, position.col);
        }
    }

    setScreenParams(screen){
        this.screenParams = {
            width: screen.width,
            height: screen.height,
            horizontalCenter: screen.width / 2,
            verticalCenter: screen.height / 2,
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