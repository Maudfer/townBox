import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page } from '@playwright/test';

import type { PersonInfo, StructureCounts, TileInfo, TownboxTestApi } from './types';

// Shared Playwright helpers for booting and driving the TownBox integration app (task 008). Every boot enables
// test mode (window.__TOWNBOX_TEST) so GameManager pauses the RAF clock and installs the window.__townbox hook;
// specs then advance time explicitly via step(). Keeping all boot/hook plumbing here keeps the specs readable.

export const SAVE_SLOT_KEY = 'townbox:save:autosave';
export const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// Splash-button screen positions (TitleScene draws them centered): Start at cy+80, Load at cy+152.
const START_BUTTON_OFFSET_Y = 80;
const LOAD_BUTTON_OFFSET_Y = 152;

export function fixturePath(name: string): string {
    return join(FIXTURES_DIR, `${name}.txt`);
}

export function readFixture(name: string): string {
    const path = fixturePath(name);
    if (!existsSync(path)) {
        throw new Error(`[integration] Missing fixture "${name}" at ${path}. Generate it with the fixture recorder.`);
    }
    return readFileSync(path, 'utf8').trim();
}

// Registers the test-mode flag so it is set BEFORE the app's own scripts run on the next navigation.
async function enableTestMode(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.__TOWNBOX_TEST = true;
    });
}

// Waits until the harness is installed and the HUD has mounted — the point at which a spec can start asserting.
export async function waitForHarness(page: Page): Promise<void> {
    await page.waitForFunction(() => typeof window.__townbox !== 'undefined', undefined, { timeout: 60_000 });
    // The .hud wrapper is a zero-size overlay (its children are positioned), so anchor readiness on the toolbar,
    // a real visible HUD element that only mounts once the game is initialized.
    await expect(page.getByTestId('toolbar')).toBeVisible();
}

// Boots straight into a fresh game (splash skipped) in test mode. Pass a `seed` to pin the cold-start pool so a
// scenario is reproducible (used by the fixture recorder); omit it for a fast, world-agnostic boot.
export async function bootNewGame(page: Page, seed?: number): Promise<void> {
    await enableTestMode(page);
    const seedParam = seed === undefined ? '' : `&seed=${seed}`;
    await page.goto(`/?test=1&boot=new${seedParam}`);
    await waitForHarness(page);
}

// Boots on the splash screen (no auto-start) so a spec can click the real Start/Load canvas buttons.
export async function bootSplash(page: Page): Promise<void> {
    await enableTestMode(page);
    await page.goto('/?test=1');
    // The canvas exists once Phaser mounts; the harness is NOT installed until a game starts.
    await page.waitForSelector('canvas', { timeout: 60_000 });
}

// Seeds a fixture into the default save slot and stops on the splash — for exercising the real Load Game button.
export async function bootSplashWithSave(page: Page, fixtureName: string): Promise<void> {
    const payload = readFixture(fixtureName);
    await enableTestMode(page);
    await page.addInitScript(([key, data]) => {
        window.localStorage.setItem(key, data);
    }, [SAVE_SLOT_KEY, payload] as const);
    await page.goto('/?test=1');
    await page.waitForSelector('canvas', { timeout: 60_000 });
}

// Seeds a committed fixture into the default save slot and boots straight into it (splash skipped).
export async function bootFixture(page: Page, fixtureName: string): Promise<void> {
    const payload = readFixture(fixtureName);
    await enableTestMode(page);
    await page.addInitScript(([key, data]) => {
        window.localStorage.setItem(key, data);
    }, [SAVE_SLOT_KEY, payload] as const);
    await page.goto('/?test=1&boot=load');
    await waitForHarness(page);
}

// The splash buttons are drawn on the canvas centered on the camera; click relative to the canvas box so any
// offset/letterboxing is accounted for.
// TitleScene fades its buttons in over ~1.3s (700ms delay + 600ms tween) and only becomes interactive once
// create() has run — which happens AFTER the <canvas> element appears. Settle before clicking so the button's
// interactive hit area is live.
const SPLASH_SETTLE_MS = 1600;

async function clickCanvasCenterOffset(page: Page, offsetY: number): Promise<void> {
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) {
        throw new Error('[integration] Canvas has no bounding box');
    }
    await page.waitForTimeout(SPLASH_SETTLE_MS);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + offsetY);
}

// Clicks the splash Start Game button (canvas), then waits for the game to boot.
export async function clickStartButton(page: Page): Promise<void> {
    await clickCanvasCenterOffset(page, START_BUTTON_OFFSET_Y);
    await waitForHarness(page);
}

// Clicks the splash Load Game button (canvas). Caller waits for the harness (only appears if a save existed).
export async function clickLoadButton(page: Page): Promise<void> {
    await clickCanvasCenterOffset(page, LOAD_BUTTON_OFFSET_Y);
}

