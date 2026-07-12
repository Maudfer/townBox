import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootFixture, buildings, dragWindowBy, people, resizeWindowSE, selectBuilding } from '../support/app';

// §4 HUD baseline: inspector windows opened via the Select tool (house / workplace / person / city overview),
// plus window move / resize / close and the singleton vs per-identity window rules.

// Opens the household window for a house that actually has residents (so its clickable resident list renders).
async function openHouseWindow(page: Page): Promise<void> {
    const { houses } = await buildings(page);
    expect(houses.length).toBeGreaterThan(0);
    const occupied = new Set((await people(page)).map(person => person.homeKey));
    const target = houses.find(anchor => occupied.has(anchor)) ?? houses[0]!;
    await selectBuilding(page, target);
    await expect(page.getByTestId('window-house')).toBeVisible();
}

test.describe('inspector windows', () => {
    test.beforeEach(async ({ page }) => {
        await bootFixture(page, 'small-town');
    });

    test('selecting a house opens the household window', async ({ page }) => {
        await openHouseWindow(page);
        await expect(page.getByTestId('window-house')).toBeVisible();
    });

    test('selecting a workplace opens the business window', async ({ page }) => {
        const { workplaces } = await buildings(page);
        expect(workplaces.length).toBeGreaterThan(0);
        await selectBuilding(page, workplaces[0]!);
        await expect(page.getByTestId('window-workplace')).toBeVisible();
    });

    test('clicking the clock opens the city overview (singleton)', async ({ page }) => {
        await page.getByTestId('clock-widget').click();
        await expect(page.getByTestId('window-city')).toBeVisible();
        // Clicking again must not open a second overview (replaceType singleton).
        await page.getByTestId('clock-widget').click();
        await expect(page.getByTestId('window-city')).toHaveCount(1);
    });

    test('opening a resident opens a person window, deduped by identity', async ({ page }) => {
        await openHouseWindow(page);
        await page.getByTestId('house-resident').first().click();
        await expect(page.getByTestId('window-person')).toHaveCount(1);

        // The person window opens over the resident list; drag it aside (retry-until-moved) so the same
        // resident is clickable again.
        await dragWindowBy(page, 'window-person', 300, 260);

        // Re-opening the same resident must not add a duplicate window (dedupe by identity).
        await page.getByTestId('house-resident').first().click();
        await expect(page.getByTestId('window-person')).toHaveCount(1);
    });

    test('a window can be moved by dragging its header', async ({ page }) => {
        await openHouseWindow(page);
        const { before, after } = await dragWindowBy(page, 'window-house', 140, 90);
        expect(Math.abs(after.x - before.x)).toBeGreaterThan(80);
        expect(Math.abs(after.y - before.y)).toBeGreaterThan(50);
    });

    test('a window can be resized from its corner handle', async ({ page }) => {
        // Use the city overview window: unlike the household window (whose family-tree SVG overflows and covers
        // the corner handle), its content stays inside the frame so the SE resize handle is grabbable.
        await page.getByTestId('clock-widget').click();
        await expect(page.getByTestId('window-city')).toBeVisible();

        // Drag the SE handle outward, retry-until-resized (re-resizable can silently fail to start on a slow
        // runner). The handle is a sibling of .window in the Rnd wrapper; the helper locates it page-level.
        const { before, after } = await resizeWindowSE(page, 'window-city', 170, 130);
        expect(after.width).toBeGreaterThan(before.width + 40);
        expect(after.height).toBeGreaterThan(before.height + 40);
    });

    test('a window closes via its close button', async ({ page }) => {
        await openHouseWindow(page);
        await page.getByTestId('window-house').getByTestId('window-close').click();
        await expect(page.getByTestId('window-house')).toHaveCount(0);
    });
});
