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

// Clicks the splash Start Game button (canvas), then waits for the game to boot.
export async function clickStartButton(page: Page): Promise<void> {
    const size = page.viewportSize();
    const cx = (size?.width ?? 1280) / 2;
    const cy = (size?.height ?? 720) / 2;
    await page.mouse.click(cx, cy + START_BUTTON_OFFSET_Y);
    await waitForHarness(page);
}

// Clicks the splash Load Game button (canvas). Caller waits for the harness (only appears if a save existed).
export async function clickLoadButton(page: Page): Promise<void> {
    const size = page.viewportSize();
    const cx = (size?.width ?? 1280) / 2;
    const cy = (size?.height ?? 720) / 2;
    await page.mouse.click(cx, cy + LOAD_BUTTON_OFFSET_Y);
}

// --- window.__townbox delegators (each a single page.evaluate) --------------

export async function step(page: Page, n = 1): Promise<void> {
    await page.evaluate((count) => window.__townbox!.stepTicks(count), n);
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

// Centers the camera on a tile and clicks it with a REAL canvas click at the resulting screen point.
export async function clickTile(page: Page, row: number, col: number): Promise<void> {
    const point = await page.evaluate(([r, c]) => window.__townbox!.focusTile(r, c), [row, col] as const);
    if (!point) {
        throw new Error(`[integration] Could not resolve a screen point for tile ${row},${col}`);
    }
    await page.mouse.click(point.x, point.y);
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
