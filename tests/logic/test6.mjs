// Drives the REAL liveSession metrics loop: fake setInterval, synthetic packets.
const intervals = [];
globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
globalThis.clearInterval = () => {};
import { build } from 'esbuild';
const plugin = { name: 'rn', setup(b) { b.onResolve({ filter: /^react-native$/ }, () => ({ path: new URL('./rnstub.js', import.meta.url).pathname })); } };
await build({ entryPoints: ['entry5.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out6.mjs', plugins: [plugin], logLevel: 'error', loader: { '.js': 'jsx' } });
const { live, dsp } = await import('./out6.mjs');
let ok = 0, fail = 0; const check = (n, c, x='') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const run = (bandActive, amp, freqs) => {
  live.setFullScaleG(0.35); live.setNoiseFloorG(0.006); live.setTremorBand(4, 8, bandActive);
  // SIXTY-FIRST follow-up: a fake clock at the real packet rate (20 ms per
  // packet) — metrics now run when 300 ms have passed, from packets or timer.
  const realNow = Date.now; let fake = realNow(); Date.now = () => fake;
  live.beginSessionBuffers(); intervals.length = 0; live.startTimers({ totalSeconds: 0 });
  const metrics = intervals.find((i) => i.ms === 300).fn;
  let t = 0;
  for (let tick = 0; tick < 40; tick++) {
    for (let k = 0; k < 15; k++, t++) { fake += 20; const s = t / 50; const v = freqs.reduce((a, f) => a + amp * Math.sin(2 * Math.PI * f * s), 0); live.pushPacket(v, 1 + v * 0.5, v * 0.2); }
    metrics();
  }
  live.stopTimers();
  Date.now = realNow;
  return live.stopRecordingBuffers();
};
let r = run(false, 0.1, [6]);
check('traces aligned', r.rmsTraceG.length > 20 && r.rmsAllTraceG.length === r.rmsTraceG.length && r.packetCount === 600 && r.buffer.length === 0, `${r.rmsTraceG.length} ${r.packetCount}`);
check('band off: used == all-frequencies', r.rmsTraceG.every((v, i) => v === r.rmsAllTraceG[i]));
check('initial segment', r.segments.length === 1 && r.segments[0].fullScaleG === 0.35 && r.segments[0].tremorBandFiltered === false);
r = run(true, 0.1, [6, 1]);   // 6 Hz tremor + 1 Hz voluntary motion
check('band on: in-band < all-frequencies', r.rmsTraceG.slice(5).every((v, i) => v < r.rmsAllTraceG[i + 5]), `${r.rmsTraceG[10]} vs ${r.rmsAllTraceG[10]}`);
check('band on: segment says filtered', r.segments[0].tremorBandFiltered === true && r.segments[0].tremorBandMinHz === 4);
r = run(false, 0.5, [6]);  // big motion -> pinned at 100 but g keeps the real value
check('big motion keeps real g (would pin at 100)', r.rmsTraceG.slice(5).every((g) => g > 0.35 && dsp.rmsToLevel(g, 0.35, 0.006) === 100), r.rmsTraceG[10]);
live.beginSessionBuffers(); const fresh = live.stopRecordingBuffers();
check('fresh session starts empty', fresh.rmsTraceG.length === 0 && fresh.rmsAllTraceG.length === 0 && fresh.packetCount === 0);
live.beginSessionBuffers({ keepRawSamples: true }); live.pushPacket(0.1, 1, 0); live.pushPacket(0.2, 1, 0);
check('calibration mode keeps raw samples', live.stopRecordingBuffers().buffer.length === 2);
// FORTY-FOURTH follow-up: live pitch frequency
{
  const hooks = []; live.setAudioHook((...a) => hooks.push(a[6]));
  const realNow = Date.now; let fake = realNow(); Date.now = () => fake;
  live.setFullScaleG(0.35); live.setNoiseFloorG(0.006); live.setTremorBand(4, 8, true);
  live.beginSessionBuffers(); intervals.length = 0; live.startTimers({ totalSeconds: 0 });
  const metrics = intervals.find((i) => i.ms === 300).fn;
  let tt = 0;
  for (let tick = 0; tick < 40; tick++) {
    for (let k = 0; k < 15; k++, tt++) { fake += 20; const s = tt / 50; const v = 0.1 * Math.sin(2 * Math.PI * 6.4 * s) + 0.1 * Math.sin(2 * Math.PI * 1 * s); live.pushPacket(v, 1 + v * 0.5, v * 0.2); }
    metrics();
  }
  live.stopTimers(); live.stopRecordingBuffers(); Date.now = realNow;
  const vals = hooks.filter((v) => v != null);
  check('pitchFreqHz passed to audio hook, near the in-band tremor', vals.length > 100 && Math.abs(vals.at(-1) - 6.4) < 0.2, String(vals.at(-1)));
  live.setAudioHook(null);
}
// FORTY-SEVENTH follow-up: actualFreqHz + displayG
{
  const realNow = Date.now; let fake = realNow(); Date.now = () => fake;
  const go = (bandActive, amp, f, ticks = 40) => {
    live.setFullScaleG(0.35); live.setNoiseFloorG(0.006); live.setTremorBand(4, 8, bandActive);
    live.beginSessionBuffers(); intervals.length = 0; live.startTimers({ totalSeconds: 0 });
    const metrics = intervals.find((i) => i.ms === 300).fn; const seen = [];
    let tt = 0;
    for (let tick = 0; tick < ticks; tick++) {
      for (let k = 0; k < 15; k++, tt++) { fake += 20; const s = tt / 50; const v = amp * Math.sin(2 * Math.PI * f * s); live.pushPacket(v, 1 + v * 0.5, v * 0.2); }
      metrics(); const L = live.getLiveState(); seen.push({ a: L.actualFreqHz, p: L.pitchFreqHz, dl: L.displayLevel, g: L.displayG, lvl: L.tremorLevel });
    }
    live.stopTimers(); live.stopRecordingBuffers(); return seen;
  };
  let s = go(true, 0.1, 3.5).at(-1);
  check('3.5 Hz tremor, band 4-8: actual ≈ 3.5', s.a != null && Math.abs(s.a - 3.5) < 0.15, JSON.stringify(s));
  s = go(true, 0.1, 6.2).at(-1);
  check('6.2 Hz tremor in band: actual ≈ pitch ≈ 6.2', Math.abs(s.a - 6.2) < 0.15 && Math.abs(s.p - 6.2) < 0.15, JSON.stringify(s));
  s = go(true, 0.0005, 6.2).at(-1);
  check('below noise floor: actual null', s.a === null && s.p === null, JSON.stringify(s));
  const seq = go(false, 0.1, 6);
  const mid = seq.filter((x) => x.dl > 0 && x.dl < 100);
  check('displayG matches displayed % (inverse of rmsToLevel)', mid.length > 5 && mid.every((x) => dsp.rmsToLevel(x.g, 0.35, 0.006) === x.dl), JSON.stringify(mid.at(-1)));
  const big = go(false, 0.5, 6).at(-1);
  check('pinned at 100: displayG is the measured g (> full scale)', big.dl === 100 && big.g > 0.35, JSON.stringify(big));
  Date.now = realNow;
}
// FORTY-NINTH follow-up: strict band edges, upper limit, map trail
{
  const realNow = Date.now; let fake = realNow(); Date.now = () => fake;
  const hookLevels = []; live.setAudioHook((rx, ry, rz, level) => hookLevels.push(level));
  const go = ({ band = [4, 8], comps, ticks = 40, ceiling = null }) => {
    live.setFullScaleG(0.35); live.setNoiseFloorG(0.006); live.setTremorBand(band[0], band[1], true); live.setIntensityCeilingG(ceiling);
    live.beginSessionBuffers(); intervals.length = 0; live.startTimers({ totalSeconds: 0 }); hookLevels.length = 0;
    const metrics = intervals.find((i) => i.ms === 300).fn; const seen = [];
    let tt = 0;
    for (let tick = 0; tick < ticks; tick++) {
      for (let k = 0; k < 15; k++, tt++) { fake += 20; const s = tt / 50; const v = comps.reduce((a, [amp, f]) => a + amp * Math.sin(2 * Math.PI * f * s), 0); live.pushPacket(v, 1 + v * 0.5, v * 0.2); }
      metrics(); const L = live.getLiveState();
      seen.push({ lvl: L.tremorLevel, snd: L.soundLevel, why: L.mutedReason, p: L.pitchFreqHz, a: L.actualFreqHz, trail: L.mapTrail, g: L.liveRmsG, gAll: L.liveRmsAllG });
    }
    live.stopTimers(); live.stopRecordingBuffers(); return seen;
  };
  let s = go({ comps: [[0.4, 3.5]] }).slice(10);
  const leaky = s.filter((x) => x.lvl > 0);
  check('3.5 Hz tremor, band 4-8: spill reaches intensity > 0 (the old audible leak)', leaky.length > 5, JSON.stringify(s.at(-1)));
  check('... but is muted as edge spill: no pitch, sound level 0', leaky.every((x) => x.why === 'edge' && x.snd === 0 && x.p === null), JSON.stringify(leaky.at(-1)));
  check('... actual still ≈ 3.5', s.every((x) => Math.abs(x.a - 3.5) < 0.15));
  check('... audio hook got level 0', hookLevels.length > 100 && hookLevels.slice(-100).every((l) => l === 0));
  s = go({ comps: [[0.4, 9.5]] }).slice(10);
  check('9.5 Hz (above band): muted as edge spill', s.filter((x) => x.lvl > 0).every((x) => x.why === 'edge' && x.snd === 0), JSON.stringify(s.at(-1)));
  s = go({ comps: [[0.1, 6]] }).slice(10);
  check('6 Hz in band: sounds, not muted', s.every((x) => x.lvl > 0 && x.why === null && x.snd === x.lvl && Math.abs(x.p - 6) < 0.15), JSON.stringify(s.at(-1)));
  check('... audio hook got the level', hookLevels.slice(-50).every((l) => l > 0));
  s = go({ comps: [[0.1, 4.3]] }).slice(10);
  check('4.3 Hz just inside the band: a real peak, not muted', s.filter((x) => x.lvl > 0).length > 5 && s.filter((x) => x.lvl > 0).every((x) => x.why === null && Math.abs(x.p - 4.3) < 0.2), JSON.stringify(s.at(-1)));
  s = go({ comps: [[0.1, 6], [0.3, 1.5]] }).slice(10);
  check('6 Hz tremor + bigger 1.5 Hz movement: in-band 6 sounds, actual elsewhere', s.every((x) => x.why === null && Math.abs(x.p - 6) < 0.2) && s.some((x) => Math.abs(x.a - 6) > 1), JSON.stringify(s.at(-1)));
  s = go({ comps: [[0.1, 6]], ceiling: 0.03 }).slice(10);
  check('upper limit below the reading: muted (ceiling), pitch still read', s.every((x) => x.why === 'ceiling' && x.snd === 0 && x.lvl > 0 && x.p != null), JSON.stringify(s.at(-1)));
  s = go({ comps: [[0.1, 6]], ceiling: 1 }).slice(10);
  check('upper limit above the reading: sounds', s.every((x) => x.why === null && x.snd === x.lvl));
  s = go({ comps: [[0.1, 6]], ticks: 260 });
  const tr = s.at(-1).trail;
  check('trail keeps the last 60 s', tr.length >= 195 && tr.length <= 202 && fake - tr[0].t <= 60000 && tr.at(-1).t === fake, `${tr.length} ${fake - tr[0].t}`);
  check('trail point = current reading', tr.at(-1).pf === s.at(-1).p && tr.at(-1).af === s.at(-1).a && tr.at(-1).pg === s.at(-1).g && tr.at(-1).ag === s.at(-1).gAll);
  live.beginSessionBuffers();
  check('new session: empty trail', live.getLiveState().mapTrail.length === 0);
  live.stopRecordingBuffers();
  live.setIntensityCeilingG(null); live.setAudioHook(null); Date.now = realNow;
}
console.log(`${ok} passed, ${fail} failed`);
