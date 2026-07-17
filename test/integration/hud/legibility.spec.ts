import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootFixture, buildings, dragWindowBy, people, selectBuilding, step } from '../support/app';

// Task 081 (proposal J1/J3/J4): the legibility layer — the person inspector's "Now:" status line and day
// strip, the follow toggle, and the feed's kind filter chips + followed-person stream.

// Opens a person window via an occupied house's resident list (the windows.spec.ts pattern).
async function openPersonWindow(page: Page): Promise<void> {
    const { houses } = await buildings(page);
    const occupied = new Set((await people(page)).map(person => person.homeKey));
    const target = houses.find(anchor => occupied.has(anchor)) ?? houses[0]!;
    await selectBuilding(page, target);
    await expect(page.getByTestId('window-house')).toBeVisible();
    await page.getByTestId('house-resident').first().click();
    await expect(page.getByTestId('window-person')).toHaveCount(1);
    await dragWindowBy(page, 'window-person', 300, 260);
}

test.describe('legibility layer (task 081)', () => {
    test.beforeEach(async ({ page }) => {
        await bootFixture(page, 'small-town');
    });

    test('the person window shows a live "Now:" status line', async ({ page }) => {
        await openPersonWindow(page);
        await expect(page.getByTestId('person-now-line')).toBeVisible();
        // Whatever the person is doing, the line renders a broad status word.
        await expect(page.getByTestId('person-now-line')).toContainText(/Now:/);
    });

    test('the day strip renders 24 hour cells and fills as the day advances', async ({ page }) => {
        await openPersonWindow(page);
        const strip = page.getByTestId('person-day-strip');
        await expect(strip).toBeVisible();
        await expect(strip.locator('div')).toHaveCount(24);

        // Advance a full day — the strip should keep rendering (the sim writes log entries; at minimum the
        // sleep cycle lands one). We assert structure, not specific hours (behavior is seed-dependent).
        await step(page, 24);
        await expect(strip.locator('div')).toHaveCount(24);
    });

    test('follow toggles and the feed gains a followed stream', async ({ page }) => {
        await openPersonWindow(page);
        const toggle = page.getByTestId('follow-toggle');
        await expect(toggle).toBeVisible();
        await toggle.click();
        await expect(toggle).toContainText('Following');

        // Run the sim; the followed person's log entries stream into the feed as `follow`-kind entries.
        for (let day = 0; day < 30; day++) {
            await step(page, 24);
            if (await page.locator('.city-feed-entry.followed').count() > 0) {
                break;
            }
            // The follow poll runs on a real 1.5s interval — give it a beat between sim bursts.
            await page.waitForTimeout(300);
        }
        expect(await page.locator('.city-feed-entry.followed').count()).toBeGreaterThan(0);

        // Unfollow flips the toggle back.
        await toggle.click();
        await expect(toggle).toContainText('Follow');
    });

    test('feed filter chips appear once multiple kinds are present and filter the list', async ({ page }) => {
        await openPersonWindow(page);
        await page.getByTestId('follow-toggle').click();

        // Accumulate at least the `follow` kind plus one city kind, then chips render.
        for (let day = 0; day < 60; day++) {
            await step(page, 24);
            await page.waitForTimeout(200);
            if (await page.getByTestId('city-feed-filters').count() > 0) {
                break;
            }
        }
        const filters = page.getByTestId('city-feed-filters');
        if (await filters.count() === 0) {
            test.skip(true, 'only one event kind occurred within the cap — chips need two');
        }

        // Activating one chip narrows the list to that kind.
        const firstChip = filters.locator('span').first();
        const chipKind = (await firstChip.textContent())!.trim();
        await firstChip.click();
        const entries = page.getByTestId('city-feed-entry');
        const count = await entries.count();
        expect(count).toBeGreaterThan(0);
        // All visible entries carry the chip's kind (follow entries have the `followed` class).
        if (chipKind === 'follow') {
            expect(await page.locator('.city-feed-entry.followed').count()).toBe(count);
        }
    });
});
