// SIXTY-SECOND follow-up: the reading states behind the Simple / Advanced
// views (src/utils/sessionReading.js) — pure logic, identical on iOS and
// Android. Every state the design shows, plus the edge cases agreed in chat:
// upper limit, band filtering off, waiting for data.
import { build } from 'esbuild';
await build({ entryPoints: ['../../src/utils/sessionReading.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outReading.mjs', logLevel: 'error' });
const R = await import('./outReading.mjs');
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };

const BAND = R.readingWindow({ bandFilterEnabled: true, tremorBandMinHz: 4, tremorBandMaxHz: 8, noiseFloorG: 0.006, fullScaleG: 0.35 });
const live = (o) => ({ mapTrail: [{}], displayLevel: 34, displayG: 0.041, liveSev: 'Mild', ...o });

// view setting
check('view default simple', R.sessionViewOf({}) === 'simple' && R.sessionViewOf(undefined) === 'simple' && R.sessionViewOf({ sessionView: 'bogus' }) === 'simple');
check('view advanced remembered', R.sessionViewOf({ sessionView: 'advanced' }) === 'advanced');

// window
check('band on', BAND.bandOn && BAND.minHz === 4 && BAND.maxHz === 8 && BAND.ceilingG === null);
check('band off when filter off', R.readingWindow({ bandFilterEnabled: false, tremorBandMinHz: 4, tremorBandMaxHz: 8 }).bandOn === false);
check('defaults', JSON.stringify(R.readingWindow({})) === JSON.stringify({ bandOn: false, minHz: 3, maxHz: 14, noiseFloorG: 0.006, fullScaleG: 0.35, ceilingG: null }));

// (i) in zone — design page 1
let d = R.describeReading(live({ pitchFreqHz: 4.7, actualFreqHz: 4.7, liveRmsG: 0.041, liveRmsAllG: 0.05 }), BAND);
check('zone kind', d.kind === 'zone');
check('zone row1 blue', d.row1.text === '4.7 Hz · .041 g · intensity 34' && d.row1.tone === 'info', d.row1.text);
check('zone row2', d.row2 === 'inside your tremor zone (4–8 Hz)', d.row2);
check('zone circle + label', d.circle.text === '34' && d.circle.tone === 'level' && d.label.text === 'Mild' && d.subline === '34% (.041g) intensity');
check('zone simple line', d.simple.text === 'Inside your tremor zone (4–8 Hz)' && d.simple.tone === 'info');
check('half-Hz band edges', R.describeReading(live({ pitchFreqHz: 5, liveRmsG: 0.04 }), { ...BAND, minHz: 4.5 }).row2 === 'inside your tremor zone (4.5–8 Hz)');
check('zone never shows 0 while easing up', R.describeReading(live({ pitchFreqHz: 5, liveRmsG: 0.04, displayLevel: 0 }), BAND).circle.text === '1');

// (ii) above 100 — design page 2
d = R.describeReading(live({ pitchFreqHz: 5.6, actualFreqHz: 5.6, liveRmsG: 0.48, liveRmsAllG: 0.5, displayLevel: 100, displayG: 0.48, liveSev: 'High' }), BAND);
check('over kind', d.kind === 'over');
check('over row1 red', d.row1.text === '5.6 Hz · .48 g · intensity 100 (max)' && d.row1.tone === 'danger', d.row1.text);
check('over row2', d.row2 === 'above your level 100 — still counts as 100');
check('over circle + label', d.circle.text === '100' && d.circle.tone === 'danger' && d.label.text === 'High' && d.label.tone === 'danger' && d.subline === '>100% (.48g) intensity', d.subline);
check('exactly full scale counts as over', R.describeReading(live({ pitchFreqHz: 5, liveRmsG: 0.35 }), BAND).kind === 'over');

// (iii) below threshold — design page 3 (intensity shown as 0)
d = R.describeReading(live({ pitchFreqHz: null, actualFreqHz: 5.2, liveRmsG: 0.004, liveRmsAllG: 0.007, displayLevel: 0 }), BAND);
check('below kind', d.kind === 'below');
check('below row1 black, intensity 0 shown', d.row1.text === '5.2 Hz · .004 g · intensity 0' && d.row1.tone === 'tx1', d.row1.text);
check('below row2', d.row2 === 'below your tremor threshold — counts as 0');
check('below circle grey 0, None', d.circle.text === '0' && d.circle.tone === 'grey' && d.label.text === 'None' && d.subline === '0% (.004g) intensity');
d = R.describeReading(live({ pitchFreqHz: null, actualFreqHz: null, liveRmsG: 0.002, liveRmsAllG: 0.003, displayLevel: 0 }), BAND);
check('still device: no Hz, still below', d.kind === 'below' && d.row1.text === '.002 g · intensity 0', d.row1.text);

