// Per-module coverage gate (task: game/test reorg).
//
// The CI `coverage` job runs the FULL suite once (`jest --coverage`) so cross-module/integration
// coverage is captured (this codebase's tests are integration-heavy — a file is driven to high
// coverage by many modules' tests, not just its own). This script then groups the resulting
// coverage-final.json by module (jest.config.js MODULE_COVERAGE) and checks each module's slice
// against its threshold (DEFAULT_THRESHOLD, or a MODULE_THRESHOLDS override). Fails if any module is
// under. So "every module is independently >= its floor" is enforced, per-module.
//
// Usage: node scripts/coverage-gate.mjs [coverageDirOrFile]   (default: ./coverage)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const libCoverage = require('istanbul-lib-coverage');
const { MODULE_COVERAGE, DEFAULT_THRESHOLD, MODULE_THRESHOLDS } = require('../jest.config.js');

const target = process.argv[2] ?? 'coverage';

function findCoverageFiles(pathArg, acc = []) {
  const s = (() => { try { return statSync(pathArg); } catch { return null; } })();
  if (!s) return acc;
  if (s.isFile()) { if (pathArg.endsWith('.json')) acc.push(pathArg); return acc; }
  for (const name of readdirSync(pathArg)) {
    const p = join(pathArg, name);
    if (statSync(p).isDirectory()) findCoverageFiles(p, acc);
    else if (name === 'coverage-final.json') acc.push(p);
  }
  return acc;
}

const files = findCoverageFiles(target);
if (files.length === 0) {
  // No coverage produced (e.g. a docs-only PR ran no tests) — nothing to gate.
  console.log(`coverage-gate: no coverage-final.json under '${target}'; nothing to gate.`);
  process.exit(0);
}

const map = libCoverage.createCoverageMap({});
for (const file of files) map.merge(libCoverage.createCoverageMap(JSON.parse(readFileSync(file, 'utf8'))));

const norm = (p) => p.split('\\').join('/');
// Turn each module's collectCoverageFrom globs into a cheap path predicate.
function matcher(globs) {
  const prefixes = [];
  const exacts = [];
  for (const g of globs) {
    if (g.includes('*')) prefixes.push(g.slice(0, g.indexOf('*')));
    else exacts.push(g);
  }
  return (f) => prefixes.some((p) => f.includes(p)) || exacts.some((e) => f.endsWith(e));
}
const modules = Object.entries(MODULE_COVERAGE).map(([name, globs]) => ({ name, match: matcher(globs) }));

const metrics = ['statements', 'branches', 'functions', 'lines'];
let failed = false;
console.log(`coverage-gate: ${map.files().length} files across ${modules.length} modules\n`);
console.log(`  ${'module'.padEnd(11)} ${metrics.map((m) => m.slice(0, 4).padStart(6)).join(' ')}`);

for (const { name, match } of modules) {
  const summary = libCoverage.createCoverageSummary();
  let n = 0;
  for (const f of map.files()) if (match(norm(f))) { summary.merge(map.fileCoverageFor(f).toSummary()); n++; }
  const th = { ...DEFAULT_THRESHOLD, ...(MODULE_THRESHOLDS[name] ?? {}) };
  const cells = [];
  let modOk = true;
  for (const m of metrics) {
    const pct = n === 0 ? 100 : summary[m].pct; // a module with no covered files (skipped) is vacuously ok
    const ok = pct >= th[m];
    if (!ok) { modOk = false; failed = true; }
    cells.push(`${ok ? ' ' : '!'}${pct.toFixed(0).padStart(5)}`);
  }
  console.log(`  ${modOk ? ' ' : 'x'}${name.padEnd(10)} ${cells.join(' ')}`);
}

console.log('');
if (failed) {
  console.error('coverage-gate: a module is below its threshold (see "!" cells; thresholds in jest.config.js)');
  process.exit(1);
}
console.log('coverage-gate: every module meets its threshold');
