import { SaveProvider } from 'game/save/SaveProvider';

const KEY_PREFIX = 'townbox:save:';

// Persists saves in window.localStorage under a namespaced key per slot. Gracefully degrades when localStorage is
// unavailable (e.g. private mode or a non-browser test environment) by throwing on write and returning null/empty
// on read, so callers can surface an error toast.
export default class LocalStorageProvider implements SaveProvider {
    private getStorage(): Storage | null {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage;
            }
        } catch {
            // Accessing localStorage can throw in sandboxed contexts.
        }
        return null;
    }

    private keyFor(slot: string): string {
        return `${KEY_PREFIX}${slot}`;
    }

    async save(slot: string, data: string): Promise<void> {
        const storage = this.getStorage();
        if (!storage) {
            throw new Error('[LocalStorageProvider] localStorage is not available');
        }
        storage.setItem(this.keyFor(slot), data);
    }

    async load(slot: string): Promise<string | null> {
        const storage = this.getStorage();
        if (!storage) {
            return null;
        }
        return storage.getItem(this.keyFor(slot));
    }

    async list(): Promise<string[]> {
        const storage = this.getStorage();
        if (!storage) {
            return [];
        }

        const slots: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && key.startsWith(KEY_PREFIX)) {
                slots.push(key.slice(KEY_PREFIX.length));
            }
        }
        return slots;
    }

    async delete(slot: string): Promise<void> {
        const storage = this.getStorage();
        if (!storage) {
            return;
        }
        storage.removeItem(this.keyFor(slot));
    }
}
