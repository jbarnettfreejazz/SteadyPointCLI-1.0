let NOW = 1_000_000; Date.now = () => NOW;
const intervals = new Map(); let iid = 1;
globalThis.setInterval = (fn, ms) => { const id = iid++; intervals.set(id, { fn, ms }); return id; };
globalThis.clearInterval = (id) => intervals.delete(id);
import { build } from 'esbuild'; import plugin from './plugin.mjs';
await build({ entryPoints: ['entry.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { CalibrationScreen, CalibrationResultsScreen, CalibrationWelcomeScreen, dsp, W } = await import('./out.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };

// ---------- detector port ----------
const feed = (fn, secs, stepMs = 100) => { const d = dsp.createSustainedPeakDetector(); let t = 0; let s; for (; t <= secs * 1000; t += stepMs) s = d.addSample(t, fn(t / 1000)); return s; };
let s = feed((t) => 0.3 * (1 + 0.4 * Math.sin(2 * Math.PI * 1.3 * t)), 8);
check('steady ±40% tremor is held', s.peakWasSustained && Math.abs(s.fullScaleG - s.bestSustainedG) < 1e-12 && s.fullScaleG > 0.3, JSON.stringify(s));
s = feed((t) => (t >= 3 && t < 3.5 ? 0.6 : 0.05), 8);
check('0.5 s burst is brief -> brief value', !s.peakWasSustained && Math.abs(s.fullScaleG - s.bestBriefG) < 1e-12 && Math.abs(s.bestBriefG - 0.6) < 1e-9, JSON.stringify(s));
s = feed((t) => (t >= 3 && t < 4.2 ? 0.6 : 0.05), 8);
check('1.2 s hold is held', s.peakWasSustained && s.fullScaleG > 0.5);
s = feed((t) => 0.1 + t * 0.05, 8);
check('ramp: keeps the best window (not the warm-up)', s.fullScaleG > 0.45, s.fullScaleG);
s = feed((t) => (t < 4 ? 0.4 : 0.02), 10);
check('relaxing before finishing keeps the best value', s.peakWasSustained && s.fullScaleG > 0.39, s.fullScaleG);
const d0 = dsp.createSustainedPeakDetector().state();
check('no data -> null', d0.fullScaleG === null && !d0.hasData && !d0.peakWasSustained);
const d1 = dsp.createSustainedPeakDetector(); d1.addSample(0, 0.2); d1.addSample(100, null);
check('ignores null; single reading -> running peak', d1.state().fullScaleG === 0.2 && d1.state().bestBriefG === null);

// ---------- wizard rules ----------
check('readiness', W.finishReadiness(d0, 10).reason === 'noTremor' && W.finishReadiness({ hasData: true, fullScaleG: 0.005 }, 10).reason === 'noTremor'
  && W.finishReadiness({ hasData: true, fullScaleG: 0.2 }, 4.9).reason === 'tooShort' && W.finishReadiness({ hasData: true, fullScaleG: 0.2 }, 5).ready);
let res = W.calibrationResult({ fullScaleG: 0.4271, band: { minHz: 5.2, maxHz: 6.9 }, current: { tremorBandMinHz: 3, tremorBandMaxHz: 14 } });
check('result rounding + band', res.fullScaleG === 0.43 && !res.fullScaleAdjusted && res.tremorBandMinHz === 4.2 && res.tremorBandMaxHz === 7.9 && res.bandDetected, JSON.stringify(res));
res = W.calibrationResult({ fullScaleG: 0.05, band: null, current: { tremorBandMinHz: 3, tremorBandMaxHz: 14 } });
check('low full scale kept within limits; no band keeps current', res.fullScaleG === 0.1 && res.fullScaleAdjusted && res.measuredFullScaleG === 0.05 && res.tremorBandMinHz === 3 && res.tremorBandMaxHz === 14 && !res.bandDetected);
res = W.calibrationResult({ fullScaleG: 5.5, band: { minHz: 19.5, maxHz: 19.8 }, current: {} });
check('high values clamped', res.fullScaleG === 4 && res.fullScaleAdjusted && res.tremorBandMaxHz === 20 && res.tremorBandMinHz === 18, JSON.stringify(res));
res = W.calibrationResult({ fullScaleG: 0.3, band: { minHz: 0.8, maxHz: 1.0 }, current: {} });
check('low band floored', res.tremorBandMinHz === 0.5 && res.tremorBandMaxHz === 2, JSON.stringify(res));

// ---------- wizard screen ----------
const texts = (root) => root.findAll((n) => n.type === 'Text').map((n) => [].concat(n.props.children).filter(x => typeof x === 'string' || typeof x === 'number').join('')).join(' | ');
const press = (root, label) => { const p = root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === label); if (!p) throw new Error('no pressable ' + label); act(() => p.props.onPress()); };
const navLog = []; globalThis.__nav = { replace: (r, p) => navLog.push([r, p]), goBack() {}, navigate() {}, canGoBack: () => true, reset: (x) => navLog.push(['reset', x]) };
globalThis.__store = { state: { isConnected: true, settings: { fullScaleG: 0.35, tremorBandMinHz: 3, tremorBandMaxHz: 14, noiseFloorG: 0.006 } }, actions: { updateSettings: (p) => (globalThis.__saved = p) } };
// live state: a 2 s window of 6 Hz motion with amplitude amp(t)
let amp = () => 0;
const mkWin = (a) => { const xs = [], ys = [], zs = []; for (let i = 0; i < 100; i++) { const v = a * Math.sin(2 * Math.PI * 6 * i / 50); xs.push(v); ys.push(1 + v * 0.5); zs.push(v * 0.2); } return { recentX: xs, recentY: ys, recentZ: zs }; };
globalThis.__ls = { ...mkWin(0), packetTimes: [], freqWinX: [], freqWinY: [], freqWinZ: [], shortWinX: [] };
let r; act(() => { r = TR.create(React.createElement(CalibrationScreen, { route: { params: { fromWelcome: false } } })); });
press(r.root, 'Go');
check('records with raw samples', globalThis.__began?.keepRawSamples === true && globalThis.__cmds.includes('START'));
const poll = [...intervals.values()].find((i) => i.ms === 100).fn;
const runFor = (secs) => { for (let k = 0; k < secs * 10; k++) { NOW += 100; globalThis.__ls = { ...globalThis.__ls, ...mkWin(amp((NOW - 1_000_000) / 1000)) }; act(() => poll()); } };
const btn = () => r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === '100 Level Reached');
runFor(2);
let t = texts(r.root);
check('no tremor -> disabled + note', btn().props.disabled === true && t.includes('No tremor detected yet'), t.slice(-200));
amp = () => 0.25; runFor(2); t = texts(r.root);
check('too short -> disabled + note', btn().props.disabled === true && t.includes('at least 5 seconds of recording needed') && t.includes('/ 5.0s minimum'), t.slice(-300));
runFor(2); t = texts(r.root);
check('ready + held', btn().props.disabled === false && t.includes('Held ✓') && t.includes('Tap when you’ve reached your biggest tremor'), t.slice(-300));
check('no 5 s plateau bar', !t.includes('Sustained at peak'));
globalThis.__buffer = [];
press(r.root, '100 Level Reached');
let nav = navLog.at(-1);
check('held: straight to results', nav[0] === 'calibrationResults' && nav[1].peakHeld === true && Math.abs(nav[1].fullScaleG - 0.21) < 0.03 && nav[1].measuredBand === null && globalThis.__cmds.at(-1) === 'STOP', JSON.stringify(nav[1]));
// brief: a burst after steady low tremor
intervals.clear(); navLog.length = 0; globalThis.__alerts = [];
amp = () => 0.05;
act(() => { r = TR.create(React.createElement(CalibrationScreen, { route: { params: { fromWelcome: true } } })); });
press(r.root, 'Go');
const poll2 = [...intervals.values()].find((i) => i.ms === 100).fn;
const start2 = NOW;
const run2 = (secs) => { for (let k = 0; k < secs * 10; k++) { NOW += 100; const tt = (NOW - start2) / 1000; globalThis.__ls = { ...globalThis.__ls, ...mkWin(tt > 4 && tt < 4.4 ? 0.6 : 0.05) }; act(() => poll2()); } };
run2(7); t = texts(r.root);
check('brief shown', t.includes('Brief') && t.includes('Try to hold your biggest tremor for a full second') && btn().props.disabled === false, t.slice(-300));
press(r.root, '100 Level Reached');
const al = globalThis.__alerts[0];
check('brief warning', al[0] === 'Your strongest tremor was brief' && al[2][0].text === 'Keep calibrating' && al[2][1].text === 'Continue anyway' && navLog.length === 0);
act(() => al[2][1].onPress()); nav = navLog.at(-1);
check('continue anyway -> brief value', nav[0] === 'calibrationResults' && nav[1].peakHeld === false && nav[1].fullScaleG > 0.2 && nav[1].fromWelcome === true, JSON.stringify(nav[1]));

