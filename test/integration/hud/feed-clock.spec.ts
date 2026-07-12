import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootFixture, getDate, step } from '../support/app';

// §4 HUD baseline: the city event feed updates as the sim runs (and entries are clickable / the panel
// collapses), and the clock widget advances as time ticks.

// Steps the sim in day-sized chunks until the feed gains at least one entry, or the cap is hit.
async function advanceUntilFeedEntry(page: Page, maxDays = 90): Promise<number> {
    for (let day = 0; day < maxDays; day++) {
        await step(page, 24);
        if (await page.getByTestId('city-feed-entry').count() > 0) {
            return await page.getByTestId('city-feed-entry').count();
        }
    }
    return 0;
}

test.describe('event feed + clock', () => {
    test('the feed gains entries as the simulation runs', async ({ page }) => {
        await bootFixture(page, 'commuter');
        await expect(page.getByTestId('city-feed-entry')).toHaveCount(0);

        const entries = await advanceUntilFeedEntry(page);
        expect(entries, 'expected the feed to gain a notable event within the cap').toBeGreaterThan(0);
    });

    test('clicking a feed entry opens the subject inspector', async ({ page }) => {
        await bootFixture(page, 'commuter');
        const found = await advanceUntilFeedEntry(page);
        expect(found).toBeGreaterThan(0);

        // Click a clickable entry (one with a subject person).
        const clickable = page.locator('.city-feed-entry.clickable').first();
        await expect(clickable).toBeVisible();
        await clickable.click();
        await expect(page.getByTestId('window-person')).toHaveCount(1);
    });

    test('the feed collapses and expands', async ({ page }) => {
        await bootFixture(page, 'small-town');
        await expect(page.getByTestId('city-feed-list')).toBeVisible();
        await page.getByTestId('city-feed-header').click();
        await expect(page.getByTestId('city-feed-list')).toHaveCount(0);
        await page.getByTestId('city-feed-header').click();
        await expect(page.getByTestId('city-feed-list')).toBeVisible();
    });

    test('the clock advances as time ticks', async ({ page }) => {
        await bootFixture(page, 'small-town');
        const before = await getDate(page);
        await expect(page.getByTestId('clock-widget')).toContainText(/Year/);

        await step(page, 30); // > 1 in-game day
        const after = await getDate(page);
        expect(after).not.toBe(before);
        // The rendered widget reflects the new date too (updates via the timeChanged signal).
        await expect(page.getByTestId('clock-widget')).not.toContainText(before);
    });
});
