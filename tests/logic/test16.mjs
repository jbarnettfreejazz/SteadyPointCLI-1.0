// SIXTY-FIRST follow-up: Android pauses JS timers while the app isn't on
// screen. Metrics (sound level/pitch, intensity traces) and the session clock
// must keep running on packet arrival alone, without running twice when the
// timers do fire, and with the timers still covering a gap in packets.
// Sample zones crossfaded away must disconnect without their timer.
const intervals = [];
globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
globalThis.clearInterval = () => {};
const timeouts = [];
globalThis.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; }; // never fire ("background")
globalThis.clearTimeout = () => {};
import { build } from 'esbuild';
const plugin = { name: 'm16', setup(b) {
  b.onResolve({ filter: /^react-native$/ }, () => ({ path: new URL('./mock16rn.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^react-native-audio-api$/ }, () => ({ path: new URL('./mock14audio.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^(react-native-fs|react-native-device-info)$/ }, () => ({ path: new URL('./mock16rn.js', import.meta.url).pathname }));
} };
await build({ entryPoints: ['entry16.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out16.mjs', plugins: [plugin], logLevel: 'error' });
console.log = () => {}; console.warn = () => {};
const { live, ZonedSampleVoice } = await import('./out16.mjs');
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; process.stdout.write(`FAIL: ${n} ${x}\n`); } };

const realNow = Date.now; let fake = realNow(); Date.now = () => fake;
let t = 0;
const packet = (amp, f = 6) => { fake += 20; const s = t++ / 50; const v = amp * Math.sin(2 * Math.PI * f * s); live.pushPacket(v, 1 + v * 0.5, v * 0.2); };
const begin = (opts = {}) => {
  live.setFullScaleG(0.35); live.setNoiseFloorG(0.006); live.setTremorBand(4, 8, false);
  live.beginSessionBuffers(); intervals.length = 0; live.startTimers({ totalSeconds: 0, ...opts });
  return { metricsTimer: intervals.find((i) => i.ms === 300).fn, clockTimer: intervals.find((i) => i.ms === 1000).fn };
};

// 1. Packets only, timers never fire: metrics every ~300 ms, sound follows motion
{
  const levels = []; live.setAudioHook((x, y, z, level) => levels.push(level));
  begin();
  for (let i = 0; i < 500; i++) packet(0.1); // 10 s of tremor
  const shaking = levels.at(-1);
  for (let i = 0; i < 250; i++) packet(0); // 5 s at rest
  const resting = levels.at(-1);
  for (let i = 0; i < 250; i++) packet(0.1); // 5 s of tremor again
  const again = levels.at(-1);
  live.stopTimers(); live.setAudioHook(null);
  const r = live.stopRecordingBuffers();
  check('no timers: intensity recorded every ~300 ms (after the 1 s warm-up)', r.rmsTraceG.length >= 62 && r.rmsTraceG.length <= 64, String(r.rmsTraceG.length));
  check('no timers: sound level up while shaking', shaking > 10, String(shaking));
  check('no timers: sound level 0 at rest', resting === 0, String(resting));
  check('no timers: sound comes back with motion', again > 10, String(again));
}

// 2. Packets AND timers firing: still one metrics run per ~300 ms
{
  const { metricsTimer, clockTimer } = begin();
  for (let i = 0; i < 500; i++) { packet(0.1); if (i % 15 === 7) metricsTimer(); if (i % 50 === 3) clockTimer(); }
  live.stopTimers();
  const r = live.stopRecordingBuffers();
  check('packets + timers: no double runs', r.rmsTraceG.length >= 29 && r.rmsTraceG.length <= 31, String(r.rmsTraceG.length));
}

// 3. Packets stop (device out of range): the timers carry on
{
  const { metricsTimer, clockTimer } = begin();
  for (let i = 0; i < 100; i++) packet(0.1); // 2 s
  const before = live.getLiveState().elapsed;
  for (let i = 0; i < 10; i++) { fake += 300; metricsTimer(); if (i % 3 === 2) clockTimer(); } // 3 s, no packets
  clockTimer();
  live.stopTimers();
  const r = live.stopRecordingBuffers();
  check('no packets: metrics continue on the timer', r.rmsTraceG.length === 13, String(r.rmsTraceG.length));
  check('no packets: clock continues on the timer', live.getLiveState().elapsed === 5 && before === 2, `${before} -> ${live.getLiveState().elapsed}`);
}

// 4. Timed session in the background ends on time, once
{
  const ends = [];
  begin({ totalSeconds: 5, onComplete: (s) => ends.push({ s, at: fake }) });
  const start = fake;
  for (let i = 0; i < 400; i++) packet(0.1); // 8 s of packets, no timers
  live.stopTimers(); live.stopRecordingBuffers();
  check('timed session completes from packets alone', ends.length === 1, JSON.stringify(ends));
  check('...at 5 s, on time', ends[0] && ends[0].s === 5 && ends[0].at - start >= 5000 && ends[0].at - start <= 5040, JSON.stringify(ends[0]));
}

// 5. After stopTimers (session ended), packets run nothing
{
  begin();
  for (let i = 0; i < 150; i++) packet(0.1);
  live.stopTimers();
  const r1 = live.stopRecordingBuffers().rmsTraceG.length;
  live.beginSessionBuffers();
  for (let i = 0; i < 200; i++) packet(0.1);
  check('after stop: no metrics from packets', live.stopRecordingBuffers().rmsTraceG.length === 0 && r1 > 0);
  check('after stop: clock not advanced', live.getLiveState().elapsed === 0, String(live.getLiveState().elapsed));
}

// 6. Sample zones: one crossfaded away disconnects without its timer
{
  const { AudioContext } = await import('./mock14audio.js');
  const ac = new AudioContext();
  const v = new ZonedSampleVoice(ac, { pan: 0, zones: [{ file: 'a', refHz: 100, loopRmsDb: 0 }, { file: 'b', refHz: 200, loopRmsDb: 0 }, { file: 'c', refHz: 400, loopRmsDb: 0 }], baseTrimDb: 0, refRmsDb: 0 });
  v.zones.forEach((z) => { z.stretcher = { semitones: { setValueAtTime() {}, linearRampToValueAtTime() {} } }; });
  const connected = () => v.zones.filter((z) => z.connected).map((z) => z.file).join('');
  v.setFrequency(100, 0.05);
  v.setFrequency(200, 0.05); // a -> b
  check('crossfade: two zones while fading', connected() === 'ab', connected());
  fake += 200; v.setFrequency(400, 0.05); // b -> c before a's fade is over
  check('fade not over yet: still connected', connected() === 'abc', connected());
  fake += 500; v.setFrequency(400, 0.05);
  check('timers never fired: old zones disconnected by the next update', connected() === 'c', connected());
  v.setFrequency(100, 0.05); // back to a
  check('a zone can be used again', connected() === 'ac', connected());
  v.release();
  check('release disconnects all', connected() === '');
}
Date.now = realNow;
console.info(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
