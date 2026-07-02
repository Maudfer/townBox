// Isolated so the `import.meta.url` worker URL — which Parcel uses to detect and bundle the worker — lives in a
// module loaded ONLY at runtime in the browser, via a dynamic import from GameManager.runBootstrap. It is never
// pulled into the Jest/ts-jest (CommonJS) path, where `import.meta` is unavailable. Task 036.
export function createBootstrapWorker(): Worker {
    return new Worker(new URL('./bootstrap.worker.ts', import.meta.url), { type: 'module' });
}
