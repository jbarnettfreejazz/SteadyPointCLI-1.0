// Integration: real liveSession + sessionLogic + sessionRecord + checkpoint; fake clock/timers/storage.
let NOW = Date.UTC(2026, 9, 23, 18, 0, 0); const realDateNow = Date.now; Date.now = () => NOW;
const intervals = new Map(); let nextId = 1;
globalThis.setInterval = (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms }); return id; };
globalThis.clearInterval = (id) => { intervals.delete(id); };
const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, 0);
import { build } from 'esbuild';
const ST = new URL('./stubs8.js', import.meta.url).pathname, AM = new URL('./asmock.js', import.meta.url).pathname;
const plugin = { name: 'p8', setup(b) {
  b.onResolve({ filter: /^(react-native|\.\/ble|\.\/audio|\.\/guideTrackPlayer|\.\/guideAudioPicker|\.\/persistence|\.\/sessionService)$/ }, () => ({ path: ST }));
  b.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: AM }));
} };
await build({ entryPoints: ['entry8.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out8.mjs', plugins: [plugin], logLevel: 'error' });
const M = await import('./out8.mjs'); const { logic, live, cp, dsp, SR, appReducer, buildInitialState, T, AS } = M;
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const flushQ = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => realSetTimeout(r, 0)); };

let state = { ...buildInitialState('real'), isConnected: true };
const d = (a) => { state = appReducer(state, a); };
const actions = {
  setSetupMode: (mode) => d({ type: T.SET_SETUP_MODE, mode }), setEditingPinnedId: (id) => d({ type: T.SET_EDITING_PINNED_ID, id }),
  updateConfig: (patch) => d({ type: T.UPDATE_CONFIG, patch }), setGuideMedia: (source, name, path) => d({ type: T.SET_GUIDE_MEDIA, source, name, path }),
  clearGuideMedia: () => d({ type: T.CLEAR_GUIDE_MEDIA }), addPinnedSession: (session) => d({ type: T.ADD_PINNED_SESSION, session }),
  updatePinnedSession: (id, patch) => d({ type: T.UPDATE_PINNED_SESSION, id, patch }),
  setResults: (results) => d({ type: T.SET_RESULTS, results }), addSession: (session) => d({ type: T.ADD_SESSION, session }),
  updateSession: (id, patch) => d({ type: T.UPDATE_SESSION, id, patch }), updateSettings: (patch) => d({ type: T.UPDATE_SETTINGS, patch }), setScoreAnim: () => {},
};
const navLog = []; const nav = { navigate: (r) => navLog.push(r), canGoBack: () => true, goBack() {} };
const metricsFn = () => [...intervals.values()].find((i) => i.ms === 300)?.fn;
const elapsedFn = () => [...intervals.values()].find((i) => i.ms === 1000)?.fn;
const checkpointFn = () => [...intervals.values()].find((i) => i.ms === 60000)?.fn;
let tPkt = 0;
// run `secs` of 6 Hz motion of amplitude amp g (+ gravity on y)
function run(secs, amp) {
  const ticks = Math.round(secs / 0.3);
  for (let k = 0; k < ticks; k++) {
    for (let j = 0; j < 15; j++, tPkt++) { const s = tPkt / 50; const v = amp * Math.sin(2 * Math.PI * 6 * s); live.pushPacket(v, 1 + v * 0.5, v * 0.2); }
    NOW += 300; metricsFn()?.(); if (k % 3 === 2) elapsedFn()?.();
  }
  NOW += 100; elapsedFn()?.();
}
const storedKeys = () => [...AS._store.keys()].sort();

