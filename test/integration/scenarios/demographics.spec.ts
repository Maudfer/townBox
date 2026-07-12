import { bootFixture } from '../support/app';
import { expect, test } from '../support/fixtures';

// §4.3 scenario: the life-event engine (Engine B) + Action system run over the materialized population through
// the real UI, per tick, end to end — materialized people accumulate life-log entries and notable happenings
// surface in the city feed. (We assert this via the frequent, reliable log/feed signals rather than a specific
// birth or death: those are demographically rare — ~59 in-game days out for this fixture — so gating on them
// would be slow and CI-fragile. The feed entries this asserts include vital/social events.)

test('the simulation commits life-log activity and surfaces events as it runs', async ({ page }) => {
    await bootFixture(page, 'commuter');
    const personId = await page.evaluate(() => window.__townbox!.people().find(p => p.personId)?.personId ?? null);
    expect(personId, 'the fixture should have a materialized person').toBeTruthy();

    const before = await page.evaluate((id) => window.__townbox!.historyLength(id!), personId);
    await expect(page.getByTestId('city-feed-entry')).toHaveCount(0);

    // A single day of ticks is enough for the per-tick spine (Brain → Actions → Engine B) to commit entries to
    // the shared life log.
    await page.evaluate(() => window.__townbox!.stepTicks(24));
    const after = await page.evaluate((id) => window.__townbox!.historyLength(id!), personId);
    expect(after, 'the shared life log should accumulate entries as the sim ticks').toBeGreaterThan(before);

    // And notable happenings surface in the city feed within a short window (step in day chunks, break early).
    let feedEntries = 0;
    for (let day = 0; day < 40 && feedEntries === 0; day++) {
        await page.evaluate(() => window.__townbox!.stepTicks(24));
        feedEntries = await page.getByTestId('city-feed-entry').count();
    }
    expect(feedEntries, 'expected the city feed to surface a life event within the window').toBeGreaterThan(0);
});
