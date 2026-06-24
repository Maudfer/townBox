// Encodes/decodes UTF-8 strings to/from base64, working both in the browser (btoa/atob) and Node (Buffer), so
// the same code path is exercised by the game and the Jest tests.

export function encodeBase64(input: string): string {
    if (typeof btoa === 'function') {
        return btoa(unescape(encodeURIComponent(input)));
    }
    return Buffer.from(input, 'utf-8').toString('base64');
}

export function decodeBase64(input: string): string {
    if (typeof atob === 'function') {
        return decodeURIComponent(escape(atob(input)));
    }
    return Buffer.from(input, 'base64').toString('utf-8');
}
