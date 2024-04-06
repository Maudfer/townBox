import Phaser from 'phaser';
import Field from '@/Field';
import MainScene from '@/MainScene';

import { EventListeners, Handler } from '@/types/EventListener';
import { EventPayloads } from '@/types/Events';
import { PixelPosition, TilePosition } from '@/types/Position';
import { FieldParams, GridParams, ScreenParams } from '@/types/Grid';

export default class GameManager {
    private eventListeners: EventListeners = {};
    private scene: MainScene;
    // private game: Phaser.Game;
    // private field: Field;

    public gridParams: GridParams;

    constructor() {
        const fieldParams: FieldParams = {
            rows: 128,
            cols: 128
        };

        const screenParams: ScreenParams = {
            width: 1920,
            height: 1920
        };

        const gridParams: GridParams = {
            width: 6144,
            height: 6144,

            rows: fieldParams.rows,
            cols: fieldParams.cols,

            gridX: screenParams.width / 2,
            gridY: screenParams.height / 2,

            cells: {
                width: 6144 / fieldParams.cols,
                height: 6144 / fieldParams.rows,
            },
        };

        this.gridParams = gridParams;
        this.scene = new MainScene(this, {});

        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            width: screenParams.width,
            height: screenParams.height,
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH,
            },
            render: {
                antialias: true,
                roundPixels: true,
            },
            scene: this.scene,
        };

        new Phaser.Game(config);

        const initializeField = () => {
            new Field(this, fieldParams.rows, fieldParams.cols);
        }
        this.on("sceneInitialized", {callback: initializeField, context: this});
    }

    tileToPixelPosition(tilePosition: TilePosition): PixelPosition {
        if (tilePosition === null) {
            return null;
        }

        const { row, col } = tilePosition;

        if (row >= 0 && row < this.gridParams.rows) {
            const yEdge = this.gridParams.bounds!.top + (row * this.gridParams.cells.height);
            const yCenter = yEdge + (this.gridParams.cells.height / 2);

            const xEdge = this.gridParams.bounds!.left + (col * this.gridParams.cells.width);
            const xCenter = xEdge + (this.gridParams.cells.width / 2);

            return { x: xCenter, y: yCenter };
        }
        return null;
    }

    pixelToTilePosition(pixelPosition: PixelPosition): TilePosition {
        if (pixelPosition === null) {
            return null;
        }

        const { x: pixelX, y: pixelY } = pixelPosition;
        const { bounds } = this.gridParams;

        if (bounds && pixelY > bounds.top && pixelY < bounds.bottom && pixelX > bounds.left && pixelX < bounds.right) {
            const distance = { top: pixelY - bounds.top, left: pixelX - bounds.left };
            return {
                row: Math.floor(distance.top / this.gridParams.cells.height),
                col: Math.floor(distance.left / this.gridParams.cells.width),
            };
        }
        return null;
    }

    on<K extends keyof EventPayloads>(eventName: K, handler: Handler<EventPayloads[K]>) : void {
        if (!this.eventListeners[eventName]) {
            this.eventListeners[eventName] = [];
        }
        this.eventListeners[eventName].push(handler);
    }

    trigger<K extends keyof EventPayloads>(eventName: K, payload?: EventPayloads[K]): void {
        this.eventListeners[eventName]?.forEach(handler => {
            const { callback, context } = handler;
            context ? callback.call(context, payload) : callback(payload);
        });
    }
}