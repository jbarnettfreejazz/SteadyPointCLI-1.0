import { build } from 'esbuild'; import plugin from './plugin.mjs';
await build({ entryPoints: ['entryCal.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outCal.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { CalibrationSettingsScreen, SonificationSettingsScreen, SettingsScreen, L, confirmationLines } = await import('./outCal.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };

// ---------- calibrationLimits unit tests ----------
const good = { fullScaleG: '0.35', noiseFloorG: '0.006', tremorBandMinHz: '4.0', tremorBandMaxHz: '8.0' };
let v = L.validateCalibration(good);
check('valid basic', v.valid && v.values.fullScaleG === 0.35 && v.values.tremorBandMaxHz === 8 && Object.keys(v.warnings).length === 0, JSON.stringify(v));
check('parse', L.parseEntry('1.') === 1 && L.parseEntry('.5') === 0.5 && L.parseEntry('') === null && L.parseEntry('-1') === null && L.parseEntry('1e3') === null && L.parseEntry('1.2.3') === null && L.parseEntry('abc') === null);
check('empty -> Enter a value', L.validateCalibration({ ...good, fullScaleG: '' }).errors.fullScaleG === 'Enter a value');
check('junk -> Enter a number', L.validateCalibration({ ...good, fullScaleG: 'x' }).errors.fullScaleG === 'Enter a number');
check('full scale range', L.validateCalibration({ ...good, fullScaleG: '4.01' }).errors.fullScaleG === 'Must be between 0.10 – 4.00 g' && L.validateCalibration({ ...good, fullScaleG: '0.09' }).errors.fullScaleG && L.validateCalibration({ ...good, fullScaleG: '4' }).valid && L.validateCalibration({ ...good, fullScaleG: '0.1' }).valid);
check('noise range', L.validateCalibration({ ...good, noiseFloorG: '0.051' }).errors.noiseFloorG && L.validateCalibration({ ...good, noiseFloorG: '0', fullScaleG: '1' }).valid);
check('noise at most 10% of full scale (65th: was under)', L.validateCalibration({ ...good, noiseFloorG: '0.036' }).errors.noiseFloorG === 'Must be at most 10% of full scale (0.035 g or less)' && L.validateCalibration({ ...good, noiseFloorG: '0.035' }).valid, L.validateCalibration({ ...good, noiseFloorG: '0.036' }).errors.noiseFloorG);
check('band ranges', L.validateCalibration({ ...good, tremorBandMinHz: '0.4' }).errors.tremorBandMinHz && L.validateCalibration({ ...good, tremorBandMaxHz: '20.1' }).errors.tremorBandMaxHz && L.validateCalibration({ ...good, tremorBandMaxHz: '1.4', tremorBandMinHz: '0.5' }).errors.tremorBandMaxHz);
check('band gap', L.validateCalibration({ ...good, tremorBandMinHz: '7.1' }).errors.tremorBandMinHz === 'Must be at least 1 Hz below the maximum' && L.validateCalibration({ ...good, tremorBandMinHz: '7.0' }).valid);
check('band edges', L.validateCalibration({ ...good, tremorBandMinHz: '18', tremorBandMaxHz: '20' }).valid && L.validateCalibration({ ...good, tremorBandMinHz: '0.5', tremorBandMaxHz: '1.5' }).valid);
const w = L.validateCalibration({ ...good, tremorBandMinHz: '2', tremorBandMaxHz: '14' });
check('warnings outside 3–12', w.valid && w.warnings.tremorBandMinHz.includes('Below') && w.warnings.tremorBandMaxHz.includes('Above'));
check('rounding to step', L.validateCalibration({ ...good, fullScaleG: '0.354' }).values.fullScaleG === 0.35 && L.validateCalibration({ ...good, tremorBandMinHz: '4.06' }).values.tremorBandMinHz === 4.1);
check('step +/-', L.stepEntry('fullScaleG', '0.35', 1) === '0.36' && L.stepEntry('fullScaleG', '4.00', 1) === '4.00' && L.stepEntry('noiseFloorG', '0.006', -1) === '0.005' && L.stepEntry('noiseFloorG', '0.000', -1) === '0.000' && L.stepEntry('tremorBandMaxHz', '', 1) === '1.5' && L.stepEntry('tremorBandMaxHz', 'x', -1) === '20.0');
check('step float noise', L.stepEntry('tremorBandMinHz', '0.7', 1) === '0.8' && L.stepEntry('fullScaleG', '0.29', 1) === '0.30');
check('entries from settings', JSON.stringify(L.entriesFromSettings({ fullScaleG: 1, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14 })) === JSON.stringify({ fullScaleG: '1.00', noiseFloorG: '0.006', tremorBandMinHz: '3.0', tremorBandMaxHz: '14.0' }));
check('entries missing -> defaults', L.entriesFromSettings({}).fullScaleG === '0.35');
const set0 = { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, bandFilterEnabled: false };
check('describe changes', JSON.stringify(L.describeChanges(set0, { fullScaleG: 1, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14 }, false)) === '{"scale":true,"band":false,"ceiling":false}'
  && JSON.stringify(L.describeChanges(set0, { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 4, tremorBandMaxHz: 14 }, false)) === '{"scale":false,"band":true,"ceiling":false}'
  && JSON.stringify(L.describeChanges(set0, { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14 }, true)) === '{"scale":false,"band":true,"ceiling":false}');

// ---------- screens ----------
const texts = (root) => root.findAll((n) => n.type === 'Text').map((n) => [].concat(n.props.children).filter(x => typeof x === 'string' || typeof x === 'number').join('')).join(' | ');
let listeners = {}; const navLog = [];
globalThis.__nav = { navigate: (r, p) => navLog.push([r, p]), goBack: () => navLog.push(['back']), dispatch: (a) => navLog.push(['dispatch', a]), canGoBack: () => true,
  addListener: (ev, fn) => { listeners[ev] = fn; return () => { delete listeners[ev]; }; } };
let updates = [];
const mk = (settings) => { updates = []; globalThis.__store = { state: { settings: { ...set0, ...settings } }, actions: { updateSettings: (p) => updates.push(p) } }; };
const press = (root, label) => { const p = root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === label || n.props.accessibilityLabel === label); if (!p) throw new Error('no pressable ' + label); act(() => p.props.onPress()); };
const input = (root, label) => root.findAll((n) => n.type === 'TextInput' && n.props.accessibilityLabel === label)[0];
const type = (root, label, text) => act(() => input(root, label).props.onChangeText(text));

mk({}); let r; act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); let t = texts(r.root);
check('view mode values', t.includes('Full scale range | 0.35 g') && t.includes('Noise floor | 0.006 g') && t.includes('Minimum tremor band | 3.0 Hz') && t.includes('Maximum tremor band | 14.0 Hz') && t.includes('Band filtering | Off'), t.slice(0, 500));
check('view mode: no inputs, wizard card', r.root.findAll(n => n.type === 'TextInput').length === 0 && t.includes('Recalibrate') === false && t.includes('Open Calibration') === false && t.split(' | ').includes('Calibrate') && t.includes('Share Calibration Log') && t.includes('Using the default values.'));
check('no preset verbiage', !/preset|sensitivity/i.test(t));
press(r.root, 'Edit values'); t = texts(r.root);
check('edit mode inputs', r.root.findAll(n => n.type === 'TextInput').length === 4 && input(r.root, 'Full scale range').props.value === '0.35' && t.includes('Allowed: 0.10 – 4.00 g') && !t.includes('Share Calibration Log'));
const saveBtn = () => r.root.findAll((n) => n.type === 'Pressable').find((n) => texts({ findAll: (f) => n.findAll(f) }).trim() === 'Save');
check('save disabled until change', saveBtn().props.disabled === true);
press(r.root, 'Increase Full scale range'); check('stepper', input(r.root, 'Full scale range').props.value === '0.36' && saveBtn().props.disabled === false);
type(r.root, 'Full scale range', '5'); t = texts(r.root);
check('error shown, save disabled', t.includes('Must be between 0.10 – 4.00 g') && saveBtn().props.disabled === true);
type(r.root, 'Full scale range', '1'); type(r.root, 'Minimum tremor band', '2'); t = texts(r.root);
check('warning shown, save enabled', t.includes('Below the typical tremor range (3–12 Hz)') && saveBtn().props.disabled === false);
// leaving with unsaved edits -> prompt
globalThis.__alerts = [];
let prevented = false; act(() => listeners.beforeRemove({ preventDefault: () => { prevented = true; }, data: { action: 'GO_BACK' } }));
check('unsaved -> discard prompt', prevented && globalThis.__alerts[0][0] === 'Discard changes?');
act(() => globalThis.__alerts[0][2][1].onPress()); check('discard dispatches', navLog.some(x => x[0] === 'dispatch' && x[1] === 'GO_BACK'));
// switch + save
const sw = r.root.findAll(n => n.type === 'Switch')[0]; act(() => sw.props.onValueChange(true));
globalThis.__alerts = []; press(r.root, 'Save');
const a = globalThis.__alerts[0];
check('confirm text', a[0] === 'Save calibration?' && a[1].includes('Past sessions will be shown on the new full scale') && a[1].includes('Band changes apply to new sessions only'), JSON.stringify(a));
act(() => a[2][1].onPress());
const u = updates[0];
check('saved values', u.fullScaleG === 1 && u.noiseFloorG === 0.006 && u.tremorBandMinHz === 2 && u.tremorBandMaxHz === 14 && u.bandFilterEnabled === true && u.calibrationSource === 'manual' && !!u.calibrationSetAt && !('lastCalibratedAt' in u), JSON.stringify(u));
check('back to view mode', r.root.findAll(n => n.type === 'TextInput').length === 0);
// cancel restores
mk({ fullScaleG: 2, bandFilterEnabled: true, calibrationSource: 'manual', calibrationSetAt: new Date(2026, 9, 22, 12).toISOString() });
act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); t = texts(r.root);
check('last set manually note', t.includes('Last set manually on Oct 22, 2026') && t.includes('Band filtering | On'));
press(r.root, 'Edit values'); type(r.root, 'Noise floor', '0.04'); t = texts(r.root);
check('noise rule vs full scale 2', !t.includes('under 10%'));
press(r.root, 'Cancel'); check('cancel: nothing saved', updates.length === 0 && texts(r.root).includes('Noise floor | 0.006 g'));
press(r.root, 'Edit values'); check('edit restarts from saved', input(r.root, 'Noise floor').props.value === '0.006');
press(r.root, 'Restore defaults'); check('restore defaults', input(r.root, 'Full scale range').props.value === '0.35' && input(r.root, 'Maximum tremor band').props.value === '14.0' && r.root.findAll(n => n.type === 'Switch')[0].props.value === false);
prevented = false; press(r.root, 'Cancel'); act(() => listeners.beforeRemove({ preventDefault: () => { prevented = true; }, data: { action: 'X' } }));
check('no prompt when not dirty', !prevented);
// wizard note + recalibrate
mk({ lastCalibratedAt: new Date(2026, 9, 20, 12).toISOString(), bandFilterEnabled: true });
act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); t = texts(r.root);
check('wizard note (legacy, no source)', t.includes('Last set by the calibration wizard on Oct 20, 2026') && t.includes('Recalibrate'));
press(r.root, 'Recalibrate'); check('opens wizard', navLog.some(x => x[0] === 'calibration' && x[1].fromWelcome === false));
mk({ calibrationSource: 'wizard', calibrationSetAt: new Date(2026, 9, 25, 12).toISOString(), calibrationPeakHeld: false, bandFilterEnabled: true });
act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
check('brief peak note', texts(r.root).includes('Last set by the calibration wizard on Oct 25, 2026, from a brief peak.'));
mk({ calibrationSource: 'default', calibrationSetAt: new Date(2026, 9, 25, 12).toISOString() });
act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
check('default note', texts(r.root).includes('Using the default values (chosen on Oct 25, 2026).') && texts(r.root).split(' | ').includes('Calibrate') && !texts(r.root).includes('Open Calibration'));
// format-only change -> no confirm
mk({ fullScaleG: 1 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
press(r.root, 'Edit values'); type(r.root, 'Full scale range', '1'); globalThis.__alerts = []; press(r.root, 'Save');
check('format-only change exits without confirm', globalThis.__alerts.length === 0 && updates.length === 0 && r.root.findAll(n => n.type === 'TextInput').length === 0);

// main settings
mk({ fullScaleG: 1, bandFilterEnabled: true, sonificationVoice: 'custom', customTonalRangeMinHz: 200, customTonalRangeMaxHz: 700 });
act(() => { r = TR.create(React.createElement(SettingsScreen)); }); t = texts(r.root);
check('main menu', t.includes('Calibration | 1.00 g full scale · band filtering on') && t.includes('Sonification | Custom · 200–700 Hz') && t.includes('SteadyPoint Version 1.2'), t);
check('main: no old sections', !/Full-scale range|Tremor Measurement|Tonal Range|preset|sensitivity/i.test(t));
press(r.root, 'Calibration'); press(r.root, 'Sonification');
check('main nav', navLog.some(x => x[0] === 'calibrationSettings') && navLog.some(x => x[0] === 'sonificationSettings'));
mk({ sonificationVoice: 'viola' }); act(() => { r = TR.create(React.createElement(SettingsScreen)); }); check('voice summary', texts(r.root).includes('Sonification | Viola'));
// sonification page
mk({ sonificationVoice: 'cello', customTonalRangeMinHz: 200, customTonalRangeMaxHz: 700 });
act(() => { r = TR.create(React.createElement(SonificationSettingsScreen)); }); t = texts(r.root);
check('sonification page', t.includes('Sonification') && t.includes('Tonal Range') && t.includes('Cello') && t.includes('Custom'));
press(r.root, 'Viola'); check('voice select saves', updates.some(u => u.sonificationVoice === 'viola'));
press(r.root, '← | Settings'); check('back button', navLog[navLog.length - 1][0] === 'back');
// ---- FORTY-FOURTH follow-up: Pitch follows ----
mk({ sonificationVoice: 'cello' });
act(() => { r = TR.create(React.createElement(SonificationSettingsScreen)); }); t = texts(r.root);
check('pitch follows card, intensity default', t.includes('Pitch follows') && t.includes('Volume always follows your tremor') && t.includes('Stronger tremor plays a higher note.') && !t.includes('full range of notes'), t.slice(0, 400));
const pm = (label) => r.root.findAll((n) => n.type === 'Pressable' && n.props.accessibilityState && texts({ findAll: (f) => n.findAll(f) }).trim() === label)[0];
check('intensity selected', pm('Intensity').props.accessibilityState.selected === true && pm('Frequency').props.accessibilityState.selected === false);
press(r.root, 'Frequency'); check('frequency saved', updates.some((u) => u.sonificationMode === 'frequency'));
mk({ sonificationVoice: 'cello', sonificationMode: 'frequency', bandFilterEnabled: true, tremorBandMinHz: 4.5, tremorBandMaxHz: 9 });
act(() => { r = TR.create(React.createElement(SonificationSettingsScreen)); }); t = texts(r.root);
check('frequency text with band', t.includes('Faster tremor plays a higher note.') && t.includes('The full range of notes spans your tremor band (4.5–9.0 Hz).'), t.slice(0, 500));
mk({ sonificationMode: 'frequency', bandFilterEnabled: false });
act(() => { r = TR.create(React.createElement(SonificationSettingsScreen)); });
check('frequency text without band', texts(r.root).includes('spans 3–14 Hz (band filtering is off).'));
mk({ sonificationVoice: 'viola', sonificationMode: 'frequency' });
act(() => { r = TR.create(React.createElement(SettingsScreen)); });
check('main summary shows mode', texts(r.root).includes('Sonification | Viola · pitch follows frequency'));
mk({ sonificationVoice: 'viola' });
act(() => { r = TR.create(React.createElement(SettingsScreen)); });
check('main summary intensity unchanged', texts(r.root).includes('Sonification | Viola') && !texts(r.root).includes('pitch follows'));
// ---- FORTY-NINTH follow-up: upper intensity limit ----
check('validateCeiling off', JSON.stringify(L.validateCeiling('', false, 0.006)) === '{"value":null,"error":null}');
check('validateCeiling ok', L.validateCeiling('0.5', true, 0.006).value === 0.5 && L.validateCeiling('.123', true, 0.006).value === 0.12);
check('validateCeiling errors', L.validateCeiling('', true, 0.006).error === 'Enter a value' && L.validateCeiling('x', true).error === 'Enter a number' && /between/.test(L.validateCeiling('5', true).error) && L.validateCeiling('0.01', true, 0.02).error === 'Must be above the noise floor');
check('stepCeiling', L.stepCeiling('0.35', 1) === '0.36' && L.stepCeiling('0.01', -1) === '0.01' && L.stepCeiling('', 1) === '0.01');
check('formatCeiling', L.formatCeiling(null) === 'Off' && L.formatCeiling(0.5) === '0.50 g');
check('defaultCeilingEntry = full scale', L.defaultCeilingEntry({ fullScaleG: 0.8 }) === '0.80' && L.defaultCeilingEntry({}) === '0.35');
check('describeChanges ceiling', L.describeChanges(set0, { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14 }, false, 0.5).ceiling === true
  && L.describeChanges({ ...set0, intensityCeilingG: 0.5 }, { fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14 }, false, 0.5).ceiling === false);
check('confirmation line for ceiling', confirmationLines('session', { scale: false, band: false, ceiling: true }).join(' ').includes('The upper limit only changes the sound'));
mk({}); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); t = texts(r.root);
check('view: upper limit Off', t.includes('Upper limit | Off'), t.slice(0, 600));
press(r.root, 'Edit values');
const sws = () => r.root.findAll((n) => n.type === 'Switch');
check('editor: ceiling switch off, no ceiling input', sws().length === 2 && sws()[1].props.value === false && !input(r.root, 'Upper limit'));
act(() => sws()[1].props.onValueChange(true));
check('switch on: input starts at full scale, save enabled', input(r.root, 'Upper limit').props.value === '0.35' && saveBtn().props.disabled === false);
press(r.root, 'Increase Upper limit'); check('ceiling stepper', input(r.root, 'Upper limit').props.value === '0.36');
type(r.root, 'Upper limit', '0.003'); t = texts(r.root);
check('ceiling error disables save', t.includes('Must be') && saveBtn().props.disabled === true, t.slice(-600));
type(r.root, 'Upper limit', '0.5');
globalThis.__alerts = []; press(r.root, 'Save'); const a2 = globalThis.__alerts[0];
check('ceiling confirm text', a2 && a2[1].includes('The upper limit only changes the sound'), JSON.stringify(a2));
act(() => a2[2][1].onPress());
check('ceiling saved', updates[0].intensityCeilingG === 0.5 && updates[0].fullScaleG === 0.35, JSON.stringify(updates[0]));
mk({ intensityCeilingG: 0.5 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); t = texts(r.root);
check('view: upper limit value', t.includes('Upper limit | 0.50 g'));
press(r.root, 'Edit values');
check('editor starts from saved ceiling', sws()[1].props.value === true && input(r.root, 'Upper limit').props.value === '0.50' && saveBtn().props.disabled === true);
act(() => sws()[1].props.onValueChange(false)); globalThis.__alerts = []; press(r.root, 'Save'); act(() => globalThis.__alerts[0][2][1].onPress());
check('turning it off saves null', updates[0].intensityCeilingG === null, JSON.stringify(updates[0]));
mk({ intensityCeilingG: 0.5 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); press(r.root, 'Edit values');
press(r.root, 'Restore defaults'); check('restore defaults turns the limit off', sws()[1].props.value === false);

// ---------- SIXTY-FOURTH follow-up: noise floor up to 0.100 g; Disable Guardrails ----------
const G = { guardrailsDisabled: true };
const fs4 = { ...good, fullScaleG: '4.00' };
check('guarded: floor max 0.100', L.validateCalibration({ ...fs4, noiseFloorG: '0.100' }).valid && L.validateCalibration({ ...fs4, noiseFloorG: '0.101' }).errors.noiseFloorG === 'Must be between 0.000 – 0.100 g', L.validateCalibration({ ...fs4, noiseFloorG: '0.101' }).errors.noiseFloorG);
check('guarded: 0.060 now allowed (was over 0.050)', L.validateCalibration({ ...good, fullScaleG: '1.00', noiseFloorG: '0.060' }).valid);
check('guarded: 0.100 at full scale 1.00 allowed (65th)', L.validateCalibration({ ...good, fullScaleG: '1.00', noiseFloorG: '0.100' }).valid && L.validateCalibration({ ...good, fullScaleG: '0.99', noiseFloorG: '0.100' }).errors.noiseFloorG === 'Must be at most 10% of full scale (0.099 g or less)', L.validateCalibration({ ...good, fullScaleG: '0.99', noiseFloorG: '0.100' }).errors.noiseFloorG);
check('guarded: 0.100 is still the cap above 1.00 g', L.validateCalibration({ ...good, fullScaleG: '2.00', noiseFloorG: '0.101' }).errors.noiseFloorG === 'Must be between 0.000 – 0.100 g');
check('guarded hint + step cap', L.rangeHint('noiseFloorG') === '0.000 – 0.100 g' && L.stepEntry('noiseFloorG', '0.100', 1) === '0.100' && L.stepEntry('noiseFloorG', 'x', -1) === '0.100');
check('unguarded: up to 0.400 at full scale 4.00', L.validateCalibration({ ...fs4, noiseFloorG: '0.400' }, G).valid && L.validateCalibration({ ...fs4, noiseFloorG: '0.401' }, G).errors.noiseFloorG === 'Must be between 0.000 – 0.400 g');
check('unguarded: up to and including 10% of full scale', L.validateCalibration({ ...good, fullScaleG: '2.00', noiseFloorG: '0.200' }, G).valid && L.validateCalibration({ ...good, fullScaleG: '2.00', noiseFloorG: '0.201' }, G).errors.noiseFloorG === 'Must be at most 10% of full scale (0.200 g or less)', L.validateCalibration({ ...good, fullScaleG: '2.00', noiseFloorG: '0.201' }, G).errors.noiseFloorG);
check('unguarded hint + step', L.rangeHint('noiseFloorG', G) === '0.000 – 0.400 g' && L.stepEntry('noiseFloorG', '0.100', 1, G) === '0.101' && L.stepEntry('noiseFloorG', '0.400', 1, G) === '0.400');
check('other limits unchanged by guardrails', L.validateCalibration({ ...good, fullScaleG: '4.01' }, G).errors.fullScaleG && L.validateCalibration({ ...good, tremorBandMinHz: '7.1' }, G).errors.tremorBandMinHz);
check('setting read', L.guardrailsDisabled({ calibrationGuardrailsDisabled: true }) === true && L.guardrailsDisabled({}) === false && L.guardrailsDisabled(undefined) === false);
check('re-enable: min(floor, 0.100)', L.noiseFloorWithGuardrails({ fullScaleG: 4, noiseFloorG: 0.3 }) === 0.1 && L.noiseFloorWithGuardrails({ fullScaleG: 4, noiseFloorG: 0.08 }) === null && L.noiseFloorWithGuardrails({ fullScaleG: 4, noiseFloorG: 0.1 }) === null);
check('re-enable: exactly min(floor, 0.100) (65th)', L.noiseFloorWithGuardrails({ fullScaleG: 0.5, noiseFloorG: 0.05 }) === null && L.noiseFloorWithGuardrails({ fullScaleG: 1, noiseFloorG: 0.1 }) === null && L.noiseFloorWithGuardrails({ fullScaleG: 2, noiseFloorG: 0.2 }) === 0.1);
check('re-enable result is valid with guardrails on', [[4, 0.4], [1, 0.1], [0.5, 0.05], [0.1, 0.01], [3.3, 0.33]].every(([fs, nf]) => { const n = L.noiseFloorWithGuardrails({ fullScaleG: fs, noiseFloorG: nf }) ?? nf; return L.validateCalibration({ ...good, fullScaleG: fs.toFixed(2), noiseFloorG: n.toFixed(3) }).valid; }));

for (const os of ['ios', 'android']) {
  globalThis.__os = os; const P = os + ': ';
  const gsw = () => r.root.findAll((n) => n.type === 'Switch' && n.props.accessibilityLabel === 'Disable Guardrails')[0];
  mk({}); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); let tx = texts(r.root);
  check(P + 'switch at the bottom, off by default', gsw() && gsw().props.value === false && tx.indexOf('ADVANCED') > tx.indexOf('Share Calibration Log') && tx.includes('Off: noise floor up to 0.100 g and at most 10% of full scale.'), tx.slice(-300));
  globalThis.__alerts = []; press(r.root, 'About Disable Guardrails');
  check(P + 'info button explains', globalThis.__alerts[0][0] === 'Disable Guardrails' && globalThis.__alerts[0][1].includes('up to 0.100 g') && globalThis.__alerts[0][1].includes('0.400 g') && globalThis.__alerts[0][1].includes('hide a mild tremor'));
  act(() => gsw().props.onValueChange(true));
  check(P + 'turning on saves right away, floor untouched', updates.length === 1 && updates[0].calibrationGuardrailsDisabled === true && !('noiseFloorG' in updates[0]), JSON.stringify(updates));
  press(r.root, 'Edit values');
  check(P + 'switch hidden while editing', !gsw());
  // editor follows the saved setting
  mk({ calibrationGuardrailsDisabled: true, fullScaleG: 4 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
  tx = texts(r.root);
  check(P + 'on: caption', gsw().props.value === true && tx.includes('On: noise floor can be up to 10% of full scale (at most 0.400 g).'));
  press(r.root, 'Edit values'); type(r.root, 'Noise floor', '0.400'); tx = texts(r.root);
  check(P + 'editor: 0.400 allowed with guardrails disabled', tx.includes('Allowed: 0.000 – 0.400 g') && !tx.includes('Must be'), tx);
  mk({ fullScaleG: 4 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); press(r.root, 'Edit values'); type(r.root, 'Noise floor', '0.400'); tx = texts(r.root);
  check(P + 'editor: 0.400 refused with guardrails on', tx.includes('Must be between 0.000 – 0.100 g'), tx);
  mk({ fullScaleG: 1 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); }); press(r.root, 'Edit values'); type(r.root, 'Noise floor', '0.100'); tx = texts(r.root);
  check(P + 'editor (guardrails on): 0.100 at full scale 1.00 accepted', !tx.includes('Must be') && tx.includes('Allowed: 0.000 – 0.100 g'), tx);
  // turning guardrails back on: lowers the floor after asking
  mk({ calibrationGuardrailsDisabled: true, fullScaleG: 4, noiseFloorG: 0.25 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
  globalThis.__alerts = []; act(() => gsw().props.onValueChange(false));
  const ga = globalThis.__alerts[0];
  check(P + 're-enable asks first, nothing saved yet', ga && ga[0] === 'Turn guardrails back on?' && ga[1].includes('from 0.250 g to 0.100 g') && updates.length === 0, ga && ga[1]);
  act(() => ga[2][1].onPress());
  check(P + 're-enable saves floor 0.100 + guardrails on', updates[0].calibrationGuardrailsDisabled === false && updates[0].noiseFloorG === 0.1 && updates[0].calibrationSource === 'manual' && !!updates[0].calibrationSetAt, JSON.stringify(updates[0]));
  mk({ calibrationGuardrailsDisabled: true, fullScaleG: 4, noiseFloorG: 0.25 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
  globalThis.__alerts = []; act(() => gsw().props.onValueChange(false)); act(() => globalThis.__alerts[0][2][0].onPress?.());
  check(P + 're-enable cancelled: nothing changes', updates.length === 0);
  mk({ calibrationGuardrailsDisabled: true, fullScaleG: 4, noiseFloorG: 0.08 }); act(() => { r = TR.create(React.createElement(CalibrationSettingsScreen)); });
  globalThis.__alerts = []; act(() => gsw().props.onValueChange(false));
  check(P + 're-enable with floor ≤ 0.100: no question, floor kept', globalThis.__alerts.length === 0 && updates.length === 1 && updates[0].calibrationGuardrailsDisabled === false && !('noiseFloorG' in updates[0]), JSON.stringify(updates));
  const ib = r.root.findAll((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'About Disable Guardrails')[0];
  check(P + 'info button: 44 pt+ target, labelled', ib.props.accessibilityRole === 'button' && ib.props.hitSlop >= 11);
}
globalThis.__os = 'ios';
console.log(`${ok} passed, ${fail} failed`);
