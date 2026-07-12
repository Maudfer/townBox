// A zero-dependency static file server for the integration suite (task 008). Serves the production Parcel
// build (`./bin`) so Playwright drives the SAME bundle CI ships — not the dev server. Kept dependency-free (no
// browser-sync client injection, no live-reload socket) so nothing mutates the page under test.
//
// Usage: node scripts/serveIntegration.mjs [--dir ./bin] [--port 4599]
// Playwright's webServer points `command` here and polls `url`.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import process from 'node:process';

function flag(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const ROOT = resolve(flag('dir', './bin'));
const PORT = Number(flag('port', '4599'));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.map': 'application/json; charset=utf-8',
    '.tbz': 'application/octet-stream', // committed history-asset shards
    '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
    // Strip the query string, decode, and normalize away any `..` traversal before joining onto ROOT.
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(ROOT, safePath);

    // Directory or missing extension → serve index.html (single-page entry).
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = join(ROOT, 'index.html');
    }
    if (!existsSync(filePath)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
    }

    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
    console.log(`[serve-integration] serving ${ROOT} at http://localhost:${PORT}`);
});
