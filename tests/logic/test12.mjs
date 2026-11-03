// FIFTY-FOURTH follow-up: react-native-sound 0.11.2 threw "resolveAssetSource
// is not a function (it is Object)" on RN 0.81, where that internal file is an
// ES module. Loads the app's real (patched) node_modules/react-native-sound
// with RN mocked that way and plays a guide-track-style file:// path.
// Needs the app's node_modules (npm install in the project root first).
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
const soundJs = new URL('../../node_modules/react-native-sound/sound.js', import.meta.url).pathname;
if (!existsSync(soundJs)) { console.log("FAIL: needs the app's node_modules (npm install in the project root)"); console.log('0 passed, 1 failed'); process.exit(1); }
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
check('patch applied (patch-package)', readFileSync(soundJs, 'utf8').includes('SteadyPoint patch'));
const plugin = { name: 'm12', setup(b) {
  b.onResolve({ filter: /^react-native$/ }, () => ({ path: new URL('./mock12rn.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^react-native\/Libraries\/Image\/resolveAssetSource$/ }, () => ({ path: new URL('./mock12deep.js', import.meta.url).pathname }));
} };
await build({ entryPoints: [soundJs], bundle: true, format: 'esm', platform: 'node', outfile: 'out12.mjs', plugins: [plugin], logLevel: 'error' });
const mod = await import('./out12.mjs');
const Sound = mod.default;
check('module loads', typeof Sound === 'function');
let err = null, loaded = null, s = null;
try {
  s = new Sound('file:///var/mobile/Documents/guideAudio/My Song.mp3', undefined, (e) => { loaded = e || 'ok'; });
} catch (e) { err = e; }
check('creating a guide track does not throw', !err, String(err));
check('loads the file path as given', globalThis.__rnsound.some((c) => c[0] === 'prepare' && c[1] === 'file:///var/mobile/Documents/guideAudio/My Song.mp3'), JSON.stringify(globalThis.__rnsound));
check('load callback fires without error', loaded === 'ok', String(loaded));
check('duration reported', s && s.getDuration() === 12.5);
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
