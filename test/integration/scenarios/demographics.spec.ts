import { expect, test } from '@playwright/test';

import { bootFixture, cityStats, step } from '../support/app';

// §4.3 scenario: the life-event engine runs over materialised people through the real UI — over time the town
// sees vital events (births/deaths), which the city-overview vital tallies and the feed reflect. This asserts
// the per-tick Engine B cascade is live end to end (not just that the clock advances).

test('the life-event engine produces vital events over time', async ({ page }) => {
    await bootFixture(page, 'commuter');
    const before = (await cityStats(page))!;
    expect(before.births + before.deaths).toBe(0);

    // Step in day chunks until a birth or death occurs, or the cap is hit.
    let vitals = 0;
    for (let day = 0; day < 120 && vitals === 0; day++) {
        await step(page, 24);
        const stats = (await cityStats(page))!;
        vitals = stats.births + stats.deaths;
    }

    const after = (await cityStats(page))!;
    expect(after.births + after.deaths, 'expected at least one birth or death within the cap').toBeGreaterThan(0);
    // A vital event should surface in the city feed too.
    expect(await page.getByTestId('city-feed-entry').count()).toBeGreaterThan(0);
});
