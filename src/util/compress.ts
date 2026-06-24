import pako from 'pako';

import { decodeBase64 } from 'util/base64';

// Compresses save payloads. The genealogy pool can be thousands of records, so the JSON is deflated before
// base64 to keep saves within localStorage limits. pako is used (rather than the async CompressionStream /
// Node zlib split) so the same synchronous code path runs in the browser and in Jest.
//
// New payloads are prefixed with a marker; payloads without it are treated as legacy uncompressed base64
// (pre-compression saves), so older saves still load.
const MARKER = 'TBZ1:';

// Browser btoa/atob work on binary strings; convert the byte array in chunks to avoid call-stack limits.
const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
    if (typeof btoa === 'function') {
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(base64: string): Uint8Array {
    if (typeof atob === 'function') {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

// Deflates a JSON string to a base64, marker-prefixed payload.
export function compress(json: string): string {
    return MARKER + bytesToBase64(pako.deflate(json));
}

// Inverse of compress(). Falls back to plain base64 decoding for legacy (pre-compression) payloads.
export function decompress(data: string): string {
    if (data.startsWith(MARKER)) {
        return pako.inflate(base64ToBytes(data.slice(MARKER.length)), { to: 'string' });
    }
    return decodeBase64(data);
}
