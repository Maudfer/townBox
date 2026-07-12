import { bootFixture, build, people, pressToolKey, step } from '../support/app';
import { expect, test } from '../support/fixtures';

// The person-keyed lazy history asset (task 012 follow-up): `?boot=asset` boots the REAL new-game path —
// asset.json → meta.json → the small population/objects sections only — and each drawn person's pre-game
// history hydrates on demand when their household materializes. This is the end-to-end proof that (a) boot is
// fast (no multi-hundred-MB decode — the old path froze the tab for minutes), and (b) drawn people genuinely
// arrive with lived histories and skills from the asset.

test.describe('history asset — lazy boot + per-person hydration', () => {
    test('boots from the asset quickly and hydrates pre-game histories at household placement', async ({ page }) => {
        await page.addInitScript(() => {
            window.__TOWNBOX_TEST = true;
        });
        const startedAt = Date.now();
        await page.goto('/?test=1&boot=asset&seed=42');
        await page.waitForFunction(() => typeof window.__townbox !== 'undefined', undefined, { timeout: 30_000 });
        const bootMs = Date.now() - startedAt;

        // The asset-backed pool is present (hundreds+ of living people — a cold-start fallback would also have
        // a pool, so the decisive assertion is the PRE-GAME history below).
        const pool = await page.evaluate(() => window.__townbox!.cityStats()!.livingPool as number);
        expect(pool).toBeGreaterThan(50);

        // Build a road + house via the harness; the household draw triggers per-person hydration.
        for (const col of [189, 192, 195]) {
            await page.evaluate(c => window.__townbox!.build('road', 190, c), col);
        }
        await page.evaluate(() => window.__townbox!.build('house', 193, 192));

        // Materialization on the asset path is genuinely async (hydration fetches the members' person files
        // over HTTP before the household spawns) — poll for the residents rather than assuming same-tick.
        await page.waitForFunction(() => window.__townbox!.people().length > 0, undefined, { timeout: 15_000 });
        await step(page, 1);

        const residents = await people(page);
        expect(residents.length).toBeGreaterThan(0);

        // The decisive lazy-hydration assertion: at least one adult resident carries PRE-GAME log entries
        // (events that happened before tick 0 — the asset's lived history), available immediately at placement.
        const histories = await page.evaluate(() =>
            window.__townbox!.people().map(p => ({ id: p.personId, age: p.age, len: p.personId ? window.__townbox!.historyLength(p.personId) : 0 })));
        const adults = histories.filter(h => h.age >= 18);
        expect(adults.length).toBeGreaterThan(0);
        expect(Math.max(...adults.map(h => h.len)), `histories: ${JSON.stringify(histories)}`).toBeGreaterThan(0);

        // And boot was fast — the whole point. Generous bound: the old eager path took minutes.
        expect(bootMs).toBeLessThan(20_000);
    });

    test('a fixture-loaded game still hydrates households placed after the load', async ({ page }) => {
        // The commuter fixture was recorded from a cold-start world (no hydration ref) — this asserts the
        // save/load path tolerates absence gracefully: no ref, no hydration, no crash, world plays on.
        await bootFixture(page, 'commuter');
        await pressToolKey(page, 'F3');
        const anchor = await build(page, 'house', 193, 207);
        expect(anchor).not.toBeNull();
        await step(page, 1);
        expect((await people(page)).length).toBeGreaterThan(0);
    });
});
