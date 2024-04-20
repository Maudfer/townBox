import GameManager from 'app/GameManager';
import Tile from 'app/Tile';
import Road from 'app/Road';

import config from 'json/config.json';

export default class DebugTools {
    constructor() { }

    drawRoadCurbs(tile: Tile) {
        if (!config.debug.drawCurbs) {
            return;
        }

        if (!(tile instanceof Road)) {
            return;
        }

        const curb = tile.getCurb();
        if (!curb) {
            return;
        }

        const gameManagerObject = this as unknown;
        const gameManager = gameManagerObject as GameManager;
        const scene = gameManager.scene;

        const curbArray = Object.values(curb);
        curbArray.forEach((curbPoint) => {
            if (!curbPoint) {
                return;
            }
            const rect = scene.add.rectangle(curbPoint.x, curbPoint.y, 1, 1, 0xff0000);
            rect.setDepth(9000);
            rect.setOrigin(0.5, 0.5);
        });
    }

    drawRoadLanes(tile: Tile) {
        if (!config.debug.drawLanes) {
            return;
        }

        if (!(tile instanceof Road)) {
            return;
        }

        const lane = tile.getLane();
        if (!lane) {
            return;
        }

        const gameManagerObject = this as unknown;
        const gameManager = gameManagerObject as GameManager;
        const scene = gameManager.scene;

        const laneArray = Object.values(lane);
        laneArray.forEach((lanePoint) => {
            if (!lanePoint) {
                return;
            }
            const rect = scene.add.rectangle(lanePoint.x, lanePoint.y, 1, 1, 0x00ff00);
            rect.setDepth(9000);
            rect.setOrigin(0.5, 0.5);
        });
    }

    drawTileDebugInfo(tile: Tile): void {
        if (!config.debug.drawTileDepth) {
            return;
        }

        const tilePosition = tile.getPosition();
        if (!tilePosition) {
            return;
        }

        const gameManagerObject = this as unknown;
        const gameManager = gameManagerObject as GameManager;
        const scene = gameManager.scene;

        const pixelCenter = gameManager.tileToPixelPosition(tilePosition);
        if (!pixelCenter) {
            return;
        }

        const style = {
            fontSize: "10px",
            fontFamily: "Arial",
            color: "#ffffff",
        };

        const text = scene.add.text(pixelCenter.x, pixelCenter.y, `${tile.getRow()}-${tile.getCol()}`, style);
        text.setOrigin(0.5, 0.5);
        text.setDepth(10000);

        tile.setDebugText(text);
    }
}