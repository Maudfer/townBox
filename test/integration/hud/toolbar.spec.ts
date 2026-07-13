import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

import { bootFixture, pressToolKey } from '../support/app';

// §4 HUD baseline: the consolidated toolbar (task 108). Four tools — Select, Road, Construction, Bulldoze —
// each selectable by its button (active highlight) and by F1–F4 / Esc, both emitting the same `toolSelected`
// bus event the scene consumes. (House/Work/Soil are gone: Construction opens the building menu.)
const TOOLS = ['select', 'road', 'construction', 'bulldoze'] as const;
// Construction opens a menu window on click, so click it LAST in the sweep — nothing needs clicking after it.
const CLICK_ORDER = ['select', 'road', 'bulldoze', 'construction'] as const;
const KEY_TO_TOOL: Array<[string, string]> = [
    ['F1', 'select'], ['F2', 'road'], ['F3', 'construction'], ['F4', 'bulldoze'],
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
        for (const tool of CLICK_ORDER) {
            await page.getByTestId(`tool-${tool}`).click();
            await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('data-active', 'true');
            expect(await activeTool(page)).toBe(tool);
        }
    });

    test('F1–F4 keys select the matching tool and sync the button highlight', async ({ page }) => {
        for (const [key, tool] of KEY_TO_TOOL) {
            // pressToolKey settles: Phaser consumes keydowns on its (headless-throttled) game loop, so a window
            // lets each keypress be processed before we assert / press the next key. Keyboard presses reach the
            // document, so the Construction menu opening after F3 doesn't block the following key.
            await pressToolKey(page, key);
            await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('data-active', 'true');
        }
    });

    test('Esc selects the Select tool', async ({ page }) => {
        await page.getByTestId('tool-road').click();
        await expect(page.getByTestId('tool-road')).toHaveAttribute('data-active', 'true');

        await pressToolKey(page, 'Escape');
        await expect(page.getByTestId('tool-select')).toHaveAttribute('data-active', 'true');
    });

    test('keyboard and button selection agree on the same tool', async ({ page }) => {
        await pressToolKey(page, 'F2'); // road
        await expect(page.getByTestId('tool-road')).toHaveAttribute('data-active', 'true');
        await page.getByTestId('tool-bulldoze').click();
        await expect(page.getByTestId('tool-bulldoze')).toHaveAttribute('data-active', 'true');
        await expect(page.getByTestId('tool-road')).toHaveAttribute('data-active', 'false');
    });
});
