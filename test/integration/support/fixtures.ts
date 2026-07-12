/* eslint-disable react-hooks/rules-of-hooks -- `use` here is Playwright's fixture callback, not a React hook. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test as base, expect } from '@playwright/test';

// Extended Playwright test that (when COVERAGE=1) captures Chromium V8 JS coverage for each test and writes the
// raw entries to disk, for the coverage reporter to convert + scope to the browser-only surface (scene/HUD
// gap, §7). Gated + wrapped so coverage collection can NEVER fail a test — it is informational.
//
// Every spec imports { test, expect } from here (instead of '@playwright/test') so this runs uniformly.

const COVERAGE = process.env.COVERAGE === '1';
const RAW_DIR = join(process.cwd(), 'coverage-integration', 'raw');

export const test = base.extend({
    page: async ({ page }, use, testInfo) => {
        if (COVERAGE) {
            try {
                await page.coverage.startJSCoverage({ resetOnNavigation: false });
            } catch {
                // Non-Chromium or coverage unavailable — proceed without it.
            }
        }

        await use(page);

        if (COVERAGE) {
            try {
                const entries = await page.coverage.stopJSCoverage();
                mkdirSync(RAW_DIR, { recursive: true });
                const safe = testInfo.testId.replace(/[^a-z0-9]/gi, '_');
                writeFileSync(join(RAW_DIR, `${safe}.json`), JSON.stringify(entries), 'utf8');
            } catch {
                // Ignore — coverage is best-effort.
            }
        }
    },
});

export { expect };
