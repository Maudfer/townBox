import Phaser from 'phaser';
import Field from './Field.js';
import MainScene from './MainScene.js';

export default class GameManager {
    constructor() {
        const fieldParams = {
            rows: 60,
            cols: 60
        };

        const gridParams = {
            width: 2880,
            height: 2880
        };

        const screenParams = {
            width: 1920,
            height: 1920
        };

        this.field = new Field(fieldParams.rows, fieldParams.cols);

        // GAME AND SCENE CODE
        this.scene = new MainScene(this.field);
        this.scene.setScreenParams(screenParams.width, screenParams.height);
        this.scene.setGridParams(this.field.getRows(), this.field.getCols(), gridParams.width, gridParams.height);

        const config = {
            type: Phaser.AUTO,
            width: screenParams.width,
            height: screenParams.height,
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            scene: this.scene
        }
        this.game = new Phaser.Game(config);
    
    }
}

