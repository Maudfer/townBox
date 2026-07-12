import type { Page } from '@playwright/test';

import { bootFixture, people, personById, pumpFrames, step, vehiclesCount } from '../support/app';
import { expect, test } from '../support/fixtures';

// §5 canvas operations: on-map movement + the commute, asserted end to end through the state hook. Each sim
// tick is followed by a batch of pumped movement frames (`pumpFrames` drives the same `update` events the RAF
// loop does, deterministically), so travel progresses at a controlled pace instead of wall-clock RAF pace.
//
// These tests are the regression guard for the commute-freezing bugs this suite originally surfaced: A* could
// not path OUT of a building footprint (so walk-to-car stalled), commute cars could not drive off a Building
// tile (so Driving stalled), and a walk whose destination is the structure underfoot never detected arrival
// (so the final leg stalled). See test/agents/{pathFinder,vehicle,person}.test.ts for the unit-level guards.

const MAX_TICKS = 60;
const FRAMES_PER_TICK = 600;

interface CommuteResult {
    arrivedWorkTick: number;
    backHomeTick: number;
    workKey: string | null;
    sawDriving: boolean;
    sawVehicle: boolean;
    // Task 008 commute spec: while the person rides, their sprite is hidden (vanished into the car).
    sawSpriteVanishWhileDriving: boolean;
}

// Steps the sim tick-by-tick (with movement frames) until the employed person completes a full round trip,
// recording the milestones along the way.
async function driveCommute(page: Page, personId: string, homeKey: string): Promise<CommuteResult> {
    const result: CommuteResult = {
        arrivedWorkTick: -1, backHomeTick: -1, workKey: null, sawDriving: false, sawVehicle: false,
        sawSpriteVanishWhileDriving: false,
    };
    for (let tick = 0; tick < MAX_TICKS; tick++) {
        await step(page, 1);
        // Pump the tick's movement frames in small chunks, sampling between them — the whole drive can
        // complete within a single large pump (the car covers the town in a few hundred frames), so a
        // once-per-tick sample would never observe the transient `driving` state.
        let person = (await personById(page, personId))!;
        for (let chunk = 0; chunk < 8; chunk++) {
            await pumpFrames(page, FRAMES_PER_TICK / 8, 16);
            person = (await personById(page, personId))!;
            if (person.travelStep === 'driving') {
                result.sawDriving = true;
                if (person.indoors) {
                    result.sawSpriteVanishWhileDriving = true;
                }
            }
            if (!result.sawVehicle && await vehiclesCount(page) > 0) {
                result.sawVehicle = true;
            }
        }
        if (result.arrivedWorkTick < 0 && person.currentBuilding && person.currentBuilding !== homeKey) {
            result.arrivedWorkTick = tick;
            result.workKey = person.currentBuilding;
        }
        if (result.arrivedWorkTick >= 0 && person.currentBuilding === homeKey) {
            result.backHomeTick = tick;
            break;
        }
    }
    return result;
}

test.describe('movement & commute', () => {
    test('an employed resident commutes to work and back home (full round trip)', async ({ page }) => {
        await bootFixture(page, 'commuter');
        const employed = (await people(page)).find(p => p.jobTitle);
        expect(employed, 'commuter fixture should have an employed adult').toBeTruthy();

        const result = await driveCommute(page, employed!.personId!, employed!.homeKey!);

        // Out: the person reached their workplace (currentBuilding flipped to a non-home building).
        expect(result.arrivedWorkTick, 'expected arrival at work within the cap').toBeGreaterThanOrEqual(0);
        expect(result.workKey).not.toBe(employed!.homeKey);
        // The trip genuinely used the car commute (travel state machine passed through Driving; a vehicle existed).
        expect(result.sawDriving).toBe(true);
        expect(result.sawVehicle).toBe(true);
        // Task 008 commute spec: the person's sprite vanished into the car while riding.
        expect(result.sawSpriteVanishWhileDriving).toBe(true);
        // And back: after the shift the person returned home.
        expect(result.backHomeTick, 'expected the return trip within the cap').toBeGreaterThan(result.arrivedWorkTick);
    });

    test('the commuter physically moves across the map during the trip', async ({ page }) => {
        await bootFixture(page, 'commuter');
        const employed = (await people(page)).find(p => p.jobTitle)!;
        const startX = employed.x;
        const startY = employed.y;

        // Step until arrival at work, then compare positions: the person now stands at the WORKPLACE entrance,
        // far from where they started (positions are real, not teleport bookkeeping).
        for (let tick = 0; tick < MAX_TICKS; tick++) {
            await step(page, 1);
            await pumpFrames(page, FRAMES_PER_TICK, 16);
            const person = (await personById(page, employed.personId!))!;
            if (person.currentBuilding && person.currentBuilding !== employed.homeKey) {
                const distance = Math.hypot(person.x - startX, person.y - startY);
                expect(distance).toBeGreaterThan(48); // moved at least a footprint away
                return;
            }
        }
        throw new Error('commuter never arrived at work within the cap');
    });
});