// (iv) out of zone — design page 4 (distance shown)
d = R.describeReading(live({ pitchFreqHz: null, actualFreqHz: 2.4, liveRmsG: 0.003, liveRmsAllG: 0.03, displayLevel: 0 }), BAND);
check('out kind', d.kind === 'out');
check('out row1: no intensity', d.row1.text === '2.4 Hz · .030 g' && d.row1.tone === 'tx1', d.row1.text);
check('out row2: distance below', d.row2 === '1.6 Hz below your tremor zone — no sound', d.row2);
check('out circle + label', d.circle.text === '—' && d.circle.tone === 'inverse' && d.label.text === 'Out of zone' && d.subline === 'Outside your frequency range · no sound');
check('out simple line', d.simple.text === '2.4 Hz · below your tremor zone', d.simple.text);
d = R.describeReading(live({ pitchFreqHz: null, actualFreqHz: 9.5, liveRmsG: 0.002, liveRmsAllG: 0.05 }), BAND);
check('out above band', d.row2 === '1.5 Hz above your tremor zone — no sound' && d.simple.text === '9.5 Hz · above your tremor zone', d.row2);
// edge spill: intensity > 0 but no in-band frequency
d = R.describeReading(live({ pitchFreqHz: null, actualFreqHz: 3.5, liveRmsG: 0.02, liveRmsAllG: 0.2, mutedReason: 'edge' }), BAND);
check('spill = out of zone with distance', d.kind === 'out' && d.row2 === '0.5 Hz below your tremor zone — no sound', d.row2);
// small in-band tremor riding on a big sway: in zone wins (it's what sounds)
d = R.describeReading(live({ pitchFreqHz: 5, actualFreqHz: 1.5, liveRmsG: 0.03, liveRmsAllG: 0.3 }), BAND);
check('in-band tremor under sway counts as in zone', d.kind === 'zone' && d.row1.text.startsWith('5.0 Hz'), d.row1.text);

// upper limit
const CEIL = { ...BAND, ceilingG: 0.2 };
d = R.describeReading(live({ pitchFreqHz: 6, liveRmsG: 0.25, displayLevel: 70, liveSev: 'High', mutedReason: 'ceiling' }), CEIL);
check('ceiling kind + text', d.kind === 'ceiling' && d.row2 === 'above your upper limit — no sound' && d.simple.text === 'Above your upper limit — no sound', d.row2);
check('ceiling beats over', R.describeReading(live({ pitchFreqHz: 6, liveRmsG: 0.5 }), CEIL).kind === 'ceiling');
check('under the limit: still zone', R.describeReading(live({ pitchFreqHz: 6, liveRmsG: 0.1 }), CEIL).kind === 'zone');

// band filtering off
const OFF = R.readingWindow({ bandFilterEnabled: false });
d = R.describeReading(live({ pitchFreqHz: 2.1, actualFreqHz: 2.1, liveRmsG: 0.05 }), OFF);
check('band off: zone, all frequencies', d.kind === 'zone' && d.row2 === 'all frequencies count (band filtering off)' && d.simple.text === 'All frequencies count', d.row2);
check('band off: never out of zone', R.describeReading(live({ pitchFreqHz: null, actualFreqHz: 1.2, liveRmsG: 0.003, liveRmsAllG: 0.04 }), OFF).kind === 'below');

// waiting
d = R.describeReading({ mapTrail: [] }, BAND);
check('waiting', d.kind === 'waiting' && d.row1.text === '—' && d.simple === null && d.circle.tone === 'empty' && d.subline === 'Waiting for device data…');

// map dots (classifyReading) agree with the text
const k = (p, w = BAND) => R.classifyReading(p, w);
check('dot zone at in-band point', JSON.stringify(k({ pf: 4.7, pg: 0.041, af: 2, ag: 0.2 })) === JSON.stringify({ kind: 'zone', hz: 4.7, g: 0.041 }));
check('dot over', k({ pf: 5.6, pg: 0.48 }).kind === 'over');
check('dot below at actual freq inside band', JSON.stringify(k({ pf: null, pg: 0.004, af: 5.2, ag: 0.007 })) === JSON.stringify({ kind: 'below', hz: 5.2, g: 0.004 }));
check('dot below without freq: not drawn', k({ pf: null, pg: 0.002, af: null, ag: 0.003 }).hz === null);
check('dot out at actual point', JSON.stringify(k({ pf: null, pg: 0.003, af: 2.4, ag: 0.03 })) === JSON.stringify({ kind: 'out', hz: 2.4, g: 0.03 }));
check('dot ceiling', k({ pf: 6, pg: 0.25 }, CEIL).kind === 'ceiling');

// g formats
check('g formats', R.fmtGSpaced(0.041) === '.041 g' && R.fmtGSpaced(0.48) === '.48 g' && R.fmtGSpaced(1.24) === '1.24 g' && R.fmtGTight(0.004) === '.004g' && R.fmtGSpaced(undefined) === '.000 g');

console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
