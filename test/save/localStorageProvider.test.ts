import LocalStorageProvider from 'game/save/LocalStorageProvider';

// LocalStorageProvider.getStorage() gates every method on `typeof window !== 'undefined' && window.localStorage`.
// The Jest `save` project runs under testEnvironment: 'node' (see jest.config.js), so `window` is NOT declared
// by default — exactly the "non-browser test environment" the class's own doc comment calls out. That means:
//   - with no `window` global installed, every method exercises the "unavailable" branch (this is the DEFAULT
//     state of every other test file in this project — nothing to install/tear down there);
//   - to exercise the "available" branch we install a `window.localStorage` global ourselves and tear it down
//     afterward so we don't leak state into other test files;
//   - to exercise the try/catch (line 14-16) we install a `window` whose `localStorage` getter throws, mimicking
//     a sandboxed browser context (private mode, embedded iframe, etc).

// A minimal, spec-accurate in-memory Storage implementation (setItem/getItem/removeItem/key/length/clear).
class MemoryStorage implements Storage {
    private map = new Map<string, string>();

    get length(): number {
        return this.map.size;
    }

    clear(): void {
        this.map.clear();
    }

    getItem(key: string): string | null {
        return this.map.has(key) ? this.map.get(key)! : null;
    }

    key(index: number): string | null {
        return [...this.map.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }

    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

function installWindow(localStorage: Storage): void {
    (globalThis as unknown as { window?: { localStorage: Storage } }).window = { localStorage };
}

function installThrowingWindow(): void {
    (globalThis as unknown as { window?: unknown }).window = {
        get localStorage(): Storage {
            throw new Error('localStorage blocked in this sandboxed context');
        },
    };
}

function uninstallWindow(): void {
    delete (globalThis as unknown as { window?: unknown }).window;
}

describe('LocalStorageProvider (no window global — the default Node test environment)', () => {
    afterEach(() => uninstallWindow());

    test('save() rejects when localStorage is unavailable', async () => {
        const provider = new LocalStorageProvider();
        await expect(provider.save('slot1', 'payload')).rejects.toThrow('localStorage is not available');
    });

    test('load() resolves null when localStorage is unavailable', async () => {
        const provider = new LocalStorageProvider();
        await expect(provider.load('slot1')).resolves.toBeNull();
    });

    test('list() resolves an empty array when localStorage is unavailable', async () => {
        const provider = new LocalStorageProvider();
        await expect(provider.list()).resolves.toEqual([]);
    });

    test('delete() resolves without throwing when localStorage is unavailable', async () => {
        const provider = new LocalStorageProvider();
        await expect(provider.delete('slot1')).resolves.toBeUndefined();
    });
});

describe('LocalStorageProvider (window.localStorage installed)', () => {
    afterEach(() => uninstallWindow());

    test('save/load round-trips a payload under a namespaced key', async () => {
        const storage = new MemoryStorage();
        installWindow(storage);
        const provider = new LocalStorageProvider();

        await provider.save('autosave', 'compressed-payload');

        // The provider namespaces every key so slots never collide with unrelated localStorage entries.
        expect(storage.getItem('townbox:save:autosave')).toBe('compressed-payload');
        await expect(provider.load('autosave')).resolves.toBe('compressed-payload');
    });

    test('load() returns null for a slot that was never saved', async () => {
        installWindow(new MemoryStorage());
        const provider = new LocalStorageProvider();

        await expect(provider.load('missing-slot')).resolves.toBeNull();
    });

    test('list() returns only namespaced slot names, stripped of the prefix, ignoring unrelated keys', async () => {
        const storage = new MemoryStorage();
        storage.setItem('some:other:app:key', 'noise');
        installWindow(storage);
        const provider = new LocalStorageProvider();

        await provider.save('slotA', 'a');
        await provider.save('slotB', 'b');

        const slots = await provider.list();
        expect(slots.sort()).toEqual(['slotA', 'slotB']);
    });

    test('delete() removes a saved slot', async () => {
        const storage = new MemoryStorage();
        installWindow(storage);
        const provider = new LocalStorageProvider();

        await provider.save('toRemove', 'payload');
        await provider.delete('toRemove');

        await expect(provider.load('toRemove')).resolves.toBeNull();
        expect(storage.getItem('townbox:save:toRemove')).toBeNull();
    });
});

describe('LocalStorageProvider (localStorage access throws — sandboxed context)', () => {
    afterEach(() => uninstallWindow());

    test('save() rejects gracefully instead of propagating the underlying throw', async () => {
        installThrowingWindow();
        const provider = new LocalStorageProvider();

        await expect(provider.save('slot1', 'payload')).rejects.toThrow('localStorage is not available');
    });

    test('load() resolves null instead of propagating the underlying throw', async () => {
        installThrowingWindow();
        const provider = new LocalStorageProvider();

        await expect(provider.load('slot1')).resolves.toBeNull();
    });
});
