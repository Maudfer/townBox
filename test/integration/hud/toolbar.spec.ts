import { expect, test, type Page } from '@playwright/test';

import { bootFixture } from '../support/app';

// §4 HUD baseline: the toolbar. Every tool button selects its tool (active highlight) and the F1–F6 / Esc keys
// stay in sync with the buttons — both emit the same `toolSelected` bus event the scene consumes.
const TOOLS = ['soil', 'road', 'house', 'work', 'select', 'bulldoze'] as const;
const KEY_TO_TOOL: Array<[string, string]> = [
    ['F1', 'soil'], ['F2', 'road'], ['F3', 'house'], ['F4', 'work'], ['F5', 'select'], ['F6', 'bulldoze'],
];

async function activeTool(page: Page): Promise<string | null> {
    for (const tool of TOOLS) {
        if ((await page.getByTestId(`tool-${tool}`).getAttribute('data-active')) === 'true') {
            return tool;
        }
    }
    return null;
}

test.describe('toolbar', () => {
    test.beforeEach(async ({ page }) => {
        await bootFixture(page, 'small-town');
        // The city feed overlaps the leftmost (Select) tool button; collapse it so every button is clickable.
        await page.getByTestId('city-feed-header').click();
    });

    test('clicking each tool button activates exactly that tool', async ({ page }) => {
        for (const tool of TOOLS) {
            await page.getByTestId(`tool-${tool}`).click();
            await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('data-active', 'true');
            expect(await activeTool(page)).toBe(tool);
        }
    });

    test('F1–F6 keys select the matching tool and sync the button highlight', async ({ page }) => {
        for (const [key, tool] of KEY_TO_TOOL) {
            await page.keyboard.press(key);
            await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('data-active', 'true');
        }
    });

    test('Esc selects the Select tool', async ({ page }) => {
        await page.getByTestId('tool-road').click();
        await expect(page.getByTestId('tool-road')).toHaveAttribute('data-active', 'true');

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('tool-select')).toHaveAttribute('data-active', 'true');
    });

    test('keyboard and button selection agree on the same tool', async ({ page }) => {
        await page.keyboard.press('F3'); // house
        await expect(page.getByTestId('tool-house')).toHaveAttribute('data-active', 'true');
        await page.getByTestId('tool-work').click();
        await expect(page.getByTestId('tool-work')).toHaveAttribute('data-active', 'true');
        await expect(page.getByTestId('tool-house')).toHaveAttribute('data-active', 'false');
    });
});
