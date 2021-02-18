import Phaser from 'phaser';
import Field from './Field.js';
import MainScene from './MainScene.js';

export default class GameManager {
    constructor() {
        const fieldParams = {
            rows: 20,
            cols: 20
        };

        const grid = {
            width: 900,
            height: 900
        };

        const screen = {
            width: 1000,
            height: 1000
        };
        this.field = new Field(fieldParams.rows, fieldParams.cols);

        // GAME AND SCENE CODE
        this.scene = new MainScene(this.field);
        this.scene.setScreenParams(screen);

        const config = {
            type: Phaser.AUTO,
            width: screen.width,
            height: screen.height,
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            scene: this.scene
        }
        this.game = new Phaser.Game(config);
    
        this.scene.setGridParams(this.field.getRows(), this.field.getCols(), grid.width, grid.height);
    }
}

