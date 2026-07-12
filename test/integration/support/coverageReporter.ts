import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import type { Profiler } from 'node:inspector';
import { basename, join } from 'node:path';

import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { Reporter } from '@playwright/test/reporter';
import libCoverage from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import v8toIstanbul from 'v8-to-istanbul';

// A Playwright reporter that converts the per-test raw Chromium V8 coverage (written by support/fixtures.ts)
// into an istanbul report SCOPED to the browser-only surface the Jest per-module gate deliberately excludes
// (task 008 §7): src/app/game/scene/**, src/app/game/GameManager.ts, and all of src/app/hud/**. It is
// INFORMATIONAL — it never fails the run — and is only active when COVERAGE=1. Output: coverage-integration/
// (coverage-final.json + lcov.info + html + a printed summary), uploaded as a CI artifact.

const COVERAGE = process.env.COVERAGE === '1';
const OUT_DIR = join(process.cwd(), 'coverage-integration');
const RAW_DIR = join(OUT_DIR, 'raw');
const BIN_DIR = join(process.cwd(), 'bin');

// A source path (from the bundle's source map) is in scope when it belongs to the browser-only surface.
function inScope(path: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    return normalized.includes('src/app/game/scene/')
        || normalized.endsWith('src/app/game/GameManager.ts')
        || normalized.includes('src/app/hud/');
}

interface V8Entry {
    url: string;
    source?: string;
    functions: Profiler.FunctionCoverage[];
}

export default class CoverageReporter implements Reporter {
    async onEnd(): Promise<void> {
        if (!COVERAGE || !existsSync(RAW_DIR)) {
            return;
        }
        const coverageMap = libCoverage.createCoverageMap({});
        // Cache each bundle's source map (read from bin/<name>.js.map) so repeated entries reuse it.
        const sourceMapCache = new Map<string, SourceMapInput>();

        for (const file of readdirSync(RAW_DIR)) {
            if (!file.endsWith('.json')) {
                continue;
            }
            let entries: V8Entry[];
            try {
                entries = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) as V8Entry[];
            } catch {
                continue;
            }
            for (const entry of entries) {
                await this.applyEntry(entry, coverageMap, sourceMapCache);
            }
        }

        // Keep only the in-scope files.
        const scoped = libCoverage.createCoverageMap({});
        for (const file of coverageMap.files()) {
            if (inScope(file)) {
                scoped.addFileCoverage(coverageMap.fileCoverageFor(file));
            }
        }

        this.writeReports(scoped);
        // The raw entries are large and transient — drop them once converted.
        rmSync(RAW_DIR, { recursive: true, force: true });
    }

    private async applyEntry(
        entry: V8Entry,
        coverageMap: libCoverage.CoverageMap,
        sourceMapCache: Map<string, SourceMapInput>,
    ): Promise<void> {
        if (!entry.url || !entry.source || !entry.url.endsWith('.js')) {
            return;
        }
        const name = basename(new URL(entry.url).pathname);
        const mapPath = join(BIN_DIR, `${name}.map`);
        if (!existsSync(mapPath)) {
            return;
        }
        let sourcemap = sourceMapCache.get(name);
        if (!sourcemap) {
            try {
                sourcemap = JSON.parse(readFileSync(mapPath, 'utf8')) as SourceMapInput;
                sourceMapCache.set(name, sourcemap);
            } catch {
                return;
            }
        }
        if (!sourcemap) {
            return;
        }
        try {
            const converter = v8toIstanbul(name, 0, { source: entry.source, sourceMap: { sourcemap } });
            await converter.load();
            converter.applyCoverage(entry.functions);
            const data = converter.toIstanbul();
            for (const [path, fileCoverage] of Object.entries(data)) {
                if (inScope(path)) {
                    coverageMap.addFileCoverage(fileCoverage as libCoverage.FileCoverageData);
                }
            }
        } catch {
            // Skip an entry whose source map won't convert; coverage stays best-effort.
        }
    }

    private writeReports(coverageMap: libCoverage.CoverageMap): void {
        mkdirSync(OUT_DIR, { recursive: true });
        const context = createContext({ dir: OUT_DIR, coverageMap });
        // json → coverage-final.json, lcovonly → lcov.info, html → an inspectable report.
        (reports.create('json') as ReturnType<typeof reports.create>).execute(context);
        (reports.create('lcovonly') as ReturnType<typeof reports.create>).execute(context);
        (reports.create('html') as ReturnType<typeof reports.create>).execute(context);

        // Print a compact statement-coverage summary (informational — no gate).
        const summary = coverageMap.getCoverageSummary();
        const files = coverageMap.files().length;
        const pct = summary.data.statements.pct;
         
        console.log(`\n[integration-coverage] scene/HUD surface: ${files} files, ${summary.data.statements.covered}/${summary.data.statements.total} statements (${pct}%). Report: coverage-integration/`);
    }
}