// Navigates the SAME page (same browser context, so localStorage persists) into a load of the default slot —
// used by the save→load round-trip test after a Ctrl+S wrote the slot.
export async function reloadIntoSavedGame(page: Page): Promise<void> {
    await page.goto('/?test=1&boot=load');
    await waitForHarness(page);
}

// Selects a tool by clicking its toolbar button (real DOM click).
export async function selectTool(page: Page, tool: 'soil' | 'road' | 'house' | 'work' | 'select' | 'bulldoze'): Promise<void> {
    await page.getByTestId(`tool-${tool}`).click();
}

// Presses a tool hotkey (F1–F6 / Escape) and settles. Phaser consumes keydowns on its game loop (throttled
// headless), so a short window ensures the keypress is processed before the caller acts on the result.
export async function pressToolKey(page: Page, key: string): Promise<void> {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
}

// A robust mouse drag for react-rnd (drag/resize): a lone move+down+up, or Playwright's `{steps}` option,
// intermittently fails to start a react-draggable/re-resizable gesture on a slow CI runner. Explicit
// per-increment moves with small settles between the mousedown, each move, and the mouseup make it reliable.
export async function dragMouse(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    const steps = 12;
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.waitForTimeout(60);
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(fromX + (toX - fromX) * (i / steps), fromY + (toY - fromY) * (i / steps));
        await page.waitForTimeout(16);
    }
    await page.waitForTimeout(60);
    await page.mouse.up();
}

// --- window.__townbox delegators (each a single page.evaluate) --------------

export async function step(page: Page, n = 1): Promise<void> {
    await page.evaluate((count) => window.__townbox!.stepTicks(count), n);
}

// Drives `count` movement frames (deterministic; independent of the throttled RAF loop) so on-map travel
// (people walking, cars driving) progresses.
export async function pumpFrames(page: Page, count = 60, deltaMs = 16): Promise<void> {
    await page.evaluate(([c, d]) => window.__townbox!.pumpFrames(c, d), [count, deltaMs] as const);
}

export async function getTick(page: Page): Promise<number> {
    return page.evaluate(() => window.__townbox!.getTick());
}

export async function getDate(page: Page): Promise<string> {
    return page.evaluate(() => window.__townbox!.getDate());
}

export async function structureCounts(page: Page): Promise<StructureCounts> {
    return page.evaluate(() => window.__townbox!.structureCounts());
}

export async function tileAt(page: Page, row: number, col: number): Promise<TileInfo> {
    return page.evaluate(([r, c]) => window.__townbox!.tileAt(r, c), [row, col] as const);
}

export async function people(page: Page): Promise<PersonInfo[]> {
    return page.evaluate(() => window.__townbox!.people());
}

export async function personById(page: Page, personId: string): Promise<PersonInfo | null> {
    return page.evaluate((id) => window.__townbox!.personById(id), personId);
}

export async function cityStats(page: Page): Promise<ReturnType<TownboxTestApi['cityStats']>> {
    return page.evaluate(() => window.__townbox!.cityStats());
}

export async function vehiclesCount(page: Page): Promise<number> {
    return page.evaluate(() => window.__townbox!.vehicles().length);
}

// Centers the camera on a tile and clicks it with a REAL canvas click at the resulting screen point.
export async function clickTile(page: Page, row: number, col: number): Promise<void> {
    const point = await page.evaluate(([r, c]) => window.__townbox!.focusTile(r, c), [row, col] as const);
    if (!point) {
        throw new Error(`[integration] Could not resolve a screen point for tile ${row},${col}`);
    }
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
}

// Anchor identifiers ("row-col") of placed buildings, by kind.
export async function buildings(page: Page): Promise<{ houses: string[]; workplaces: string[] }> {
    return page.evaluate(() => window.__townbox!.buildings());
}

function parseAnchor(anchor: string): [number, number] {
    const [row, col] = anchor.split('-').map(Number);
    return [row as number, col as number];
}

// Selects the Select tool (via Esc — the toolbar's Select button can be behind the feed) and REAL-clicks the
// given building anchor to open its inspector.
export async function selectBuilding(page: Page, anchor: string): Promise<void> {
    await page.keyboard.press('Escape');
    const [row, col] = parseAnchor(anchor);
    await clickTile(page, row, col);
}

// Reads the current world as a save string (for the fixture recorder).
export async function savePayload(page: Page): Promise<string> {
    return page.evaluate(() => window.__townbox!.savePayload());
}

// Deterministic build via the real tileClicked path (awaits async household/business setup). Returns the
// resolved anchor "row-col" or null when the placement was invalid.
export async function build(
    page: Page,
    tool: 'road' | 'soil' | 'house' | 'work',
    row: number,
    col: number,
): Promise<string | null> {
    return page.evaluate(([t, r, c]) => window.__townbox!.build(t as 'road' | 'soil' | 'house' | 'work', r as number, c as number),
        [tool, row, col] as const);
}

export async function bulldoze(page: Page, row: number, col: number): Promise<void> {
    await page.evaluate(([r, c]) => window.__townbox!.bulldoze(r, c), [row, col] as const);
}
