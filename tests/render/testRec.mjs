import { build } from 'esbuild'; import plugin from './plugin.mjs';
await build({ entryPoints: ['entryRec.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outRec.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { RecordingScreen, HomeScreen, IntensityChart, durationLabel, clockAt, hourTicks, DisconnectedScreen, SR, SessionCalibrationScreen } = await import('./outRec.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const texts = (root) => root.findAll((n) => n.type === 'Text' || n.type === 'SvgText').map((n) => [].concat(n.props.children).filter(x => typeof x === 'string' || typeof x === 'number').join('')).join(' | ');
const press = (root, label) => { const p = root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === label || n.props.accessibilityLabel === label); if (!p) throw new Error('no pressable ' + label); act(() => p.props.onPress()); };
const navCalls = [];
globalThis.__nav = { navigate: (...a) => navCalls.push(['navigate', ...a]), goBack: () => navCalls.push(['goBack']), canGoBack: () => true, addListener: () => () => {} };
globalThis.__live = { elapsed: 125, displayLevel: 30, liveSev: 'Mild', liveFreqHz: 5.2, liveXpct: 50, liveYpct: 40, liveZpct: 10, recentX: Array(100).fill(0), dispX: Array(50).fill(0), dispY: Array(50).fill(0), dispZ: Array(50).fill(0) };
const settings = { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, bandFilterEnabled: false, sessionView: 'advanced' };
let updates = [];
const mk = (config) => { updates = []; globalThis.__store = { state: { settings, config, isConnected: true, allSessions: [], guideMediaSource: null }, actions: { updateSettings: (p) => updates.push(p), updateConfig: () => {} } }; };

// continuous: button shown, opens dialog
mk({ duration: null, feedbackType: 'visual' });
let r; act(() => { r = TR.create(React.createElement(RecordingScreen)); }); let t = texts(r.root);
check('continuous (Advanced View): Sound + Edit Calibration buttons', t.includes('Sound: Off | Edit Calibration'), t.slice(0, 600));
// FIFTY-SEVENTH follow-up: the editor is its own screen (was a Modal here)
check('no dialog on the Recording screen', r.root.findAll((n) => n.type === 'Modal').length === 0 && r.root.findAll((n) => n.type === 'TextInput').length === 0);
press(r.root, 'Edit Calibration');
check('button opens the session calibration screen', navCalls.some((c) => c[0] === 'navigate' && c[1] === 'sessionCalibration' && c[3]?.pop === true), JSON.stringify(navCalls));
let ed; act(() => { ed = TR.create(React.createElement(SessionCalibrationScreen)); });
check('editor screen: note, 4 fields, scrollable, safe area', ed.root.findAll((n) => n.type === 'TextInput').length === 4 && texts(ed.root).includes('Changes apply to this session right away') && ed.root.findAll((n) => n.type === 'ScrollView').length === 1 && ed.root.findAll((n) => n.type === 'SafeAreaView').length === 1);
const input = (label) => ed.root.findAll((n) => n.type === 'TextInput' && n.props.accessibilityLabel === label)[0];
act(() => input('Full scale range').props.onChangeText('1'));
globalThis.__alerts = []; press(ed.root, 'Save');
const a = globalThis.__alerts[0];
check('session confirm wording', a[0] === 'Save calibration?' && a[1].startsWith('Applies right away') && a[1].includes('Earlier readings in this session') && !a[1].includes('Band'), a[1]);
act(() => a[2][1].onPress());
check('saved + applied + back to the session', updates[0].fullScaleG === 1 && updates[0].calibrationSource === 'manual' && globalThis.__applied[0].fullScaleG === 1 && globalThis.__applied[0].bandFilterEnabled === false && navCalls.at(-1)[0] === 'goBack', JSON.stringify(updates));
act(() => ed.unmount());
act(() => { ed = TR.create(React.createElement(SessionCalibrationScreen)); });
press(ed.root, 'Cancel');
check('cancel goes back without applying', navCalls.at(-1)[0] === 'goBack' && globalThis.__applied.length === 1);
act(() => ed.unmount());
check('feedback noted', (globalThis.__fb || []).includes('visual'));
// timed: no button
mk({ duration: 10, feedbackType: 'visual' });
act(() => { r = TR.create(React.createElement(RecordingScreen)); }); t = texts(r.root);
check('timed: no button', !t.includes('Edit Calibration') && !t.includes('Sonification') && !t.includes('Sound: '));

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
// ---- SIXTY-SECOND follow-up: Simple / Advanced views (replaces the 45th–50th text/map checks) ----
// Run once as iOS and once as Android: the screen has no platform branches
// for these views, and this proves both render the same.
const recState = (settings, extraLive = {}, config = { duration: null, feedbackType: 'both' }) => {
  updates = [];
  globalThis.__live = { ...globalThis.__live, mapTrail: [{ t: Date.now(), af: null, ag: 0, pf: null, pg: 0 }], liveSev: 'Mild', displayLevel: 34, displayG: 0.041, pitchFreqHz: null, actualFreqHz: null, liveRmsG: 0, liveRmsAllG: 0, mutedReason: null, ...extraLive };
  globalThis.__store = { state: { settings: { ...settings }, config, isConnected: true, allSessions: [], guideMediaSource: null }, actions: { updateSettings: (p) => updates.push(p), updateConfig() {} } };
};
const BAND = { bandFilterEnabled: true, tremorBandMinHz: 4, tremorBandMaxHz: 8, noiseFloorG: 0.006, fullScaleG: 0.35 };
const ADV = { ...BAND, sessionView: 'advanced' };
const SIMPLE = { ...BAND, sessionView: 'simple' };
const show = (...a) => { recState(...a); act(() => { r = TR.create(React.createElement(RecordingScreen)); }); t = texts(r.root); };
const circles = () => r.root.findAll((n) => n.type === 'Circle');
const nowDot = () => circles().filter((n) => n.props.r === 7);
const trailDots = () => circles().filter((n) => n.props.r === 3.5);
const styleOf = (n) => [].concat(n.props.style).flat(3).filter(Boolean).reduce((a, x) => ({ ...a, ...x }), {});
const textNode = (s) => r.root.findAll((n) => n.type === 'Text' && [].concat(n.props.children).join('') === s)[0];
const C = { info: '#2563eb', danger: '#dc2626', tx1: '#0f0f0f' }; // light theme (mocks)
// SIXTY-THIRD follow-up: row 1 is three fixed fields (+ two separators) in a
// View whose accessibilityLabel is the joined text.
const row1Of = () => {
  const v = r.root.findAll((n) => n.type === 'View' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes(' · ') && n.props.accessibilityLabel.includes('intensity'))[0];
  if (!v) return { text: null, fields: [], colors: [] };
  const fields = v.findAll((n) => n.type === 'Text');
  return { text: v.props.accessibilityLabel, fields: fields.map((f) => [].concat(f.props.children).join('')), colors: fields.map((f) => styleOf(f).color), nodes: fields };
};

const IN_ZONE = { pitchFreqHz: 4.7, actualFreqHz: 4.7, liveRmsG: 0.041, liveRmsAllG: 0.05 };
const OVER = { pitchFreqHz: 5.6, actualFreqHz: 5.6, liveRmsG: 0.48, liveRmsAllG: 0.5, displayLevel: 100, displayG: 0.48, liveSev: 'High' };
const BELOW = { pitchFreqHz: null, actualFreqHz: 5.2, liveRmsG: 0.004, liveRmsAllG: 0.007, displayLevel: 0, liveSev: 'None' };
const OUT = { pitchFreqHz: null, actualFreqHz: 2.4, liveRmsG: 0.003, liveRmsAllG: 0.03, displayLevel: 0, liveSev: 'None' };

for (const os of ['ios', 'android']) {
  globalThis.__os = os;
  const P = `${os}: `;
  // switch + remembered view
  show({ ...BAND }, IN_ZONE);
  check(P + 'no saved view → Simple View', t.includes('Simple View | Advanced View') && !t.includes('Tremor map') && !t.includes('Raw motion'), t.slice(0, 400));
  const tabs = r.root.findAll((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'tab');
  check(P + 'two tabs, Simple selected', tabs.length === 2 && tabs[0].props.accessibilityState.selected === true && tabs[1].props.accessibilityState.selected === false);
  press(r.root, 'Advanced View');
  check(P + 'choosing Advanced saves it', updates.length === 1 && updates[0].sessionView === 'advanced', JSON.stringify(updates));
  press(r.root, 'Simple View');
  check(P + 'tapping the current view saves nothing', updates.length === 1);
  show(ADV, IN_ZONE);
  check(P + 'saved Advanced → opens in Advanced', t.includes('Tremor map') && t.includes('Raw motion') && t.includes('trail: last 60 s'));

  // top bar
  check(P + 'continuous: label top right', t.includes('Continuous session'));
  show(ADV, IN_ZONE, { duration: 10, feedbackType: 'visual' });
  check(P + 'timed: countdown, no continuous label, no sound/edit buttons', t.includes('-07:55') && !t.includes('Continuous session') && !t.includes('Sound: ') && !t.includes('Edit Calibration'), t.slice(0, 200));

  // Simple View: no Edit Calibration, sonification switch, End Session
  show(SIMPLE, IN_ZONE);
  check(P + 'Simple: sonification + end, no Edit Calibration, no map/waveform', t.includes('Sonification') && t.includes('End Session') && !t.includes('Edit Calibration') && circles().length === 0 && r.root.findAll((n) => n.type === 'Sparkline').length === 0, t.slice(0, 600));

  // (i) in zone
  check(P + 'Simple in zone: circle, label, status', t.includes('34 | Mild | 34% (.041g) intensity | Inside your tremor zone (4–8 Hz)'), t.slice(0, 400));
  show(ADV, IN_ZONE);
  check(P + 'Adv in zone: rows', row1Of().text === '4.7 Hz · .041 g · intensity 34' && t.includes('intensity 34 | inside your tremor zone (4–8 Hz)'), row1Of().text);
  check(P + 'Adv in zone: three fields + separators', JSON.stringify(row1Of().fields) === JSON.stringify(['4.7 Hz', '·', '.041 g', '·', 'intensity 34']), JSON.stringify(row1Of().fields));
  check(P + 'Adv in zone: row 1 blue', row1Of().colors.every((col) => col === C.info));
  check(P + 'Adv: fields fixed width', JSON.stringify(row1Of().nodes.map((n) => styleOf(n).width)) === JSON.stringify(['27%', '5%', '25%', '5%', '38%']));
  check(P + 'Adv in zone: blue dot', nowDot().length === 1 && nowDot()[0].props.fill === C.info);
  check(P + 'Adv: legend, three entries', t.includes('in zone | above your 100 | out of zone') && !t.includes('below threshold'));
  check(P + 'Adv: map labels', t.includes('your level 100') && t.includes('your tremor') && t.includes('Intensity') && t.includes('4.0') && t.includes('8.0'));

  // (ii) above 100
  show(ADV, OVER);
  check(P + 'Adv over: rows', row1Of().text === '5.6 Hz · .480 g · intensity >100' && t.includes('above your level 100 — still counts as 100'), row1Of().text);
  check(P + 'Adv over: row 1 red, red dot, High', row1Of().colors.every((col) => col === C.danger) && nowDot()[0].props.fill === C.danger && t.includes('100 | High | >100% (.480g) intensity'));
  show(SIMPLE, OVER);
  check(P + 'Simple over: status', t.includes('Above your level 100 — counts as 100'));

  // (iii) below threshold — intensity shown as 0, grey filled dot
  show(ADV, BELOW);
  check(P + 'Adv below: rows', row1Of().text === '5.2 Hz · .004 g · intensity 0' && t.includes('below your tremor threshold — counts as 0'), row1Of().text);
  check(P + 'Adv below: hollow dot, black row 1', nowDot()[0].props.fill === 'none' && row1Of().colors.every((col) => col === C.tx1));
  check(P + 'Adv below: None, 0%', t.includes('0 | None | 0% (.004g) intensity'));

  // (iv) out of zone — distance
  show(ADV, OUT);
  check(P + 'Adv out: rows', row1Of().text === '2.4 Hz · .030 g · intensity --' && t.includes('1.6 Hz below your tremor zone — no sound'), row1Of().text);
  check(P + 'Adv out: hollow dot, -- format', nowDot()[0].props.fill === 'none' && t.includes('-- | Out of zone | --% (--g) intensity'));
  show(SIMPLE, OUT);
  check(P + 'Simple out: status', t.includes('2.4 Hz · below your tremor zone'));

  // upper limit
  show({ ...ADV, intensityCeilingG: 0.2 }, { pitchFreqHz: 6, actualFreqHz: 6, liveRmsG: 0.25, liveRmsAllG: 0.26, displayLevel: 70, liveSev: 'High', mutedReason: 'ceiling' });
  check(P + 'upper limit: no sound text + map label', t.includes('above your upper limit — no sound') && t.includes('upper limit') && nowDot()[0].props.fill === 'none', t);

  // band filtering off
  show({ sessionView: 'advanced', bandFilterEnabled: false }, { pitchFreqHz: 2.1, actualFreqHz: 2.1, liveRmsG: 0.05, liveRmsAllG: 0.05 });
  check(P + 'band off: all frequencies count', t.includes('all frequencies count (band filtering off)') && !t.includes('4.0'), t);

  // SIXTY-THIRD follow-up: the tester's settings — noise floor 0, band 0.5–12
  show({ sessionView: 'advanced', bandFilterEnabled: true, tremorBandMinHz: 0.5, tremorBandMaxHz: 12, noiseFloorG: 0, fullScaleG: 1 }, { pitchFreqHz: 4, actualFreqHz: 4, liveRmsG: 0.02, liveRmsAllG: 0.05, displayLevel: 2, displayG: 0.02 });
  const dashed = r.root.findAll((n) => n.type === 'Line' && n.props.strokeDasharray === '5 4');
  const floorLine = dashed.find((n) => n.props.stroke !== C.danger);
  check(P + 'floor 0: floor line on the bottom edge', floorLine && floorLine.props.y1 === 270, floorLine && floorLine.props.y1);
  const svgTexts = r.root.findAll((n) => n.type === 'SvgText');
  const svgText = (str) => svgTexts.filter((n) => [].concat(n.props.children).join('') === str);
  check(P + "floor 0: right-hand label '0' (not .006)", svgText('0').some((n) => n.props.x === 307) && svgText('.006').length === 0);
  const edge = svgText('0.5')[0];
  check(P + 'band from 0.5 Hz: axis starts at 0 Hz, edge drawn at 0.5', edge && edge.props.x > 50 && edge.props.x < 60, edge && edge.props.x);
  check(P + 'tester case reading is in zone (blue dot)', nowDot()[0].props.fill === C.info && row1Of().text === '4.0 Hz · .020 g · intensity 2');
  show(ADV, IN_ZONE);
  const edge4 = r.root.findAll((n) => n.type === 'SvgText' && [].concat(n.props.children).join('') === '4.0')[0];
  check(P + 'band from 4 Hz: axis still starts at 1 Hz', edge4 && Math.abs(edge4.props.x - (46 + (3 / 14) * 256)) < 0.01, edge4 && edge4.props.x);

  // waiting for data
  show(ADV, { mapTrail: [], recentX: [] });
  check(P + 'waiting: rows + no dot', t.includes('Waiting for device data…') && nowDot().length === 0 && t.includes('Starting…'));
  show(SIMPLE, { mapTrail: [] });
  check(P + 'waiting (Simple): message, chip hidden', t.includes('Starting… | Waiting for device data…'));

  // trail: dots coloured by state, older fainter
  const now = Date.now();
  show(ADV, { ...IN_ZONE, mapTrail: [{ t: now - 40000, af: 2.4, ag: 0.03, pf: null, pg: 0.003 }, { t: now - 10000, af: 5, ag: 0.2, pf: 5, pg: 0.1 }, { t: now, af: 4.7, ag: 0.05, pf: 4.7, pg: 0.041 }] });
  const tr = trailDots();
  check(P + 'trail: hollow (out) then blue, older fainter', tr.length === 2 && tr[0].props.fill === 'none' && tr[1].props.fill === C.info && tr[0].props.strokeOpacity < tr[1].props.fillOpacity, tr.map((n) => n.props.fill).join(','));

  // fixed-height rows and scaling caps (iOS Dynamic Type / Android Font size)
  show(ADV, IN_ZONE);
  const rv = r.root.findAll((n) => n.type === 'View' && n.props.accessibilityLabel === '4.7 Hz · .041 g · intensity 34')[0];
  check(P + 'row 1 fixed: height, one-line fields, capped scaling', rv && styleOf(rv).height === 24 && row1Of().nodes.every((f) => f.props.numberOfLines === 1 && f.props.maxFontSizeMultiplier === 1.2 && f.props.adjustsFontSizeToFit === true));
}
globalThis.__os = 'ios';

// ---- FORTY-SEVENTH follow-up (kept): g next to the intensity % ----
show({ sessionView: 'simple' }, { pitchFreqHz: 6, actualFreqHz: 6, liveRmsG: 0.2, displayLevel: 60, displayG: 0.7, liveSev: 'Moderate' });
check('"60% (.700g) intensity" (3 decimals, 63rd)', t.includes('Moderate | 60% (.700g) intensity'), t.slice(0, 300));
show({ sessionView: 'simple' }, { pitchFreqHz: 6, actualFreqHz: 6, liveRmsG: 0.0153, displayLevel: 3, displayG: 0.0153 });
check('small g: 3 decimals', t.includes('3% (.015g) intensity'), t.slice(0, 300));

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
