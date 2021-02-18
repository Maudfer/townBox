import GameManager from './GameManager.js';

const manager = new GameManager();

/*
var config = {
    type: Phaser.AUTO,
    width: 1000,
    height: 1000,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: {
        preload: preload,
        create: create
    }
};

var game = new Phaser.Game(config);

let gridInfo = {
    width: 900,
    height: 900,
    x: 500,
    y: 500,
    cellWidth: 45,
    cellHeight: 45
};

gridInfo.rowCells = gridInfo.width / gridInfo.cellWidth;
gridInfo.colCells = gridInfo.height / gridInfo.cellHeight;

function getCell(row, col){
    let cellPositions = null;

    if(row >= 0 && row < gridInfo.rowCells){
        let yEdge = gridInfo.bounds.y + (row * gridInfo.cellHeight);
        let yCenter = yEdge + (gridInfo.cellHeight / 2);

        let xEdge = gridInfo.bounds.x + (col * gridInfo.cellWidth);
        let xCenter = xEdge + (gridInfo.cellWidth / 2);

        cellPositions = {
            x: xCenter,
            y: yCenter
        };
    }

    return cellPositions;
}

function moveTo(gameObj, speed, target, row, col){
    let destination = getCell(row, col);
    let timeline = gameObj.tweens.createTimeline();

    console.log(target);

    timeline.add({
        targets: target,
        duration: Math.abs(destination.x - target.x) / speed,
        x: destination.x,
        ease: 'Sine.easeIn'
    });

    timeline.add({
        targets: target,
        duration: Math.abs(destination.y - target.y) / speed,
        y: destination.y,
        ease: 'Sine.easeOut'
    });

    timeline.play();
    console.log(timeline);
}

function preload (){
    this.load.setBaseURL('./');
    this.load.image('ball', 'assets/ball.png');
}

function create (){
    let grid = this.add.grid(gridInfo.x, gridInfo.y, gridInfo.width, gridInfo.height, gridInfo.cellWidth, gridInfo.cellHeight, 0x057605);
    gridInfo.bounds = grid.getBounds();

    let cell1 = getCell(0, 0);
    //let cell2 = getCell(0, 0);

    var ball = this.add.image(cell1.x, cell1.y, 'ball');

    moveTo(this, 0.125, ball, 11, 19);


}
*/