import Phaser from 'phaser';
import Field from 'game/Field';
import MainScene from 'game/MainScene';
import DebugTools from 'game/DebugTools';

import { EventListeners, Handler } from 'types/EventListener';
import { EventPayloads } from 'types/Events';
import { PixelPosition, TilePosition } from 'types/Position';
import { FieldParams, GridParams, ScreenParams } from 'types/Grid';
import { Toolbelt } from 'types/Cursor';

import config from 'json/config.json';
import tools from 'json/toolbelt.json';
import City from './City';

export default class GameManager {
    private eventListeners: EventListeners = {};

    public scene: MainScene;
    public field: Field | null;
    public city: City | null;

    public gridParams: GridParams;
    public toolbelt: Toolbelt;

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
        this.toolbelt = tools;

        this.scene = new MainScene(this, { key: 'MainScene', active: true });
        this.field = null; 
        this.city = null;

        const phaserConfig: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            scale: {
                mode: Phaser.Scale.RESIZE,
                autoCenter: Phaser.Scale.CENTER_BOTH,
            },
            render: {
                antialias: true,
                roundPixels: false,
            },
            backgroundColor: '#427328',
            scene: [this.scene],
        };

        new Phaser.Game(phaserConfig);
        const debugTools = new DebugTools();

        const postSceneInit = (_: Phaser.Scene) => {
            if (config.debug.masterSwitch) {
                this.on("tileSpawned", { callback: debugTools.drawTileDebugInfo, context: this }) // Huge performance hit, disabled by default
                this.on("roadBuilt", { callback: debugTools.drawRoadCurbs, context: this });
                this.on("roadBuilt", { callback: debugTools.drawRoadLanes, context: this });
            }

            this.field = new Field(this, fieldParams.rows, fieldParams.cols);
            this.city = new City(this);
            this.emit("gameInitialized", this);
        }
        this.on("sceneInitialized", { callback: postSceneInit, context: this });
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

    on<K extends keyof EventPayloads>(eventName: K, handler: Handler<EventPayloads[K]>): void {
        if (!this.eventListeners[eventName]) {
            this.eventListeners[eventName] = [];
        }
        this.eventListeners[eventName].push(handler);
    }

    async emit<K extends keyof EventPayloads>(eventName: K, payload?: EventPayloads[K]): Promise<any[]> {
        if (!payload) {
            payload = {} as EventPayloads[K];
        }

        const handlers = this.eventListeners[eventName] || [];
        const results = await Promise.all(handlers.map(async (handler) => {
            const { callback, context } = handler;
            return context ? callback.call(context, payload) : callback(payload);
        }));

        return results;
    }

    async emitSingle<K extends keyof EventPayloads>(eventName: K, payload?: EventPayloads[K]): Promise<any> {
        if (!payload) {
            payload = {} as EventPayloads[K];
        }

        const handlers = this.eventListeners[eventName] || [];
        if (handlers.length > 1) {
            throw new Error(`Multiple handlers registered for event: ${eventName}`);
        }

        if (handlers.length === 0) {
            throw new Error(`No handlers registered for event: ${eventName}`);
        }

        const handler = handlers[0];
        if (!handler) {
            throw new Error(`Invalid handler for event: ${eventName}`);
        }

        const { callback, context } = handler;
        const result = await context ? callback.call(context, payload) : callback(payload);

        return result;
    }
}