import Phaser from 'phaser';
import Field from './Field.js';
import MainScene from './MainScene.js';

export default class GameManager {
    constructor() {
        const fieldParams = {
            rows: 128,
            cols: 128
        };

        const gridParams = {
            width: 6144,
            height: 6144
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
            render: {
                antialias: true,
                roundPixels: true,
            },
            scene: this.scene
        }
        this.game = new Phaser.Game(config);

    }
}

