import { expect, test } from '@playwright/test';

import { bootNewGame, getTick, step, structureCounts } from './support/app';

// The baseline sanity check for the whole harness (task 008): the production build boots in test mode, the HUD
// mounts, the window.__townbox hook is installed, and time only advances when the test asks it to.
test.describe('harness smoke', () => {
    test('boots a new game with the HUD and determinism hook', async ({ page }) => {
        await bootNewGame(page);

        // HUD chrome is present.
        await expect(page.getByTestId('hud')).toBeAttached();
        await expect(page.getByTestId('toolbar')).toBeVisible();
        await expect(page.getByTestId('clock-widget')).toBeVisible();
        await expect(page.getByTestId('city-feed')).toBeVisible();

        // The hook is live and reads sane world state.
        const counts = await structureCounts(page);
        expect(counts).toMatchObject({ roads: expect.any(Number), houses: expect.any(Number) });
    });

    test('time is paused until stepTicks is called, then advances deterministically', async ({ page }) => {
        await bootNewGame(page);

        const before = await getTick(page);
        // Give the RAF loop real time; because test mode pauses the clock, the tick must not move on its own.
        await page.waitForTimeout(500);
        expect(await getTick(page)).toBe(before);

        await step(page, 5);
        expect(await getTick(page)).toBe(before + 5);
    });
});