// ---------- results screen ----------
const saves = []; globalThis.__store = { state: { settings: { fullScaleG: 0.35 } }, actions: { updateSettings: (p) => saves.push(p) } };
const renderRes = (params) => { act(() => { r = TR.create(React.createElement(CalibrationResultsScreen, { route: { params } })); }); return texts(r.root); };
t = renderRes({ fullScaleG: 0.1, measuredFullScaleG: 0.05, fullScaleAdjusted: true, tremorBandMinHz: 3, tremorBandMaxHz: 14, measuredBand: null, peakHeld: false, fromWelcome: false });
check('results notes', t.includes('based on a brief burst') && t.includes('(0.05 g) was outside the allowed range') && t.includes('band filtering will be left off'), t);
const saveBtn = r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).includes('Save to Settings'));
await act(async () => { await saveBtn.props.onPress(); });
check('no band -> filtering off, brief recorded', saves[0].bandFilterEnabled === false && saves[0].calibrationPeakHeld === false && saves[0].calibrationSource === 'wizard', JSON.stringify(saves[0]));
t = renderRes({ fullScaleG: 0.43, tremorBandMinHz: 4.2, tremorBandMaxHz: 7.9, measuredBand: { minHz: 5.2, maxHz: 6.9 }, peakHeld: true, fromWelcome: false });
check('band -> filtering on note, no brief note', t.includes('Band filtering will be turned on') && !t.includes('brief burst') && !t.includes('outside the allowed range'));
await act(async () => { await r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).includes('Save to Settings')).props.onPress(); });
check('band -> filtering on, held', saves[1].bandFilterEnabled === true && saves[1].calibrationPeakHeld === true && saves[1].tremorBandMinHz === 4.2);
// ---------- FORTIETH follow-up: Use default values / Cancel ----------
const p = W.defaultCalibrationPatch(new Date(2026, 9, 25, 12));
check('default patch', p.fullScaleG === 0.35 && p.noiseFloorG === 0.006 && p.tremorBandMinHz === 3 && p.tremorBandMaxHz === 14 && p.bandFilterEnabled === false && p.hasCalibrated === true && p.calibrationSource === 'default' && !('lastCalibratedAt' in p));
let upd = []; navLog.length = 0; const backs = [];
globalThis.__nav = { replace: (r2, p2) => navLog.push([r2, p2]), goBack: () => backs.push(1), navigate: (r2, p2) => navLog.push(['nav', r2, p2]), canGoBack: () => true, reset: (x) => navLog.push(['reset', x.routes[0].name]) };
globalThis.__store = { state: { isConnected: true, settings: { fullScaleG: 1 } }, actions: { updateSettings: (x) => upd.push(x) } };
act(() => { r = TR.create(React.createElement(CalibrationScreen, { route: { params: { fromWelcome: true } } })); });
t = texts(r.root);
check('first launch: Go + Use default values, no Cancel', t.includes('Go') && t.includes('Use default values') && !t.includes('Cancel'));
press(r.root, 'Use default values');
check('defaults applied + Home', upd[0].fullScaleG === 0.35 && upd[0].calibrationSource === 'default' && navLog.at(-1)[0] === 'reset' && navLog.at(-1)[1] === 'mainTabs');
act(() => { r = TR.create(React.createElement(CalibrationScreen, { route: { params: { fromWelcome: false } } })); });
t = texts(r.root);
check('recalibrate: Cancel, no defaults', t.includes('Cancel') && !t.includes('Use default values'));
upd = []; press(r.root, 'Cancel');
check('cancel goes back, changes nothing', backs.length === 1 && upd.length === 0 && !(globalThis.__cmds || []).slice(-1).includes('START') || backs.length === 1 && upd.length === 0);
// Welcome screen (not connected)
globalThis.__store = { state: { isConnected: false, settings: {} }, actions: { updateSettings: (x) => upd.push(x) } };
act(() => { r = TR.create(React.createElement(CalibrationWelcomeScreen)); });
t = texts(r.root);
const calNow = r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === 'Calibrate Now');
check('welcome: defaults available without device', calNow.props.disabled === true && t.includes('Use default values') && t.includes('Connect your device to calibrate') && t.includes('calibrate later from Settings') && !t.includes("won't be able"), t);
upd = []; press(r.root, 'Use default values');
check('welcome defaults applied + Home', upd[0].hasCalibrated === true && upd[0].bandFilterEnabled === false && navLog.at(-1)[1] === 'mainTabs');

