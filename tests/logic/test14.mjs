// FIFTY-EIGHTH follow-up: audio.js master gain = on only while sonification is
// on (unmuteAudio .. silenceAudio) AND no call is in progress (setCallMuted).
import { build } from 'esbuild';
const plugin = { name: 'm14', setup(b) {
  b.onResolve({ filter: /^react-native-audio-api$/ }, () => ({ path: new URL('./mock14audio.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^(react-native|react-native-fs)$/ }, () => ({ path: new URL('./mock14rn.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^react-native-device-info$/ }, () => ({ path: new URL('./mock14rn.js', import.meta.url).pathname }));
} };
await build({ entryPoints: ['entry14.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out14.mjs', plugins: [plugin], logLevel: 'error' });
console.log = () => {}; console.warn = () => {};
const A = await import('./out14.mjs');
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; process.stdout.write(`FAIL: ${n} ${x}\n`); } };
A.initAudio();
const master = globalThis.__gains[0];
const LEVEL = master.gain.value;
check('init: master at its normal level', LEVEL > 0, String(LEVEL));
A.unmuteAudio();
check('sound on, no call: audible', master.gain.value === LEVEL);
A.setCallMuted(true);
check('call starts: silent', master.gain.value === 0);
A.unmuteAudio();
check('sound switched on during a call: stays silent', master.gain.value === 0);
A.setCallMuted(false);
check('call ends: audible again', master.gain.value === LEVEL);
A.setCallMuted(true);
A.silenceAudio();
A.setCallMuted(false);
check('session ended during a call: call end does NOT bring sound back', master.gain.value === 0);
A.unmuteAudio();
check('next session: audible', master.gain.value === LEVEL);
A.silenceAudio();
check('silenceAudio still silences', master.gain.value === 0);
A.setCallMuted(false); A.setCallMuted(false);
check('repeated call-end is harmless', master.gain.value === 0);
process.stdout.write(`${ok} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