// ---- 1. continuous session with a mid-session full-scale change ----
state.settings = { ...state.settings, fullScaleG: 0.35, noiseFloorG: 0.006, bandFilterEnabled: false };
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
const startMs = NOW;
check('navigated to recording', navLog.at(-1) === 'recording');
run(60, 0.12);
checkpointFn()?.(); await flushQ();
let meta = JSON.parse(AS._store.get('sp_activeSession'));
check('checkpoint written', meta.status === 'recording' && meta.chunkCount >= 1 && meta.savedReadings > 150 && AS._store.has('sp_activeChunk_0'), JSON.stringify({ s: meta.status, c: meta.chunkCount, r: meta.savedReadings }));
check('no raw buffer kept', (live.getLiveState().sessionBuffer || []).length === 0 && live.getLiveState().packetCount > 2500);
logic.noteFeedbackType('both');
const changed = logic.applyCalibrationDuringSession({ fullScaleG: 1, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, bandFilterEnabled: false });
check('apply returns changed + segment', changed && live.getRecording().segments.length === 2 && live.getRecording().segments[1].fullScaleG === 1);
// FORTY-NINTH follow-up: upper limit applied in-session; segment unaffected
const segBefore = live.getRecording().segments.length;
const ch2 = logic.applyCalibrationDuringSession({ fullScaleG: 1, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, bandFilterEnabled: false, intensityCeilingG: 0.5 });
check('ceiling applied in-session, no new segment', live.getIntensityCeilingG() === 0.5 && ch2 === false && live.getRecording().segments.length === segBefore);
logic.applyCalibrationDuringSession({ fullScaleG: 1, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, bandFilterEnabled: false, intensityCeilingG: null });
check('ceiling cleared in-session', live.getIntensityCeilingG() === null);
check('live intensity now on 1 g', (() => { run(3, 0.12); return live.getLiveState().tremorLevel < 20; })(), live.getLiveState().tremorLevel);
run(57, 0.12);
const g = [...live.getRecording().rmsTraceG];
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed });
let rec = state.allSessions[0];
const expMed = Math.round(M.I.median(g.map((v) => dsp.rmsToLevel(v, 1, 0.006))));
check('record on final scale', rec.fullScaleG === 1 && rec.medianIntensity === expMed, `${rec.medianIntensity} vs ${expMed}`);
check('record events', rec.events.length === 1 && rec.events[0].kind === 'scale' && Math.abs(rec.events[0].atSec - 60) <= 2, JSON.stringify(rec.events));
check('start time + date', rec.startedAt === new Date(startMs).toISOString() && rec.dateKey === SR.dayKeyOf(startMs) && rec.time === SR.timeOfDay(startMs) && rec.isContinuous && rec.feedbackType === 'both');
check('elapsed + duration', Math.abs(rec.elapsedSec - 120) <= 2 && rec.duration === 2, rec.elapsedSec);
check('trace length', rec.intensityTrace.length === Math.ceil(g.length / 3) && rec.rmsPeakTraceG.length === rec.intensityTrace.length, rec.intensityTrace.length);
check('summary results', state.results.sessionId === rec.id && state.results.events.length === 1);
await flushQ();
meta = JSON.parse(AS._store.get('sp_activeSession'));
check('checkpoint finished', meta.status === 'finished' && meta.sessionId === rec.id);
await cp.onSessionPersisted(); await flushQ();
check('checkpoint cleared after save', storedKeys().length === 0, storedKeys());

// ---- 2. timed session, disconnect, resume ----
globalThis.__svc = []; // FIFTY-FIFTH follow-up: session service calls
state.settings = { ...state.settings, fullScaleG: 0.35, bandFilterEnabled: false };
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'meditative', feedbackType: 'visual', duration: 10, activityNote: '' } } });
run(60, 0.05);
const before = state.allSessions.length;
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed, disconnected: true });
await flushQ();
const dRec = state.allSessions[0];
check('disconnected record saved', state.allSessions.length === before + 1 && dRec.endReason === 'disconnected' && navLog.at(-1) === 'disconnected');
meta = JSON.parse(AS._store.get('sp_activeSession'));
check('checkpoint kept as disconnected', meta.status === 'disconnected' && meta.sessionId === dRec.id && meta.disconnectedAtMs === NOW);
NOW += 4 * 60 * 1000;
let offer = await logic.getResumableSession();
check('resume offered within window', offer && offer.minutesAgo === 4 && !offer.isContinuous);
state.settings = { ...state.settings, bandFilterEnabled: true, tremorBandMinHz: 4, tremorBandMaxHz: 8 }; // changed while disconnected
const ok2 = await logic.resumeSession({ state, actions, navigation: nav });
check('resumed', ok2 && navLog.at(-1) === 'recording' && live.getLiveState().isRecording && Math.abs(live.getLiveState().elapsed - 60) <= 2);
check('resume notes band change + reconnect', live.getRecording().segments.length === 2 && live.getRecording().events.some((e) => e.kind === 'reconnect'));
run(60, 0.05);
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed });
rec = state.allSessions.find((s) => s.id === dRec.id);
check('resumed end updates same record', state.allSessions.length === before + 1 && rec.endReason === 'completed' && Math.abs(rec.elapsedSec - 121) <= 3 && rec.duration === 2, `${state.allSessions.length} ${rec.endReason} ${rec.elapsedSec}`);
check('resumed record events', rec.events.map((e) => e.kind).join() === 'band,reconnect' || rec.events.map((e) => e.kind).join() === 'reconnect,band', JSON.stringify(rec.events));
check('resumed keeps start time', rec.startedAt === dRec.startedAt && rec.tremorBandFiltered === true);
check('session service: start, stop at disconnect, start on resume, stop at end', JSON.stringify(globalThis.__svc) === JSON.stringify([['start', 10], ['stop'], ['start', 10], ['stop']]), JSON.stringify(globalThis.__svc));
await flushQ(); await cp.onSessionPersisted(); await flushQ();

