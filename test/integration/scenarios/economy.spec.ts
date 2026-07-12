import { expect, test } from '@playwright/test';

import { bootFixture, cityStats, getTick, step } from '../support/app';

// §4.3 scenario: the monthly economic cascade (wages -> cost of living -> demand-driven business P&L) runs
// end-to-end as in-game months pass — money moves through the ledger, so business balances and household
// wealth change over time. (Full bankruptcy/eviction takes many months to guarantee; this asserts the cascade
// is live, which is the load-bearing claim.)

test('the monthly economy cascade moves money over months', async ({ page }) => {
    await bootFixture(page, 'small-town');

    const before = (await cityStats(page))!;
    const startTick = await getTick(page);

    // Advance up to ~3 in-game months in day-sized chunks (a single huge stepTicks call would exceed the test
    // timeout), stopping as soon as a monthly economy tick has moved money.
    let after = before;
    let moved = false;
    const maxDays = 30 * 3;
    for (let day = 0; day < maxDays && !moved; day++) {
        await step(page, 24);
        after = (await cityStats(page))!;
        moved = after.businessBalance !== before.businessBalance || after.householdWealth !== before.householdWealth;
    }

    expect(await getTick(page)).toBeGreaterThan(startTick);
    // The economy ran: money moved somewhere (business P&L and/or wages/cost-of-living).
    expect(moved,
        `expected money to move within 3 months (business ${before.businessBalance}->${after.businessBalance}, household ${before.householdWealth}->${after.householdWealth})`).toBe(true);
});
