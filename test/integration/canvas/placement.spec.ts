import { expect, test, type Page } from '@playwright/test';

import { bootNewGame, clickTile, pressToolKey, structureCounts, tileAt } from '../support/app';

// §5 canvas operations, driven by REAL canvas clicks (tool selected via F1–F6, tile centered under the cursor
// by the harness) and asserted through the window.__townbox state hook — never pixel diffs.

const ROAD_ROW = 190;

async function placeRoad(page: Page, row: number, col: number): Promise<void> {
    await pressToolKey(page, 'F2'); // road tool
    await clickTile(page, row, col);
}

test.describe('canvas placement', () => {
    test.beforeEach(async ({ page }) => {
        await bootNewGame(page, 777);
    });

    test('placing a road creates a Road at the snapped anchor', async ({ page }) => {
        expect((await structureCounts(page)).roads).toBe(0);
        await placeRoad(page, ROAD_ROW, 190);
        expect(await tileAt(page, ROAD_ROW, 190)).toMatchObject({ type: 'road' });
        expect((await structureCounts(page)).roads).toBe(1);
    });

    test('adjacent roads auto-tile (the sprite updates for the new neighbour)', async ({ page }) => {
        await placeRoad(page, ROAD_ROW, 190);
        const isolated = (await tileAt(page, ROAD_ROW, 190)).assetName;

        await placeRoad(page, ROAD_ROW, 193); // neighbour to the east
        const connected = (await tileAt(page, ROAD_ROW, 190)).assetName;

        expect((await structureCounts(page)).roads).toBe(2);
        // Auto-tiling re-picks the sprite once a neighbour appears, so the first road's asset must change.
        expect(connected).not.toBe(isolated);
    });

    test('placing a house materialises a household', async ({ page }) => {
        // Road context so the building can soft-snap flush against a road side.
        await placeRoad(page, ROAD_ROW, 190);
        await placeRoad(page, ROAD_ROW, 193);

        await pressToolKey(page, 'F3'); // house tool
        await clickTile(page, 193, 190); // flush below the road
        await page.evaluate(() => window.__townbox!.stepTicks(1));

        const counts = await structureCounts(page);
        expect(counts.houses).toBe(1);
        expect(counts.occupiedHouses).toBe(1);
    });

    test('placing a work building generates a business', async ({ page }) => {
        await placeRoad(page, ROAD_ROW, 190);
        await placeRoad(page, ROAD_ROW, 193);

        await pressToolKey(page, 'F4'); // work tool
        await clickTile(page, 187, 190); // flush above the road
        await page.evaluate(() => window.__townbox!.stepTicks(1));

        const counts = await structureCounts(page);
        expect(counts.workplaces).toBe(1);
        expect(counts.businesses).toBe(1);
    });
});
