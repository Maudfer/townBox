import { compress, decompress } from '../src/util/compress';
import { encodeBase64 } from '../src/util/base64';

describe('compress / decompress', () => {
    test('round-trips unicode JSON', () => {
        const original = JSON.stringify({ city: 'São Paulo', note: 'açaí & coração', list: [1, 2, 3] });
        expect(decompress(compress(original))).toBe(original);
    });

    test('shrinks repetitive payloads (the genealogy pool compresses well)', () => {
        const people = Array.from({ length: 500 }, (_, i) => ({
            id: `p${i}`,
            firstName: 'João',
            familyName: 'Silva',
            gender: 'male',
            birthTick: -1234,
            deathTick: null,
            fatherId: null,
            motherId: null,
            partnerships: [],
        }));
        const json = JSON.stringify({ version: 2, people });

        const compressed = compress(json);
        const uncompressed = encodeBase64(json);

        expect(compressed.length).toBeLessThan(uncompressed.length);
        expect(decompress(compressed)).toBe(json);
    });

    test('falls back to legacy uncompressed base64 payloads', () => {
        const original = JSON.stringify({ version: 1, legacy: true });
        const legacyPayload = encodeBase64(original); // no compression marker
        expect(decompress(legacyPayload)).toBe(original);
    });
});
