// FIFTY-SECOND follow-up (Android round 1): bundled sample paths and the
// calibration-log share, with React Native, react-native-fs and
// react-native-device-info replaced by in-memory mocks.
import { build } from 'esbuild';

const plugin = { name: 'm9', setup(b) {
  b.onResolve({ filter: /^react-native-device-info$/ }, () => ({ path: new URL('./mock9di.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^(react-native|react-native-fs)$/ }, () => ({ path: new URL('./mock9.js', import.meta.url).pathname }));
} };
await build({ entryPoints: ['entry9.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out9.mjs', plugins: [plugin], logLevel: 'error' });
const M = await import('./out9.mjs');

let ok = 0, fail = 0;
const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const reset = () => { globalThis.__files.clear(); globalThis.__dirs.clear(); globalThis.__copies = []; M.__resetForTests(); };
const ALL = ['cello.wav', 'viola.wav', 'violin_c5.wav'];
globalThis.__assets = Object.fromEntries(ALL.map((f) => [`custom/${f}`, 'v1:' + f]));

// iOS: straight from the app bundle, nothing copied
globalThis.__os = 'ios'; reset();
let p = await M.samplePaths(['cello.wav'], ALL);
check('iOS path is the bundle file', p[0] === '/bundle/SteadyPointCLI.app/cello.wav', p[0]);
check('iOS copies nothing', globalThis.__copies.length === 0);

// Android: first load copies the whole set out of the APK, returns plain paths (no file:// or android_asset)
globalThis.__os = 'android'; reset(); globalThis.__installTime = 1000;
const [a, b, c] = await Promise.all([M.samplePaths(['cello.wav'], ALL), M.samplePaths(['viola.wav'], ALL), M.samplePaths(['violin_c5.wav'], ALL)]);
check('Android paths are real files', a[0] === '/data/docs/samples/cello.wav' && b[0] === '/data/docs/samples/viola.wav' && c[0] === '/data/docs/samples/violin_c5.wav', JSON.stringify([a, b, c]));
check('no asset URIs handed to the decoder', ![a, b, c].flat().some((x) => x.includes('android_asset') || x.startsWith('file:')));
check('three voices loading at once share one copy pass', globalThis.__copies.length === 3, JSON.stringify(globalThis.__copies));
check('copied from the react-native-asset folder', globalThis.__copies.every((x) => x.startsWith('custom/')));
check('copies hold the asset contents', globalThis.__files.get('/data/docs/samples/viola.wav') === 'v1:viola.wav');
check('install stamp written', globalThis.__files.get('/data/docs/samples/.installed') === '1000');

// Same run: no second copy
await M.samplePaths(['cello.wav'], ALL);
check('same run: nothing copied again', globalThis.__copies.length === 3);

// Next app launch, same install: copies on disk are reused
M.__resetForTests(); globalThis.__copies = [];
await M.samplePaths(['cello.wav'], ALL);
check('relaunch, same install: no copies', globalThis.__copies.length === 0);

// Same install, one copy deleted (e.g. storage cleaner): only that file restored
M.__resetForTests(); globalThis.__copies = []; globalThis.__files.delete('/data/docs/samples/viola.wav');
await M.samplePaths(['cello.wav'], ALL);
check('missing copy restored alone', JSON.stringify(globalThis.__copies) === JSON.stringify(['custom/viola.wav']), JSON.stringify(globalThis.__copies));

// New install (run-android / update) with a changed WAV of the same name: everything refreshed
M.__resetForTests(); globalThis.__copies = []; globalThis.__installTime = 2000;
globalThis.__assets['custom/cello.wav'] = 'v2:cello.wav';
await M.samplePaths(['cello.wav'], ALL);
check('new install: all re-copied', globalThis.__copies.length === 3);
check('new install: changed WAV refreshed', globalThis.__files.get('/data/docs/samples/cello.wav') === 'v2:cello.wav');
check('new install: stamp updated', globalThis.__files.get('/data/docs/samples/.installed') === '2000');

// A missing asset surfaces as an error (audio.js logs "<voice> samples failed to load")
reset(); globalThis.__installTime = 3000; delete globalThis.__assets['custom/violin_c5.wav'];
let err = null; try { await M.samplePaths(['cello.wav'], ALL); } catch (e) { err = e; }
check('missing asset rejects', err && /violin_c5/.test(err.message), String(err));
check('no stamp after a failed copy (retried next time)', !globalThis.__files.has('/data/docs/samples/.installed'));
globalThis.__assets['custom/violin_c5.wav'] = 'v1:violin_c5.wav';
await M.samplePaths(['cello.wav'], ALL);
check('retry after failure succeeds', globalThis.__files.get('/data/docs/samples/.installed') === '3000');

// Calibration log share
check('short log shared whole', M.androidShareText('a\nb\n') === 'a\nb\n');
const long = Array.from({ length: 5000 }, (_, i) => `[t] line ${i}`).join('\n');
const cut = M.androidShareText(long, 1000);
check('long log trimmed with note', cut.startsWith('[SteadyPoint calibration log — earlier lines left out') && cut.length <= 1000 + 120, String(cut.length));
check('trimmed log keeps the newest line', cut.endsWith('[t] line 4999'));
check('trimmed log starts on a whole line', cut.split('\n')[1].startsWith('[t] line '), cut.split('\n')[1]);
check('cap is well under the Android limit', M.ANDROID_SHARE_MAX_CHARS <= 200000);

reset(); globalThis.__shares = [];
globalThis.__files.set('/data/docs/calibration-log.txt', 'hello\n');
globalThis.__os = 'android'; await M.shareCalibrationLog();
check('Android shares the text as message', globalThis.__shares[0].message === 'hello\n' && !globalThis.__shares[0].url, JSON.stringify(globalThis.__shares[0]));
globalThis.__os = 'ios'; await M.shareCalibrationLog();
check('iOS still shares the file', globalThis.__shares[1].url === 'file:///data/docs/calibration-log.txt' && !globalThis.__shares[1].message);
globalThis.__files.delete('/data/docs/calibration-log.txt');
err = null; try { await M.shareCalibrationLog(); } catch (e) { err = e; }
check('no log yet still errors', err && /No calibration log yet/.test(err.message));

console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
