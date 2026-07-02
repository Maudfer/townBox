import { bootstrapHistory, BootstrapParams, BootstrapProgress } from 'game/HistoryBootstrap';
import { PopulationState } from 'types/Genealogy';
import { EventHistoryTable } from 'types/LifeEvent';

// Web Worker that runs the pre-game history bootstrap (task 036) off the main thread, so the loading screen
// stays responsive while the detailed event engine grinds through the pool's past. The heavy work lives in the
// pure `bootstrapHistory`; this is just the message shim. Deterministic (seeded from the pool's world seed).

export interface BootstrapRequest {
    state: PopulationState;
    params: BootstrapParams;
}

export type BootstrapMessage =
    | { type: 'progress'; progress: BootstrapProgress }
    | { type: 'done'; state: PopulationState; history: EventHistoryTable };

const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<BootstrapRequest>) => {
    const { state, params } = event.data;
    const result = bootstrapHistory(state, params, progress => {
        ctx.postMessage({ type: 'progress', progress } as BootstrapMessage);
    });
    ctx.postMessage({ type: 'done', state: result.state, history: result.history } as BootstrapMessage);
};
