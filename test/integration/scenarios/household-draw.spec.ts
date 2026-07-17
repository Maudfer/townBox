import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootNewGame, buildings, cityStats, clickTile, people, placeViaConstruction, pressToolKey, selectBuilding, structureCounts } from '../support/app';

// §4.3 scenario: placing a house draws a coherent household from the genealogy pool and materialises its living
// members, whose family tree renders in the inspector.
const ROAD_ROW = 190;

async function placeRoad(page: Page, col: number): Promise<void> {
    await pressToolKey(page, 'F2');
    await clickTile(page, ROAD_ROW, col);
}

test('placing a house materialises a household whose family tree renders', async ({ page }) => {
    await bootNewGame(page, 31337);
    await placeRoad(page, 190);
    await placeRoad(page, 193);

    await placeViaConstruction(page, 'house', 193, 190); // Residence via the construction menu (task 108)
    await page.evaluate(() => window.__townbox!.stepTicks(1));

    // A coherent household of living members materialised.
    expect((await structureCounts(page)).occupiedHouses).toBe(1);
    const residents = await people(page);
    expect(residents.length).toBeGreaterThan(0);
    expect((await cityStats(page))!.households).toBe(1);

    // The family tree renders in the inspector (d3 draws named nodes — the household + its ancestors).
    const { houses } = await buildings(page);
    await selectBuilding(page, houses[0]!);
    await expect(page.getByTestId('window-house')).toBeVisible();
    await expect(page.getByTestId('house-resident').first()).toBeVisible();
    await expect(page.locator('#family-tree text').first()).toBeVisible();
    expect(await page.locator('#family-tree text').count()).toBeGreaterThan(0);
});
