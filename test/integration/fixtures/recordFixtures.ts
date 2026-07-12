import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
    FIXTURES_DIR,
    bootNewGame,
    build,
    cityStats,
    fixturePath,
    savePayload,
    step,
} from '../support/app';

// The scenario/fixture generator (task 008, §3, approach b). Run on demand with `npm run generate-scenarios`;
// NOT part of `npm run test:integration`. It drives the real production app to build a small town, lets the sim
// run, and writes committed save-string fixtures under test/integration/fixtures/ using the app's own
// serializer (so every fixture is guaranteed to be a valid, loadable WorldSnapshot). A fixed cold-start seed
// makes the built world reproducible; the committed files are the frozen source of truth the specs load.
//
// Layout (single horizontal road at row 190, buildings flush against it — houses below, workplaces above):
//   roads  : (190, 187 187+3…205)
//   houses : (193, 187) (193, 193) (193, 199) (193, 205)
//   works  : (187, 190) (187, 202)

const SEED = 20260712;
const ROAD_ROW = 190;
const ROAD_COLS = [187, 190, 193, 196, 199, 202, 205];
const HOUSE_ANCHORS: Array<[number, number]> = [[193, 187], [193, 193], [193, 199], [193, 205]];
const WORK_ANCHORS: Array<[number, number]> = [[187, 190], [187, 202]];

async function buildTown(page: import('@playwright/test').Page): Promise<void> {
    for (const col of ROAD_COLS) {
        expect(await build(page, 'road', ROAD_ROW, col), `road at ${ROAD_ROW},${col}`).not.toBeNull();
    }
    for (const [row, col] of HOUSE_ANCHORS) {
        expect(await build(page, 'house', row, col), `house at ${row},${col}`).not.toBeNull();
    }
    for (const [row, col] of WORK_ANCHORS) {
        expect(await build(page, 'work', row, col), `work at ${row},${col}`).not.toBeNull();
    }
}

function writeFixture(name: string, payload: string): void {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(fixturePath(name), `${payload}\n`, 'utf8');
}

test('record small-town + commuter fixtures', async ({ page }) => {
    await bootNewGame(page, SEED);
    await buildTown(page);

    // Let households/businesses settle a day, then freeze the baseline "small-town" fixture.
    await step(page, 24);
    let stats = await cityStats(page);
    expect(stats).not.toBeNull();
    expect(stats!.households).toBeGreaterThanOrEqual(1);
    expect(stats!.businesses).toBeGreaterThanOrEqual(1);
    writeFixture('small-town', await savePayload(page));
    console.log('[fixtures] small-town:', JSON.stringify({ households: stats!.households, businesses: stats!.businesses,
        population: stats!.population }));

    // Keep running until at least one adult is employed (a commute is then possible), capped so a run that never
    // hires still terminates and reports it.
    const MAX_DAYS = 30;
    for (let day = 0; day < MAX_DAYS; day++) {
        stats = await cityStats(page);
        if ((stats?.employedAdults ?? 0) >= 1) {
            break;
        }
        await step(page, 24);
    }
    stats = await cityStats(page);
    console.log('[fixtures] commuter:', JSON.stringify({ employedAdults: stats?.employedAdults,
        unemployedAdults: stats?.unemployedAdults, population: stats?.population }));
    expect(stats!.employedAdults, 'expected at least one hire within the cap').toBeGreaterThanOrEqual(1);
    writeFixture('commuter', await savePayload(page));
});
