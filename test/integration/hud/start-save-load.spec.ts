import { expect, test } from '@playwright/test';

import {
    bootFixture,
    bootNewGame,
    bootSplash,
    bootSplashWithSave,
    build,
    clickLoadButton,
    clickStartButton,
    reloadIntoSavedGame,
    structureCounts,
    waitForHarness,
} from '../support/app';

// §4 HUD baseline: starting a game (Start Game / Load Game / debug-style auto boot), saving (toolbar + Ctrl+S
// with success toast), and a save→load round-trip through the real UI + storage.
test.describe('start / save / load', () => {
    test('Start Game boots a new world into the HUD', async ({ page }) => {
        await bootSplash(page);
        // No HUD/harness on the splash yet.
        expect(await page.getByTestId('toolbar').count()).toBe(0);

        await clickStartButton(page);
        await expect(page.getByTestId('toolbar')).toBeVisible();
        await expect(page.getByTestId('clock-widget')).toBeVisible();
    });

    test('Load Game (splash) restores a seeded save', async ({ page }) => {
        await bootSplashWithSave(page, 'small-town');
        await clickLoadButton(page);
        await waitForHarness(page);

        const counts = await structureCounts(page);
        expect(counts.houses).toBeGreaterThanOrEqual(1);
        expect(counts.businesses).toBeGreaterThanOrEqual(1);
        await expect(page.getByTestId('toast-success').filter({ hasText: /loaded/i })).toBeVisible();
    });

    test('the auto-boot path boots straight into the game with no splash', async ({ page }) => {
        // bootFixture uses ?boot=load — the auto-load path (splash bypassed).
        await bootFixture(page, 'small-town');
        await expect(page.getByTestId('toolbar')).toBeVisible();
        const counts = await structureCounts(page);
        expect(counts.houses).toBeGreaterThanOrEqual(1);
    });

    test('toolbar Save button surfaces a success toast', async ({ page }) => {
        await bootFixture(page, 'small-town');
        await page.getByTestId('tool-save').click();
        await expect(page.getByTestId('toast-success').filter({ hasText: /saved/i })).toBeVisible();
    });

    test('Ctrl+S saves and surfaces a success toast', async ({ page }) => {
        await bootFixture(page, 'small-town');
        await page.keyboard.press('Control+s');
        await expect(page.getByTestId('toast-success').filter({ hasText: /saved/i })).toBeVisible();
    });

    test('save → reload → load round-trips the built world', async ({ page }) => {
        // Fresh (unseeded) game so the default slot is empty until we Ctrl+S into it.
        await bootNewGame(page, 4242);
        for (const col of [190, 193, 196]) {
            await build(page, 'road', 190, col);
        }
        await build(page, 'house', 193, 193);
        const before = await structureCounts(page);
        expect(before.houses).toBe(1);
        expect(before.roads).toBe(3);

        await page.keyboard.press('Control+s');
        await expect(page.getByTestId('toast-success').filter({ hasText: /saved/i })).toBeVisible();

        // Reload the same context (localStorage persists) into a load of what we just saved.
        await reloadIntoSavedGame(page);
        const after = await structureCounts(page);
        expect(after.houses).toBe(before.houses);
        expect(after.roads).toBe(before.roads);
        expect(after.occupiedHouses).toBe(before.occupiedHouses);
    });
});
