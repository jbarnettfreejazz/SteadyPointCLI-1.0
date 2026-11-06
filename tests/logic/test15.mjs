// FIFTY-NINTH follow-up: guide-track file names. A "#" in the name
// ("Cello Suite #1.m4a") made Android's MediaPlayer read the file:// path as
// a URI with a fragment and stop at the "#" ("resource not found").
// Checks: Android gets a plain path, iOS keeps file://; the saved copy's name
// drops # ? %; the name shown is unchanged; the picked file is saved and
// played under the cleaned name.
import { build } from 'esbuild';
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const calls = (globalThis.__t15 = { prepare: [], moved: [] });
const mocks = {
  'react-native': `export const Platform = { get OS() { return globalThis.__t15.os || 'android'; } };`,
  'react-native-sound': `export default function Sound(f, b, cb) { globalThis.__t15.prepare.push(f); this.play = () => {}; this.stop = () => {}; this.release = () => {}; this.pause = () => {}; setTimeout(() => cb(null), 0); }
    Sound.setCategory = () => {};`,
  'react-native-fs': `export default { DocumentDirectoryPath: '/data/files', exists: async () => false, mkdir: async () => {}, unlink: async () => {},
    moveFile: async (a, b) => { globalThis.__t15.moved.push([a, b]); } };`,
  '@react-native-documents/picker': `export const types = { audio: 'audio/*' }; export const errorCodes = {}; export const isErrorWithCode = () => false;
    export const pick = async () => [{ uri: 'content://x/1', name: '1-01 Bach_ Cello Suite #1 In G, BWV 1007 - 1. Prelude.m4a', type: 'audio/x-m4a', size: 1 }];
    export const keepLocalCopy = async ({ files }) => files.map((f) => ({ status: 'success', localUri: 'file:///data/files/uuid/' + encodeURIComponent(f.fileName) }));`,
};
const plugin = { name: 't15', setup(b) {
  b.onResolve({ filter: /^(react-native|react-native-sound|react-native-fs|@react-native-documents\/picker)$/ }, (a) => ({ path: a.path, namespace: 'm' }));
  b.onLoad({ filter: /.*/, namespace: 'm' }, (a) => ({ contents: mocks[a.path], loader: 'js' }));
} };
await build({ stdin: { contents: `export * from './src/services/guideTrackPlayer'; export { pickGuideAudioFile, safeStoredName } from './src/services/guideAudioPicker';`, resolveDir: new URL('../../', import.meta.url).pathname, loader: 'js' },
  bundle: true, format: 'esm', platform: 'node', outfile: 'out15.mjs', plugins: [plugin], logLevel: 'error' });
const m = await import('./out15.mjs');
const origLog = console.log; console.log = () => {};

check('android: plain path', m.guideTrackSource('/data/files/guideAudio/a #1.m4a', 'android') === '/data/files/guideAudio/a #1.m4a');
check('ios: file:// path', m.guideTrackSource('/var/Documents/guideAudio/a.m4a', 'ios') === 'file:///var/Documents/guideAudio/a.m4a');

check('# -> No.', m.safeStoredName('Cello Suite #1 In G.m4a') === 'Cello Suite No.1 In G.m4a', m.safeStoredName('Cello Suite #1 In G.m4a'));
check('"# 2" -> No.2', m.safeStoredName('Track # 2.mp3') === 'Track No.2.mp3');
check('? and % -> _', m.safeStoredName('What? 100%.mp3') === 'What_ 100_.mp3');
check('slashes -> _', m.safeStoredName('a/b\\c.mp3') === 'a_b_c.mp3');
check('ordinary names unchanged', m.safeStoredName("1-01 Bach_ Cello, BWV 1007 - 1. Prelude (live) & more.m4a") === "1-01 Bach_ Cello, BWV 1007 - 1. Prelude (live) & more.m4a");

const r = await m.pickGuideAudioFile();
const clean = '1-01 Bach_ Cello Suite No.1 In G, BWV 1007 - 1. Prelude.m4a';
console.log = origLog;
check('shown name is the original', r.name === '1-01 Bach_ Cello Suite #1 In G, BWV 1007 - 1. Prelude.m4a', r.name);
check('saved under the cleaned name', r.path === clean, r.path);
check('moved into guideAudio/ under that name', calls.moved.length === 1 && calls.moved[0][1] === '/data/files/guideAudio/' + clean, JSON.stringify(calls.moved));

globalThis.__t15.os = 'android';
m.playGuideTrack(r.path);
check('android plays the plain path', calls.prepare.at(-1) === '/data/files/guideAudio/' + clean, calls.prepare.at(-1));
check('no "#" reaches the player', !calls.prepare.at(-1).includes('#'));
// a track saved before this fix (name with "#") still plays on Android
m.playGuideTrack('Old Suite #3.m4a');
check('old "#" name: plain path, # intact', calls.prepare.at(-1) === '/data/files/guideAudio/Old Suite #3.m4a', calls.prepare.at(-1));
globalThis.__t15.os = 'ios';
m.playGuideTrack(r.path);
check('ios still uses file://', calls.prepare.at(-1) === 'file:///data/files/guideAudio/' + clean, calls.prepare.at(-1));
m.stopGuideTrack();
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
