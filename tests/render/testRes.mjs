import { build } from 'esbuild'; import plugin from './plugin.mjs';
await build({ entryPoints: ['entryRes.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outRes.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { CalibrationResultsScreen } = await import('./outRes.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const texts = (root) => root.findAll((n) => n.type === 'Text').map((n) => [].concat(n.props.children).filter(x => typeof x === 'string' || typeof x === 'number').join('')).join(' | ');
const run = async (fromWelcome, canGoBack) => {
  const log = []; const updates = [];
  globalThis.__nav = { goBack: () => log.push('back'), reset: (s) => log.push(['reset', s.routes[0].name]), canGoBack: () => canGoBack, replace() {}, navigate() {} };
  globalThis.__store = { state: { settings: { fullScaleG: 0.35 } }, actions: { updateSettings: (p) => updates.push(p) } };
  let r; act(() => { r = TR.create(React.createElement(CalibrationResultsScreen, { route: { params: { fullScaleG: 0.42, tremorBandMinHz: 4, tremorBandMaxHz: 8, measuredBand: { minHz: 5, maxHz: 7 }, fromWelcome } } })); });
  const p = r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).includes('Save to Settings'));
  await act(async () => { await p.props.onPress(); });
  return { log, u: updates[0] };
};
let x = await run(false, true);
check('from settings -> back', x.log[0] === 'back' && x.u.bandFilterEnabled === true && x.u.calibrationSource === 'wizard' && !!x.u.calibrationSetAt && !!x.u.lastCalibratedAt, JSON.stringify(x));
x = await run(true, true); check('from welcome -> reset to app', x.log[0][0] === 'reset' && x.log[0][1] === 'mainTabs');
x = await run(false, false); check('cannot go back -> reset', x.log[0][0] === 'reset');

// SIXTY-SIXTH follow-up: the wizard's new full scale needs a lower noise floor
const show = (params) => { const updates = []; globalThis.__nav = { goBack() {}, reset() {}, canGoBack: () => true, replace() {}, navigate() {} };
  globalThis.__store = { state: { settings: { fullScaleG: 4, noiseFloorG: 0.3, calibrationGuardrailsDisabled: true } }, actions: { updateSettings: (p) => updates.push(p) } };
  let r; act(() => { r = TR.create(React.createElement(CalibrationResultsScreen, { route: { params: { fullScaleG: 0.25, tremorBandMinHz: 4, tremorBandMaxHz: 8, measuredBand: null, fromWelcome: false, ...params } } })); });
  return { r, updates, t: texts(r.root) }; };
const saveBtn = (r) => r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).includes('Save to Settings'));
for (const os of ['ios', 'android']) {
  globalThis.__os = os; const P = os + ': ';
  let v = show({ noiseFloorG: 0.125, previousNoiseFloorG: 0.3, noiseFloorSharePct: 50 });
  check(P + 'lowered floor shown with explanation', v.t.includes('Noise floor | NOISE_FLOOR_G | 0.125 g') && v.t.includes('Your noise floor will be lowered from 0.300 g to 0.125 g, 50% of your new full scale'), v.t);
  await act(async () => { await saveBtn(v.r).props.onPress(); });
  check(P + 'Save saves full scale and lowered floor together', v.updates[0].fullScaleG === 0.25 && v.updates[0].noiseFloorG === 0.125 && v.updates[0].calibrationSource === 'wizard', JSON.stringify(v.updates[0]));
  v = show({});
  check(P + 'floor fine: no row, no note', !v.t.includes('NOISE_FLOOR_G') && !v.t.includes('lowered'));
  await act(async () => { await saveBtn(v.r).props.onPress(); });
  check(P + 'floor fine: patch has no noiseFloorG', !('noiseFloorG' in v.updates[0]));
}
globalThis.__os = 'ios';
console.log(`${ok} passed, ${fail} failed`);
