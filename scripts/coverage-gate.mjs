// Per-module coverage gate (task: game/test reorg).
//
// This does NOT run tests. The CI `test (<module>)` jobs each run `jest --selectProjects <module>
// --coverage` and upload their coverage report as an artifact `coverage-<module>/`. The `coverage` job
// downloads them all and runs this script, which reads EACH module's report independently and fails if
// ANY module's statement coverage is below COVERAGE_THRESHOLD (jest.config.js — the single place to set
// the number).
//
// These per-module numbers are the module measured by its OWN tests only, so they're far below the
// whole-suite aggregate (integration coverage from other modules isn't counted). That's intentional —
// the gate is a forcing function to grow each module's own unit tests.
//
// Usage: node scripts/coverage-gate.mjs [dir]   (default: ./coverage-artifacts)
//   dir contains one subdir per module: coverage-<module>/coverage-final.json

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const libCoverage = require('istanbul-lib-coverage');
const { COVERAGE_THRESHOLD } = require('../jest.config.js');

const root = process.argv[2] ?? 'coverage-artifacts';

function findReports(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findReports(p, acc);
    else if (name === 'coverage-final.json') acc.push(p);
  }
  return acc;
}

// Module name from the report's parent dir: coverage-artifacts/coverage-events/coverage-final.json -> events
function moduleNameOf(reportPath) {
  const dir = basename(dirname(reportPath));
  return dir.replace(/^coverage-/, '');
}

const reports = findReports(root);
if (reports.length === 0) {
  // No module ran (e.g. a docs-only PR ran no test modules) — nothing to gate.
  console.log(`coverage-gate: no coverage-final.json under '${root}'; nothing to gate.`);
  process.exit(0);
}

console.log(`coverage-gate: threshold ${COVERAGE_THRESHOLD}% statements (per module)\n`);
console.log(`  ${'module'.padEnd(12)} ${'stmts'.padStart(7)}  ${'files'.padStart(5)}`);

const results = reports
  .map((reportPath) => {
    const map = libCoverage.createCoverageMap(JSON.parse(readFileSync(reportPath, 'utf8')));
    const summary = libCoverage.createCoverageSummary();
    for (const f of map.files()) summary.merge(map.fileCoverageFor(f).toSummary());
    return { module: moduleNameOf(reportPath), pct: summary.statements.pct, files: map.files().length };
  })
  .sort((a, b) => a.pct - b.pct);

let failed = false;
for (const r of results) {
  const ok = r.pct >= COVERAGE_THRESHOLD;
  if (!ok) failed = true;
  console.log(`  ${ok ? ' ' : '!'}${r.module.padEnd(11)} ${r.pct.toFixed(1).padStart(6)}%  ${String(r.files).padStart(5)}`);
}

const below = results.filter((r) => r.pct < COVERAGE_THRESHOLD);
console.log('');
if (failed) {
  console.error(`coverage-gate: ${below.length}/${results.length} module(s) below ${COVERAGE_THRESHOLD}%: ${below.map((r) => `${r.module} (${r.pct.toFixed(1)}%)`).join(', ')}`);
  process.exit(1);
}
console.log(`coverage-gate: all ${results.length} module(s) meet ${COVERAGE_THRESHOLD}%`);
