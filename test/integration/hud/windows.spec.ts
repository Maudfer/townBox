import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootFixture, buildings, people, selectBuilding } from '../support/app';

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

        // The person window opens over the resident list; drag it aside so the same resident can be re-clicked.
        // Grab the header's RIGHT side — its left edge overlaps the clock widget (z-index 1000), and the far
        // right is the close button; a point just left of the close button is clear of both.
        const personHeader = page.getByTestId('window-person').locator('.window-header');
        const ph = (await personHeader.boundingBox())!;
        const grabX = ph.x + ph.width - 55;
        const grabY = ph.y + ph.height / 2;
        await page.mouse.move(grabX, grabY);
        await page.mouse.down();
        await page.mouse.move(grabX + 300, grabY + 260, { steps: 8 });
        await page.mouse.up();

        // Re-opening the same resident must not add a duplicate window (dedupe by identity).
        await page.getByTestId('house-resident').first().click();
        await expect(page.getByTestId('window-person')).toHaveCount(1);
    });

    test('a window can be moved by dragging its header', async ({ page }) => {
        await openHouseWindow(page);
        const windowEl = page.getByTestId('window-house');
        const before = (await windowEl.boundingBox())!;

        const header = windowEl.locator('.window-header');
        const hb = (await header.boundingBox())!;
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x + hb.width / 2 + 140, hb.y + hb.height / 2 + 90, { steps: 8 });
        await page.mouse.up();

        const after = (await windowEl.boundingBox())!;
        expect(Math.abs(after.x - before.x)).toBeGreaterThan(80);
        expect(Math.abs(after.y - before.y)).toBeGreaterThan(50);
    });

    test('a window can be resized from its corner handle', async ({ page }) => {
        // Use the city overview window: unlike the household window (whose family-tree SVG overflows and covers
        // the corner handle), its content stays inside the frame so the SE resize handle is grabbable.
        await page.getByTestId('clock-widget').click();
        const windowEl = page.getByTestId('window-city');
        await expect(windowEl).toBeVisible();
        const before = (await windowEl.boundingBox())!;

        // Drag the south-east resize handle (react-rnd) outward via its stable class hook. The handle is a
        // sibling of .window inside the Rnd wrapper, so locate it at the page level (only one window is open).
        const handle = page.locator('.window-resize-se');
        const hb = (await handle.boundingBox())!;
        const grabX = hb.x + hb.width / 2;
        const grabY = hb.y + hb.height / 2;
        await page.mouse.move(grabX, grabY);
        await page.mouse.down();
        await page.mouse.move(grabX + 40, grabY + 30, { steps: 4 });
        await page.mouse.move(grabX + 170, grabY + 130, { steps: 10 });
        await page.mouse.up();

        const after = (await windowEl.boundingBox())!;
        expect(after.width).toBeGreaterThan(before.width + 40);
        expect(after.height).toBeGreaterThan(before.height + 40);
    });

    test('a window closes via its close button', async ({ page }) => {
        await openHouseWindow(page);
        await page.getByTestId('window-house').getByTestId('window-close').click();
        await expect(page.getByTestId('window-house')).toHaveCount(0);
    });
});
