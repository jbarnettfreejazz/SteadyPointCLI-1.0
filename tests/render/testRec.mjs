import { build } from 'esbuild'; import plugin from './plugin.mjs';
await build({ entryPoints: ['entryRec.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outRec.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { RecordingScreen, HomeScreen, IntensityChart, durationLabel, clockAt, hourTicks, DisconnectedScreen, SR } = await import('./outRec.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const texts = (root) => root.findAll((n) => n.type === 'Text' || n.type === 'SvgText').map((n) => [].concat(n.props.children).filter(x => typeof x === 'string' || typeof x === 'number').join('')).join(' | ');
const press = (root, label) => { const p = root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === label || n.props.accessibilityLabel === label); if (!p) throw new Error('no pressable ' + label); act(() => p.props.onPress()); };
globalThis.__nav = { navigate() {}, addListener: () => () => {} };
globalThis.__live = { elapsed: 125, displayLevel: 30, liveSev: 'Mild', liveFreqHz: 5.2, liveXpct: 50, liveYpct: 40, liveZpct: 10, recentX: Array(100).fill(0), dispX: Array(50).fill(0), dispY: Array(50).fill(0), dispZ: Array(50).fill(0) };
const settings = { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, bandFilterEnabled: false };
let updates = [];
const mk = (config) => { updates = []; globalThis.__store = { state: { settings, config, isConnected: true, allSessions: [], guideMediaSource: null }, actions: { updateSettings: (p) => updates.push(p), updateConfig: () => {} } }; };

// continuous: button shown, opens dialog
mk({ duration: null, feedbackType: 'visual' });
let r; act(() => { r = TR.create(React.createElement(RecordingScreen)); }); let t = texts(r.root);
check('continuous: button under sonification', t.includes('Sonification | Edit Calibration Settings'), t.slice(0, 300));
const modal = () => r.root.findAll((n) => n.type === 'Modal')[0];
check('dialog closed initially', modal().props.visible === false && r.root.findAll((n) => n.type === 'TextInput').length === 0);
press(r.root, 'Edit Calibration Settings');
check('dialog open with editor', modal().props.visible === true && r.root.findAll((n) => n.type === 'TextInput').length === 4 && texts(r.root).includes('Changes apply to this session right away'));
const input = (label) => r.root.findAll((n) => n.type === 'TextInput' && n.props.accessibilityLabel === label)[0];
act(() => input('Full scale range').props.onChangeText('1'));
globalThis.__alerts = []; press(r.root, 'Save');
const a = globalThis.__alerts[0];
check('session confirm wording', a[0] === 'Save calibration?' && a[1].startsWith('Applies right away') && a[1].includes('Earlier readings in this session') && !a[1].includes('Band'), a[1]);
act(() => a[2][1].onPress());
check('saved + applied + closed', updates[0].fullScaleG === 1 && updates[0].calibrationSource === 'manual' && globalThis.__applied[0].fullScaleG === 1 && globalThis.__applied[0].bandFilterEnabled === false && modal().props.visible === false, JSON.stringify(updates));
press(r.root, 'Edit Calibration Settings'); press(r.root, 'Cancel');
check('cancel closes without applying', modal().props.visible === false && globalThis.__applied.length === 1);
check('feedback noted', (globalThis.__fb || []).includes('visual'));
// timed: no button
mk({ duration: 10, feedbackType: 'visual' });
act(() => { r = TR.create(React.createElement(RecordingScreen)); }); t = texts(r.root);
check('timed: no button', !t.includes('Edit Calibration Settings') && !t.includes('Sonification'));

// chart
const cc = { bg2: '#eee', bd3: '#ddd', tx2: '#555', tx3: '#999', danger: 'red', warning: 'orange', success: 'green' };
act(() => { r = TR.create(React.createElement(IntensityChart, { trace: [10, 20, 30, 40], peaks: [20, 40, 50, 60], events: [{ atSec: 60, kind: 'scale' }, { atSec: 120, kind: 'reconnect' }, { atSec: 30, kind: 'bogus' }], durationSec: 7500, colors: cc })); });
t = texts(r.root);
check('chart markers + labels', t.includes('Calibration') && t.includes('Reconnected') && !t.includes('bogus') && r.root.findAll(n => n.type === 'Path').length === 3, t);
check('chart hours label', t.includes('2 h 5 min') && durationLabel(600) === '10 min' && durationLabel(5400) === '1 h 30 min' && durationLabel(7200) === '2 h');
act(() => { r = TR.create(React.createElement(IntensityChart, { trace: [10, 20], durationSec: 60, colors: cc })); });
check('chart without extras', r.root.findAll(n => n.type === 'Path').length === 2 && texts(r.root).includes('1 min'));

// Home resume prompt
const homeState = (isConnected) => ({ appMode: 'real', isConnected, connectedDeviceName: 'M5', pinnedSessions: [], allSessions: [], settings: { lastCalibratedAt: null } });
globalThis.__offer = { minutesAgo: 3, isContinuous: true, meta: {} };
globalThis.__store = { state: homeState(false), actions: new Proxy({}, { get: () => () => {} }) };
act(() => { r = TR.create(React.createElement(HomeScreen)); });
globalThis.__alerts = [];
globalThis.__store = { state: homeState(true), actions: globalThis.__store.actions };
await act(async () => { r.update(React.createElement(HomeScreen)); await new Promise(res => setTimeout(res, 10)); });
const p = globalThis.__alerts[0];
check('prompt on reconnect', p && p[0] === 'Continue your session?' && p[1].includes('continuous session was interrupted 3 min ago') && p[1].includes('within 10 minutes'), JSON.stringify(p));
act(() => p[2][1].onPress()); check('continue resumes', !!globalThis.__resumed && globalThis.__resumed.state.isConnected === true);
act(() => p[2][0].onPress()); check('keep ended declines', globalThis.__declined === true);
globalThis.__alerts = []; globalThis.__offer = null;
globalThis.__store = { state: homeState(false), actions: globalThis.__store.actions };
await act(async () => { r.update(React.createElement(HomeScreen)); });
globalThis.__store = { state: homeState(true), actions: globalThis.__store.actions };
await act(async () => { r.update(React.createElement(HomeScreen)); await new Promise(res => setTimeout(res, 10)); });
check('no offer -> no prompt', globalThis.__alerts.length === 0);
// already connected on mount -> no prompt
globalThis.__offer = { minutesAgo: 1, isContinuous: false, meta: {} };
await act(async () => { r = TR.create(React.createElement(HomeScreen)); await new Promise(res => setTimeout(res, 10)); });
check('no prompt without a reconnect', globalThis.__alerts.length === 0);
// disconnected screen
act(() => { r = TR.create(React.createElement(DisconnectedScreen)); });
check('disconnected text', texts(r.root).includes('within 10 minutes, you can continue this session'));

// sessionRecord units
check('sliceSize', SR.sliceSize(100, 30) === 1 && SR.sliceSize(400, 120) === 3 && SR.sliceSize(6000, 1800) === 40 && SR.sliceSize(12000, 3600) === 40 && SR.sliceSize(36000, 3 * 3600) === 60);
check('calibrationEvents', JSON.stringify(SR.calibrationEvents([
  { atSec: 0, fullScaleG: 1, noiseFloorG: 0.006, tremorBandFiltered: false, tremorBandMinHz: 3, tremorBandMaxHz: 14 },
  { atSec: 10, fullScaleG: 2, noiseFloorG: 0.006, tremorBandFiltered: false, tremorBandMinHz: 3, tremorBandMaxHz: 14 },
  { atSec: 20, fullScaleG: 2, noiseFloorG: 0.006, tremorBandFiltered: false, tremorBandMinHz: 4, tremorBandMaxHz: 14 },
  { atSec: 30, fullScaleG: 2, noiseFloorG: 0.006, tremorBandFiltered: true, tremorBandMinHz: 4, tremorBandMaxHz: 14 },
], [{ atSec: 15, kind: 'reconnect' }]).map(e => e.kind)) === JSON.stringify(['scale', 'reconnect', 'band']));
const b = SR.buildSessionRecord({ rmsG: [], rmsAllG: [], elapsedSec: 5, startedAtMs: Date.UTC(2026, 0, 1), config: { activityType: 'meditative', duration: 5 } });
check('empty session record', b.record.intensityValid === false && b.record.medianIntensity === null && b.record.intensityTrace.length === 0 && b.record.label === 'Meditation session' && b.record.duration === 1 && !b.record.isContinuous);
// ---- THIRTY-SEVENTH follow-up: long-session axis ----
const st = new Date(2026, 9, 23, 9, 12, 0).getTime();
check('clockAt with gap', clockAt(st, 600, [{ atSec: 300, kind: 'reconnect', gapSec: 120 }]) === st + 720000 && clockAt(st, 200, [{ atSec: 300, kind: 'reconnect', gapSec: 120 }]) === st + 200000);
check('hour ticks', JSON.stringify(hourTicks(st, 3 * 3600 + 600).map(x => x.label)) === JSON.stringify(['10 AM', '11 AM', '12 PM']), JSON.stringify(hourTicks(st, 3 * 3600 + 600)));
const tk = hourTicks(st, 2 * 3600, [{ atSec: 1800, kind: 'reconnect', gapSec: 1800 }]);
check('hour ticks after gap', tk[0].label === '10 AM' && tk[0].sec === 1800 && tk[1].label === '11 AM' && tk[1].sec === 6480 - 1800, JSON.stringify(tk));
check('ticks thinned for long days', hourTicks(st, 11 * 3600).length <= 6, hourTicks(st, 11 * 3600).length);
act(() => { r = TR.create(React.createElement(IntensityChart, { trace: [10, 20, 30], durationSec: 3 * 3600, startedAt: new Date(st).toISOString(), colors: cc })); });
t = texts(r.root);
check('long view labels', t.includes('INTENSITY OVER SESSION · 9:12 AM – 12:12 PM') && t.includes('10 AM') && t.includes('11 AM') && t.includes('9:12 AM') && t.includes('12:12 PM') && !t.includes('0:00'), t);
const svgH = r.root.findAll(n => n.type === 'Svg')[0].props.height;
check('long view taller', svgH === 180);
act(() => { r = TR.create(React.createElement(IntensityChart, { trace: [10, 20, 30], durationSec: 40 * 60, startedAt: new Date(st).toISOString(), colors: cc })); });
check('short session keeps elapsed axis', texts(r.root).includes('0:00') && texts(r.root).includes('40 min') && r.root.findAll(n => n.type === 'Svg')[0].props.height === 140);
act(() => { r = TR.create(React.createElement(IntensityChart, { trace: [10, 20, 30], durationSec: 3 * 3600, colors: cc })); });
check('old record without start time', texts(r.root).includes('0:00') && texts(r.root).includes('3 h'));
// ---- FORTY-NINTH follow-up: tremor map + numbers (replaces 45th/47th/48th text+bar checks) ----
const recState = (settings, pitchFreqHz, actualFreqHz = pitchFreqHz, extra = {}) => {
  globalThis.__live = { ...globalThis.__live, liveFreqHz: 5.2, pitchFreqHz, actualFreqHz, liveRmsG: 0.12, liveRmsAllG: 0.2, mutedReason: null, mapTrail: [], ...extra };
  globalThis.__store = { state: { settings: { ...settings }, config: { duration: null, feedbackType: 'both' }, isConnected: true, allSessions: [], guideMediaSource: null }, actions: { updateSettings() {}, updateConfig() {} } };
};
const FQ = { sonificationMode: 'frequency' };
const BAND = { sonificationMode: 'frequency', bandFilterEnabled: true, tremorBandMinHz: 4, tremorBandMaxHz: 8, noiseFloorG: 0.006, fullScaleG: 0.35 };
const show = (...a) => { recState(...a); act(() => { r = TR.create(React.createElement(RecordingScreen)); }); t = texts(r.root); };
const circles = () => r.root.findAll((n) => n.type === 'Circle');
const bigFilled = () => circles().filter((n) => n.props.r === 6 && n.props.fill !== 'none');
const bigHollow = () => circles().filter((n) => n.props.r === 6 && n.props.fill === 'none');
const box = () => r.root.findAll((n) => n.type === 'Rect' && n.props.fillOpacity === 0.1)[0];
const dashed = () => r.root.findAll((n) => n.type === 'Line' && n.props.strokeDasharray);
const X = (hz) => 38 + ((hz - 1) / 14) * 272;

show(BAND, 4.7);
check('in band: one line with g', t.includes('in-band 4.7 Hz (.12g)') && !t.includes('actual:'), t.slice(0, 500));
check('in band: filled dot only', bigFilled().length === 1 && bigHollow().length === 0 && Math.abs(bigFilled()[0].props.cx - X(4.7)) < 0.01);
check('box = band 4-8', Math.abs(box().props.x - X(4)) < 0.01 && Math.abs(box().props.x + box().props.width - X(8)) < 0.01);
check('no upper limit: open box + dashed full scale line', dashed().length === 1 && box().props.y === 10);
check('frequency mode caption', t.includes('pitch follows the in-band frequency'));
show(BAND, null, 3.5);
check('below band: actual + distance, in-band --', t.includes('actual: 3.5 Hz (.20g) · 0.5 Hz below band') && t.includes('in-band: --'), t.slice(0, 500));
check('below band: hollow dot only', bigHollow().length === 1 && bigFilled().length === 0 && Math.abs(bigHollow()[0].props.cx - X(3.5)) < 0.01);
show(BAND, null, 9.2);
check('above band', t.includes('actual: 9.2 Hz (.20g) · 1.2 Hz above band'), t.slice(0, 400));
show(BAND, 4.1, 3.5, { liveRmsG: 0.012 });
check('both: actual line + in-band value', t.includes('actual: 3.5 Hz (.20g) · 0.5 Hz below band') && t.includes('in-band: 4.1 Hz (.012g)') && bigFilled().length === 1 && bigHollow().length === 1, t.slice(0, 500));
show(BAND, 6.2, 6.4);
check('both in band but different: no distance', t.includes('actual: 6.4 Hz (.20g)') && !t.includes('below band') && !t.includes('above band') && t.includes('in-band: 6.2 Hz'), t.slice(0, 400));
show(BAND, 6.21, 6.24);
check('same to 0.1 Hz: single value', t.includes('in-band 6.2 Hz') && !t.includes('actual:'));
show(BAND, 6.2, 6.2, { mutedReason: 'ceiling' });
check('upper limit mutes: note', t.includes('in-band 6.2 Hz (.12g) · silent above upper limit'), t.slice(0, 400));
show({ ...BAND, intensityCeilingG: 0.2 }, 6.2);
check('upper limit set: closed box, no dashed line', dashed().length === 0 && box().props.y > 10);
show(FQ, 2.1, 2.1);
check('filter off: no distance, full-width box, caption', t.includes('actual: 2.1 Hz') && !t.includes('below band') && t.includes('Band filtering off: all frequencies sound') && Math.abs(box().props.x - 38) < 0.01, t.slice(0, 400));
show(BAND, null, null);
check('rest: dash, no dots', t.includes('—') && bigFilled().length === 0 && bigHollow().length === 0);
show(BAND, 5, 5, { mapTrail: [{ t: Date.now() - 30000, af: 3.5, ag: 0.1, pf: null, pg: 0 }, { t: Date.now() - 10000, af: 5, ag: 0.2, pf: 5, pg: 0.1 }, { t: Date.now(), af: 5, ag: 0.2, pf: 5, pg: 0.1 }] });
const small = circles().filter((n) => n.props.r === 2.5);
check('trail: past points drawn (latest is the big dot), older fainter', small.length === 2 && small[0].props.strokeOpacity < small[1].props.fillOpacity, small.map((n) => n.props.strokeOpacity ?? n.props.fillOpacity).join(','));
show({ bandFilterEnabled: true, tremorBandMinHz: 4, tremorBandMaxHz: 8 }, 6.4);
check('intensity mode: map shows, no pitch caption, old readout gone', t.includes('in-band 6.4 Hz') && !t.includes('pitch follows') && !t.includes('5.2 Hz') && bigFilled().length === 1, t.slice(0, 400));

// ---- FORTY-SEVENTH follow-up: g next to the intensity % ----
show({}, null, null, { displayLevel: 60, displayG: 0.7, liveSev: 'Moderate' });
check('"60% (.70g) intensity"', t.includes('Moderate | 60% (.70g) intensity'), t.slice(0, 300));
show({}, null, null, { displayLevel: 3, displayG: 0.0153 });
check('small g: 3 decimals', t.includes('3% (.015g) intensity'), t.slice(0, 300));
show({}, null, null, { displayLevel: 100, displayG: 1.24 });
check('above 1 g', t.includes('100% (1.24g) intensity'), t.slice(0, 300));
show({}, null, null, { displayLevel: 0, displayG: undefined });
check('missing g → .000g', t.includes('0% (.000g) intensity'), t.slice(0, 300));

// FIFTY-SECOND follow-up: Android back button is swallowed while Recording is shown; iOS registers nothing
const backs = () => (globalThis.__back || []).filter((h) => h.ev === 'hardwareBackPress');
globalThis.__back = []; globalThis.__os = 'ios';
mk({ duration: null, feedbackType: 'visual' });
act(() => { r = TR.create(React.createElement(RecordingScreen)); });
check('iOS: no back handler', backs().length === 0);
act(() => r.unmount());
globalThis.__os = 'android';
act(() => { r = TR.create(React.createElement(RecordingScreen)); });
check('Android: back handler registered', backs().length === 1);
check('Android: back press consumed (no navigation)', backs()[0].fn() === true);
act(() => r.unmount());
check('Android: handler removed on leave', backs().length === 0);
globalThis.__os = 'ios';
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
