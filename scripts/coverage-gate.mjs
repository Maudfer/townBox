// Per-module coverage gate (task: game/test reorg).
//
// This does NOT run tests. The CI `test (<module>)` jobs each run `jest --selectProjects <module>
// --coverage` and upload their coverage report as an artifact `coverage-<module>/`. The `coverage` job
// downloads them all and runs this script, which reads EACH module's report and fails if ANY module's
// statement coverage is below COVERAGE_THRESHOLD (jest.config.js — the single place to set the number).
//
// IMPORTANT — why we re-filter to owned files: Jest's `collectCoverageFrom` is additive, not an
// exclusive filter. `jest --selectProjects <m> --coverage` forces the module's own files into the report
// but ALSO leaves in every other file the module's tests transitively `require` (ActionEngine, EventEngine,
// Inventory, util/*, …) at whatever incidental coverage they got. Summarizing the whole report would
// therefore DILUTE a module's real number with unrelated files. So for each report we keep only the files
// the module OWNS (jest.config.js MODULE_COVERAGE) and compute the statement % over just those — the true
// "module measured by its own tests" number the gate intends.
//
// Usage: node scripts/coverage-gate.mjs [dir]   (default: ./coverage-artifacts)
//   dir contains one subdir per module: coverage-<module>/coverage-final.json

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const libCoverage = require('istanbul-lib-coverage');
const { COVERAGE_THRESHOLD, MODULE_COVERAGE } = require('../jest.config.js');

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
  return basename(dirname(reportPath)).replace(/^coverage-/, '');
}

// Turn a module's collectCoverageFrom globs into a path predicate. `foo/bar/**/*.ts` -> prefix match on
// `foo/bar/`; an exact `foo/bar/City.ts` -> endsWith match. Coverage paths are absolute + may use `\`.
function ownedMatcher(globs) {
  const prefixes = [];
  const exacts = [];
  for (const g of globs ?? []) {
    const star = g.indexOf('*');
    if (star >= 0) prefixes.push(g.slice(0, star));
    else exacts.push(g);
  }
  return (file) => {
    const nf = file.split('\\').join('/');
    return prefixes.some((p) => nf.includes(p)) || exacts.some((e) => nf.endsWith(e));
  };
}

const reports = findReports(root);
if (reports.length === 0) {
  // No module ran (e.g. a docs-only PR ran no test modules) — nothing to gate.
  console.log(`coverage-gate: no coverage-final.json under '${root}'; nothing to gate.`);
  process.exit(0);
}

console.log(`coverage-gate: threshold ${COVERAGE_THRESHOLD}% statements (per module, owned files only)\n`);
console.log(`  ${'module'.padEnd(12)} ${'stmts'.padStart(7)}  ${'files'.padStart(5)}`);

const results = reports
  .map((reportPath) => {
    const module = moduleNameOf(reportPath);
    const isOwned = ownedMatcher(MODULE_COVERAGE[module]);
    const map = libCoverage.createCoverageMap(JSON.parse(readFileSync(reportPath, 'utf8')));
    const summary = libCoverage.createCoverageSummary();
    let owned = 0;
    for (const f of map.files()) {
      if (!isOwned(f)) continue;
      summary.merge(map.fileCoverageFor(f).toSummary());
      owned += 1;
    }
    // A report with no owned files is vacuously OK (nothing of this module's own code to gate here).
    const pct = owned === 0 ? 100 : summary.statements.pct;
    return { module, pct, files: owned };
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
