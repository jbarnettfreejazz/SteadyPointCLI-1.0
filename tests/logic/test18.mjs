// SIXTY-THIRD follow-up: tester's report (Calibration full scale 1.00 g,
// noise floor 0, band 0.5–12 Hz) — hollow dots inside the box, and sound not
// starting until about intensity 10.
//   1. edge spill only when there's no real peak inside the band (dsp.js)
//   2. volume curve with a minimum in-zone volume (utils/volumeCurve.js)
//   3. note in Edit Calibration below 1 Hz (utils/calibrationLimits.js)
// Pure logic: identical on iOS and Android.
import { build } from 'esbuild';
await build({ entryPoints: ['../../src/utils/dsp.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outDsp18.mjs', logLevel: 'error' });
await build({ entryPoints: ['../../src/utils/volumeCurve.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outVol18.mjs', logLevel: 'error' });
await build({ entryPoints: ['../../src/utils/calibrationLimits.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outCal18.mjs', logLevel: 'error' });
const D = await import('./outDsp18.mjs');
const V = await import('./outVol18.mjs');
const L = await import('./outCal18.mjs');
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };

// ---- 1. spill ----
// 2 s at 50 Hz (the app's window). Deterministic: fixed phases, seeded noise.
const N = 100, SR = 50;
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const sig = (parts) => [0, 1.3, 2.1].map((k) => Array.from({ length: N }, (_, i) => parts.reduce((s, [f, a, p]) => s + a * Math.sin(2 * Math.PI * f * (i / SR) + p + k), 0) + 0.002 * rnd()));
// "sounds" exactly as liveSession.js decides it: in-band g above the floor
// and the in-band peak isn't spill.
const sounds = (s, lo, hi, floor) => {
  const rms = D.bandLimitedRms(...s, SR, lo, hi);
  if (!(rms > floor)) return false;
  const p = D.tremorPeakInfo(...s, SR, lo, hi);
  return !!p && !p.edgeSpill;
};
// tester's case: a 4 Hz tremor with slow hand wander, band 0.5–12, floor 0
let n = 0, nOld = 0, hzOk = 0;
for (let i = 0; i < 40; i++) {
  const wf = 0.1 + (i % 8) * 0.04, wp = i * 0.7, tp = i * 1.3;
  const s = sig([[4, 0.02, tp], [wf, 0.05, wp]]);
  if (sounds(s, 0.5, 12, 0)) n++;
  const old = D.tremorPeakInfo(...s, SR, 0.5, 12, Infinity); // previous rule (no interior peak can win)
  if (old && !old.edgeSpill) nOld++;
  const p = D.tremorPeakInfo(...s, SR, 0.5, 12);
  if (p && !p.edgeSpill && Math.abs(p.hz - 4) < 0.6) hzOk++;
}
check('tester case: in-band tremor under wander sounds every time', n === 40, `${n}/40 (old rule ${nOld}/40)`);
check('…and the old rule failed some of these (the bug)', nOld < 40, `${nOld}/40`);
check('…at the tremor frequency, not the band edge', hzOk === 40, `${hzOk}/40`);
// tremors really outside a 4–8 Hz band stay silent (50th follow-up)
for (const [f, a] of [[3.5, 0.05], [3.5, 0.2], [3, 0.2], [9, 0.1], [10, 0.3]]) {
  let s = 0;
  for (let i = 0; i < 20; i++) if (sounds(sig([[f, a, i * 0.9]]), 4, 8, 0.006)) s++;
  check(`${f} Hz ${a} g outside 4–8 stays silent`, s === 0, `${s}/20 sounded`);
}
// a plain in-band tremor is unaffected
{
  const p = D.tremorPeakInfo(...sig([[6, 0.05, 0.4]]), SR, 4, 8);
  check('plain 6 Hz in 4–8: no spill, ~6 Hz', p && !p.edgeSpill && Math.abs(p.hz - 6) < 0.4, JSON.stringify(p));
}
check('share constant', D.SPILL_INTERIOR_PEAK_SHARE === 0.1);

// ---- 2. volume curve ----
check('0 = silence', V.volumeForLevel(0) === 0 && V.volumeForLevel(-1) === 0 && V.volumeForLevel(NaN) === 0);
check('any intensity in zone ≥ minimum volume', V.volumeForLevel(0.0001) >= V.VOLUME_MIN_IN_ZONE && V.VOLUME_MIN_IN_ZONE === 0.12);
check('intensity 1 ≈ .18', Math.abs(V.volumeForLevel(0.01) - 0.1755) < 0.002, V.volumeForLevel(0.01));
check('intensity 10 ≈ .34 (was .10)', Math.abs(V.volumeForLevel(0.1) - 0.341) < 0.002, V.volumeForLevel(0.1));
check('intensity 100 = full', V.volumeForLevel(1) === 1 && V.volumeForLevel(2) === 1);
let mono = true; for (let l = 1; l <= 100; l++) if (V.volumeForLevel(l / 100) <= V.volumeForLevel((l - 1) / 100)) mono = false;
check('rises with every intensity step', mono);
let inv = true; for (const l of [0.01, 0.1, 0.34, 0.5, 0.9, 1]) if (Math.abs(V.levelForVolume(V.volumeForLevel(l)) - l) > 1e-9) inv = false;
check('inverse round-trips (fade resume)', inv && V.levelForVolume(0) === 0 && V.levelForVolume(0.05) > 0);

// ---- 3. note below 1 Hz ----
const base = { fullScaleG: '1.00', noiseFloorG: '0.000', tremorBandMinHz: '0.5', tremorBandMaxHz: '12.0' };
const fn = L.validateCalibration || L.checkCalibration || L.validateCalibrationEntries;
check('validator found', typeof fn === 'function', Object.keys(L).join(','));
if (typeof fn === 'function') {
  const r = fn(base);
  check('0.5 Hz: allowed', r.valid === true && !r.errors.tremorBandMinHz, JSON.stringify(r.errors));
  check('0.5 Hz: note about slow hand movement', /slow hand movement/.test(r.warnings.tremorBandMinHz || ''), r.warnings.tremorBandMinHz);
  const r2 = fn({ ...base, tremorBandMinHz: '2.0' });
  check('2 Hz: typical-range note as before', /typical tremor range/.test(r2.warnings.tremorBandMinHz || ''), r2.warnings.tremorBandMinHz);
  const r3 = fn({ ...base, tremorBandMinHz: '1.0' });
  check('exactly 1 Hz: no slow-movement note', !/slow hand movement/.test(r3.warnings.tremorBandMinHz || ''));
}

console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
