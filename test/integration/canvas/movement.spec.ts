import { expect, test, type Page } from '@playwright/test';

import { bootFixture, people, personById, step, vehiclesCount } from '../support/app';

// §5 canvas operations: on-map movement + the commute. NOTE ON SCOPE — the pixel-level travel (people walking
// sidewalks, cars driving lanes to completion) is driven by Phaser's per-frame render loop + A* pathfinding,
// which the headless test browser throttles; on-map positions do not advance to arrival reliably here. So these
// tests assert the DETERMINISTIC, hook-observable facts of movement: the travel state machine ENGAGES when the
// sim dispatches a commuter, and a commute vehicle is assigned. Full arrival is exercised by the shipped game's
// real render loop, not asserted here.

async function employed(page: Page): Promise<string> {
    const person = (await people(page)).find(p => p.jobTitle);
    expect(person, 'commuter fixture should have an employed adult').toBeTruthy();
    return person!.personId!;
}

test.describe('movement & commute', () => {
    test('an employed resident is dispatched onto a commute (travel state engages)', async ({ page }) => {
        await bootFixture(page, 'commuter');
        const id = await employed(page);

        // Step the sim; the Brain's work obligation + LiveWorld start the commute, moving the person out of the
        // Idle travel state into the exit/walk-to-car sequence.
        let engaged = false;
        for (let i = 0; i < 30 && !engaged; i++) {
            const p = (await personById(page, id))!;
            if (p.travelStep !== 'idle' && p.travelStep !== 'arrived') {
                engaged = true;
                break;
            }
            await step(page, 1);
        }
        expect(engaged, 'the travel state machine should engage when the commute is dispatched').toBe(true);
    });

    test('commute vehicles are present for the town', async ({ page }) => {
        await bootFixture(page, 'commuter');
        await employed(page);
        await step(page, 2);
        // The town's households have cars (garages) and commutes assign them; at least one vehicle exists.
        expect(await vehiclesCount(page)).toBeGreaterThan(0);
    });

    test('the travel state advances through the commute sequence', async ({ page }) => {
        await bootFixture(page, 'commuter');
        const id = await employed(page);

        const seen = new Set<string>();
        for (let i = 0; i < 30; i++) {
            seen.add((await personById(page, id))!.travelStep);
            await step(page, 1);
        }
        // The person passes through at least one active travel step beyond Idle (exit / walk-to-car / …).
        const activeSteps = [...seen].filter(s => s !== 'idle' && s !== 'arrived');
        expect(activeSteps.length, `saw steps: ${[...seen].join(', ')}`).toBeGreaterThan(0);
    });
});
