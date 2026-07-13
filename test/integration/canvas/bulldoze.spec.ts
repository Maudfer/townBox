import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootNewGame, cityStats, clickTile, people, placeViaConstruction, pressToolKey, structureCounts, tileAt } from '../support/app';

// §5 canvas operations: bulldozing a built tile tears it down coherently (the structure is removed; an occupied
// building's residents/business are cleared), driven by a real canvas click of the bulldozer tool.

const ROAD_ROW = 190;

async function placeRoads(page: Page): Promise<void> {
    await pressToolKey(page, 'F2');
    await clickTile(page, ROAD_ROW, 190);
    await clickTile(page, ROAD_ROW, 193);
}

test.describe('canvas bulldoze', () => {
    test.beforeEach(async ({ page }) => {
        await bootNewGame(page, 555);
        await placeRoads(page);
    });

    test('bulldozing a house removes it and clears its residents', async ({ page }) => {
        await placeViaConstruction(page, 'house', 193, 190); // Residence via the construction menu (task 108)
        await page.evaluate(() => window.__townbox!.stepTicks(1));
        expect((await structureCounts(page)).occupiedHouses).toBe(1);
        const residentsBefore = (await people(page)).length;
        expect(residentsBefore).toBeGreaterThan(0);

        await pressToolKey(page, 'F4'); // bulldoze
        await clickTile(page, 193, 190);
        await page.evaluate(() => window.__townbox!.stepTicks(1));

        expect((await tileAt(page, 193, 190)).type).not.toBe('house');
        const counts = await structureCounts(page);
        expect(counts.houses).toBe(0);
        expect(counts.occupiedHouses).toBe(0);
        // Coherent teardown: the resident is evicted, not stranded — with no relative's home to take them in
        // (this scenario has none), they enter the homeless registry rather than vanishing silently.
        expect(residentsBefore).toBeGreaterThan(0);
        expect((await cityStats(page))!.homelessPeople as number).toBeGreaterThan(0);
    });

    test('bulldozing a workplace closes its business', async ({ page }) => {
        await placeViaConstruction(page, 'business', 187, 190); // generic work lot via the construction menu
        await page.evaluate(() => window.__townbox!.stepTicks(1));
        expect((await structureCounts(page)).businesses).toBe(1);

        await pressToolKey(page, 'F4'); // bulldoze
        await clickTile(page, 187, 190);
        await page.evaluate(() => window.__townbox!.stepTicks(1));

        expect((await tileAt(page, 187, 190)).type).not.toBe('work');
        expect((await structureCounts(page)).businesses).toBe(0);
    });
});
