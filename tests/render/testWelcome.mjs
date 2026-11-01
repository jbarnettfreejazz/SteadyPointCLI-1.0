// FIFTY-SECOND follow-up: first-launch welcome scrolls, so "Use default values"
// is reachable on smaller/Android screens; both buttons still do their jobs.
import { build } from 'esbuild'; import plugin from './plugin.mjs';
await build({ entryPoints: ['entryWelcome.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outWelcome.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { CalibrationWelcomeScreen } = await import('./outWelcome.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const txt = (n) => n.findAll((x) => x.type === 'Text').map((t) => [].concat(t.props.children).filter((y) => typeof y === 'string').join('')).join(' | ');
const nav = []; let updates = [];
globalThis.__nav = { navigate: (...a) => nav.push(['navigate', ...a]), reset: (a) => nav.push(['reset', a]), addListener: () => () => {} };
const mk = (isConnected) => { updates = []; globalThis.__store = { state: { isConnected, bleConnecting: false, connectedDeviceName: 'TremorMonitor', settings: {} }, actions: { updateSettings: (p) => updates.push(p) } }; };

for (const os of ['android', 'ios']) {
  globalThis.__os = os; mk(true); nav.length = 0;
  let r; act(() => { r = TR.create(React.createElement(CalibrationWelcomeScreen)); });
  const sv = r.root.findAll((n) => n.type === 'ScrollView');
  check(`${os}: one ScrollView`, sv.length === 1, String(sv.length));
  const inside = sv.length ? txt(sv[0]) : '';
  check(`${os}: both buttons inside the scrollable area`, inside.includes('Calibrate Now') && inside.includes('Use default values'), inside.slice(-200));
  check(`${os}: content grows to fill so the footer stays at the bottom`, sv[0]?.props.contentContainerStyle?.flexGrow === 1 && sv[0]?.props.contentContainerStyle?.justifyContent === 'space-between');
  const btn = (label) => r.root.findAll((n) => n.type === 'Pressable').find((p) => txt(p) === label);
  act(() => btn('Use default values').props.onPress());
  check(`${os}: defaults saved`, updates.length === 1 && typeof updates[0] === 'object' && Object.keys(updates[0]).length > 0, JSON.stringify(updates));
  check(`${os}: goes to the main app`, nav.some((n) => n[0] === 'reset' && n[1].routes[0].name === 'mainTabs'), JSON.stringify(nav));
  act(() => btn('Calibrate Now').props.onPress());
  check(`${os}: Calibrate Now opens the wizard`, nav.some((n) => n[0] === 'navigate' && n[1] === 'calibration' && n[2]?.fromWelcome === true));
}
globalThis.__os = 'ios'; mk(false);
let r; act(() => { r = TR.create(React.createElement(CalibrationWelcomeScreen)); });
const cal = r.root.findAll((n) => n.type === 'Pressable').find((p) => txt(p) === 'Calibrate Now');
check('not connected: Calibrate Now disabled, defaults still offered', cal.props.disabled === true && txt(r.root).includes('Use default values'));
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
