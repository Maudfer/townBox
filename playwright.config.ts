import { defineConfig, devices } from '@playwright/test';

// Playwright integration suite config (task 008). Entirely separate from the Jest unit suite: it boots the real
// PRODUCTION build (React HUD + Phaser canvas) and drives it through the deterministic window.__townbox hook
// (see game/TestHarness.ts) so the real-time sim is assertable without wall-clock flakiness.
//
// The webServer builds `./bin` (build-prod + postbuild-prod copies sprites & the history asset) and serves it
// with the zero-dependency static server (scripts/serveIntegration.mjs). Reuse an already-running server locally
// so iterating on a spec doesn't rebuild every run.

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4599);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './test/integration',
    // The sim runs in real time between step-ticks calls; give specs and expectations generous ceilings.
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    // Serial by default: the shared static server + heavy canvas boot make one worker the reliable choice.
    workers: 1,
    reporter: process.env.CI
        ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
        : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        // Build the production bundle, then serve ./bin. Reused across specs; rebuilt only when not already up.
        command: `npm run build-prod && node scripts/serveIntegration.mjs --dir ./bin --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
