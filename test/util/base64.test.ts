import { encodeBase64, decodeBase64 } from 'util/base64';

// UTF-8-safe base64 (both browser btoa/atob and the Node Buffer fallback).

describe('encodeBase64 / decodeBase64', () => {
    test('round-trips plain ASCII', () => {
        expect(decodeBase64(encodeBase64('hello world'))).toBe('hello world');
    });

    test('round-trips unicode (accents, non-Latin scripts)', () => {
        const original = 'São Paulo — 東京 — café';
        expect(decodeBase64(encodeBase64(original))).toBe(original);
    });

    test('round-trips the empty string', () => {
        expect(decodeBase64(encodeBase64(''))).toBe('');
    });

    describe('Buffer fallback (when btoa/atob are unavailable, e.g. older Node)', () => {
        let originalBtoa: typeof btoa | undefined;
        let originalAtob: typeof atob | undefined;

        beforeEach(() => {
            originalBtoa = globalThis.btoa;
            originalAtob = globalThis.atob;
            // Simulate an environment without the browser globals so the Buffer branch runs.
            delete (globalThis as Partial<typeof globalThis>).btoa;
            delete (globalThis as Partial<typeof globalThis>).atob;
        });

        afterEach(() => {
            globalThis.btoa = originalBtoa!;
            globalThis.atob = originalAtob!;
        });

        test('still round-trips unicode via Buffer', () => {
            const original = 'São Paulo — café';
            const encoded = encodeBase64(original);
            expect(decodeBase64(encoded)).toBe(original);
        });

        test('the Buffer-encoded form matches Buffer.from(...).toString("base64") directly', () => {
            expect(encodeBase64('hello')).toBe(Buffer.from('hello', 'utf-8').toString('base64'));
        });
    });
});
