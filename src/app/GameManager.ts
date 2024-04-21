import Phaser from 'phaser';
import Field from 'app/Field';
import MainScene from 'app/MainScene';
import HUDScene from 'app/HUDScene';
import DebugTools from 'app/DebugTools';

import { EventListeners, Handler } from 'types/EventListener';
import { EventPayloads } from 'types/Events';
import { PixelPosition, TilePosition } from 'types/Position';
import { FieldParams, GridParams, ScreenParams } from 'types/Grid';

import config from 'json/config.json';

export default class GameManager {
    private eventListeners: EventListeners = {};
    private hud: HUDScene;

    public scene: MainScene;
    public gridParams: GridParams;

    constructor() {
        const fieldParams: FieldParams = {
            rows: 128,
            cols: 128
        };

        const screenParams: ScreenParams = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        const gridWidth = 6144;
        const gridHeight = 6144;

        const gridParams: GridParams = {
            width: gridWidth,
            height: gridHeight,

            rows: fieldParams.rows,
            cols: fieldParams.cols,

            gridX: screenParams.width / 2,
            gridY: screenParams.height / 2,

            cells: {
                width: gridWidth / fieldParams.cols,
                height: gridHeight / fieldParams.rows,
            },
        };

        this.gridParams = gridParams;
        this.scene = new MainScene(this, { key: 'MainScene', active: true });
        this.hud = new HUDScene(this, { key: 'HUDScene', active: true });

        const phaserConfig: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            scale: {
                mode: Phaser.Scale.RESIZE,
                autoCenter: Phaser.Scale.CENTER_BOTH,
            },
            render: {
                antialias: true,
                roundPixels: true,
            },
            scene: [this.scene, this.hud],
        };

        new Phaser.Game(phaserConfig);
        const debugTools = new DebugTools();

        const postSceneInit = (_: Phaser.Scene) => {
            if (config.debug.masterSwitch) {
                this.on("tileSpawned", { callback: debugTools.drawTileDebugInfo, context: this }) // Huge performance hit, disabled by default
                this.on("roadBuilt", { callback: debugTools.drawRoadCurbs, context: this });
                this.on("roadBuilt", { callback: debugTools.drawRoadLanes, context: this });
            }

            new Field(this, fieldParams.rows, fieldParams.cols);
        }
        this.on("sceneInitialized", {callback: postSceneInit, context: this});
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

    emit<K extends keyof EventPayloads>(eventName: K, payload?: EventPayloads[K]): void {
        if(!payload) {
            payload = {} as EventPayloads[K];
        }
        
        this.eventListeners[eventName]?.forEach(handler => {
            const { callback, context } = handler;
            context ? callback.call(context, payload) : callback(payload);
        });
    }
}