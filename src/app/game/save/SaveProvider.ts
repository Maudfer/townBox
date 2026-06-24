// A storage backend for save payloads. The payload is always the base64 save string produced by SaveManager, so
// providers stay agnostic of the snapshot format. Implement this interface to add new backends (e.g. a
// file-based provider) without touching any call sites — SaveManager depends only on this interface.

export interface SaveProvider {
    save(slot: string, data: string): Promise<void>;
    load(slot: string): Promise<string | null>;
    list(): Promise<string[]>;
    delete(slot: string): Promise<void>;
}