// SIXTY-SIXTH follow-up: a new full scale can leave the noise floor outside the rule
{
  const r1 = W.calibrationResult({ fullScaleG: 0.3, band: null, current: { fullScaleG: 1, noiseFloorG: 0.1 } });
  check('66: guarded, floor 0.100 → full scale 0.30: lowered to 0.030 (10%)', r1.noiseFloorG === 0.03 && r1.previousNoiseFloorG === 0.1 && r1.noiseFloorSharePct === 10, JSON.stringify(r1));
  const r2 = W.calibrationResult({ fullScaleG: 0.25, band: null, current: { fullScaleG: 4, noiseFloorG: 0.3, calibrationGuardrailsDisabled: true } });
  check('66: unguarded, floor 0.300 above new full scale 0.25: lowered to 0.125 (50%)', r2.noiseFloorG === 0.125 && r2.noiseFloorSharePct === 50, JSON.stringify(r2));
  const r3 = W.calibrationResult({ fullScaleG: 0.8, band: null, current: { fullScaleG: 1, noiseFloorG: 0.3, calibrationGuardrailsDisabled: true } });
  check('66: unguarded, 0.300 still within 50% of 0.80: unchanged', r3.noiseFloorG === null);
  const r4 = W.calibrationResult({ fullScaleG: 0.42, band: null, current: {} });
  check('66: defaults: unchanged', r4.noiseFloorG === null && r4.previousNoiseFloorG === 0.006);
  const r5 = W.calibrationResult({ fullScaleG: 0.05, band: null, current: { noiseFloorG: 0.01 } });
  check('66: full scale clamped to 0.10 first, then floor checked against it', r5.fullScaleG === 0.1 && r5.noiseFloorG === null && W.calibrationResult({ fullScaleG: 0.05, band: null, current: { noiseFloorG: 0.02 } }).noiseFloorG === 0.01);
}
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