// ---- 3. resume window expiry ----
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
run(40, 0.05);
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed, disconnected: true });
await flushQ();
NOW += 11 * 60 * 1000;
offer = await logic.getResumableSession(); await flushQ();
check('no offer after window, checkpoint cleared', offer === null && storedKeys().length === 0, storedKeys());
// decline
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
run(40, 0.05);
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed, disconnected: true });
await flushQ(); await logic.declineResume(); await flushQ();
check('decline clears', storedKeys().length === 0 && (await logic.getResumableSession()) === null);

// ---- 4. app closed mid-session -> recovered at launch ----
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
const crashStart = NOW;
run(130, 0.1);
checkpointFn()?.(); await flushQ();
run(20, 0.1); // not checkpointed — lost with the app
const saved = state.allSessions; const nid = state.todaySessionNextId;
cp._resetForTests(); // the app is gone: in-memory checkpoint state lost
let recov = await logic.recoverOnLaunch({ allSessions: saved, todaySessionNextId: nid }); await flushQ();
const ir = recov.allSessions[0];
check('recovered interrupted session', recov.changed && ir.id === nid && recov.todaySessionNextId === nid + 1 && ir.endReason === 'interrupted' && ir.statusMessage.includes('closed unexpectedly'), JSON.stringify({ id: ir.id, r: ir.endReason }));
check('recovered up to last checkpoint', Math.abs(ir.elapsedSec - 130) <= 2 && ir.startedAt === new Date(crashStart).toISOString() && ir.intensityValid, ir.elapsedSec);
check('checkpoint cleared after recovery', storedKeys().length === 0);
recov = await logic.recoverOnLaunch({ allSessions: recov.allSessions, todaySessionNextId: recov.todaySessionNextId });
check('nothing to recover twice', !recov.changed);
live.stopTimers(); live.stopRecordingBuffers();

// ---- 5. finished but the session list save never happened ----
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'active', feedbackType: 'visual', duration: 5, activityNote: '' } } });
run(45, 0.08);
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed });
await flushQ();
const lost = state.allSessions[0];
recov = await logic.recoverOnLaunch({ allSessions: state.allSessions.slice(1), todaySessionNextId: state.todaySessionNextId - 1 });
check('finished-but-unsaved rebuilt', recov.changed && recov.allSessions[0].id === lost.id && recov.allSessions[0].endReason === 'completed' && recov.allSessions[0].medianIntensity === lost.medianIntensity, JSON.stringify([recov.allSessions[0].id, lost.id]));

// ---- 6. demo mode: no checkpoint ----
state.appMode = 'demo';
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
run(10, 0.05); checkpointFn()?.(); await flushQ();
check('demo: nothing stored', storedKeys().length === 0, storedKeys());
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed });
state.appMode = 'real';

// ---- 7. long session: memory flat-ish, trace sliced, peaks kept ----
logic.startSession({ state, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
for (let m = 0; m < 180; m++) { run(60, m % 30 === 0 ? 0.3 : 0.05); checkpointFn()?.(); await flushQ(); }
await flushQ();
meta = JSON.parse(AS._store.get('sp_activeSession'));
check('3 h: chunks written each minute', meta.chunkCount >= 170, meta.chunkCount);
logic.endSession({ state, actions, navigation: nav, secs: live.getLiveState().elapsed });
rec = state.allSessions[0];
check('3 h: 600-point trace with peaks', rec.intensityTrace.length === 600 && rec.rmsPeakTraceG.length === 600 && rec.rmsPeakTraceG.every((p, i) => p >= rec.rmsTraceG[i] - 1e-9) && rec.rmsPeakTraceG.some((p, i) => p > rec.rmsTraceG[i] + 1e-4), rec.intensityTrace.length);
check('3 h: duration', rec.duration >= 180 && rec.duration <= 182, rec.duration);
await flushQ(); await cp.onSessionPersisted(); await flushQ();
check('3 h: checkpoint cleared', storedKeys().length === 0, storedKeys().length);

// FIFTY-FIFTH follow-up: demo mode (no device) doesn't start the session service
globalThis.__svc = [];
const demoState = { ...state, appMode: 'demo' };
logic.startSession({ state: demoState, actions, navigation: nav, origin: 'quickStart', overrides: { config: { activityType: 'engaged', feedbackType: 'visual', duration: null, activityNote: '' } } });
run(5, 0.05);
logic.endSession({ state: demoState, actions, navigation: nav, secs: live.getLiveState().elapsed });
await flushQ();
check('demo mode: no service start; stop is harmless', JSON.stringify(globalThis.__svc) === '[["stop"]]', JSON.stringify(globalThis.__svc));
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
