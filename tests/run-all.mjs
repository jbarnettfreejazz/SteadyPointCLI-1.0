// Runs every off-device test suite and prints a summary. Usage (from this
// folder): npm install (once), then npm test — or: node run-all.mjs [suite...]
// where suite is logic, render, cal or dsp.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITES = {
  // build steps first (bundle the app code with mocks), then the tests
  logic: ['bundle.mjs', 'b3.mjs', 'test.mjs', 'test2.mjs', 'test3.mjs', 'test5.mjs', 'test6.mjs', 'test7.mjs', 'test8.mjs', 'test9.mjs', 'test10.mjs', 'test11.mjs', 'test12.mjs', 'test13.mjs', 'test14.mjs', 'test15.mjs'],
  render: ['build.mjs', 'test.mjs', 'testHome.mjs', 'testDS.mjs', 'testSet.mjs', 'testApp.mjs', 'testCal.mjs', 'testRec.mjs', 'testQuick.mjs', 'testRes.mjs', 'testHist.mjs', 'testWelcome.mjs'],
  cal: ['test.mjs'],
  dsp: ['freq.mjs'],
};
const BUILD_ONLY = new Set(['bundle.mjs', 'b3.mjs', 'build.mjs']);

const pick = process.argv.slice(2);
let totalOk = 0, totalFail = 0, broken = 0;
for (const [suite, files] of Object.entries(SUITES)) {
  if (pick.length && !pick.includes(suite)) continue;
  for (const f of files) {
    const r = spawnSync(process.execPath, [f], { cwd: path.join(here, suite), encoding: 'utf8', timeout: 300000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (BUILD_ONLY.has(f)) {
      if (r.status !== 0) { broken++; console.log(`✗ ${suite}/${f} (build failed)\n${out.trim()}`); }
      continue;
    }
    const m = out.match(/(\d+) passed, (\d+) failed/g);
    const last = m && m.at(-1).match(/(\d+) passed, (\d+) failed/);
    if (!last) { broken++; console.log(`✗ ${suite}/${f}: no result (exit ${r.status})\n${out.trim().split('\n').slice(-15).join('\n')}`); continue; }
    const ok = +last[1], fail = +last[2];
    totalOk += ok; totalFail += fail;
    const fails = out.split('\n').filter((l) => /^FAIL/.test(l));
    console.log(`${fail ? '✗' : '✓'} ${suite}/${f}: ${ok} passed, ${fail} failed`);
    for (const l of fails) console.log('    ' + l);
  }
}
console.log(`\nTotal: ${totalOk} passed, ${totalFail} failed${broken ? `, ${broken} suite file(s) didn't run` : ''}`);
process.exit(totalFail || broken ? 1 : 0);
