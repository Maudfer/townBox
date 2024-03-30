import Phaser from 'phaser';
import Field from './Field.js';
import MainScene from './MainScene.js';

export default class GameManager {
    constructor() {
        this.listeners = {};

        const fieldParams = {
            rows: 128,
            cols: 128
        };

        const screenParams = {
            width: 1920,
            height: 1920
        };

        const gridParams = {
            width: 6144,
            height: 6144,

            rows: fieldParams.rows,
            cols: fieldParams.cols,

            gridX: (screenParams.width / 2),
            gridY: (screenParams.height / 2)
        };

        gridParams.cells = {
            width: gridParams.width / gridParams.cols,
            height: gridParams.height / gridParams.rows,
        };

        this.field = new Field(this, fieldParams.rows, fieldParams.cols);
        this.scene = new MainScene(this);
        this.scene.setGridParams(gridParams);
        this.gridParams = gridParams;

        const config = {
            type: Phaser.AUTO,
            width: screenParams.width,
            height: screenParams.height,
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            render: {
                antialias: true,
                roundPixels: true,
            },
            scene: this.scene
        }
        this.game = new Phaser.Game(config);
    }

    // gets cell center position in pixels given a specific row and col
    tileToPixelPosition(row, col) {
        let cellPositions = null;

        if (row >= 0 && row < this.gridParams.rows) {
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
    pixelToTilePosition(pixelX, pixelY) {
        const belowTop = pixelY > this.gridParams.bounds.top;
        const aboveBottom = pixelY < this.gridParams.bounds.bottom;
        const afterLeft = pixelX > this.gridParams.bounds.left;
        const beforeRight = pixelX < this.gridParams.bounds.right;

        let position = null;

        if (belowTop && aboveBottom && afterLeft && beforeRight) {
            const distance = {
                top: pixelY - this.gridParams.bounds.top,
                left: pixelX - this.gridParams.bounds.left
            };

            const row = Math.floor(distance.top / this.gridParams.cells.height);
            const col = Math.floor(distance.left / this.gridParams.cells.width);

            position = { row, col };
        }

        return position;
    }

    trigger(eventName, payload) {
        if (this.listeners[eventName]) {
            this.listeners[eventName].forEach(callback => {
                callback(payload);
            });
        }
    }

    on(eventName, callback) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(callback);
    }

}

