export const alerts = []; export const persisted = []; export const deleted = [];
export const Alert = { alert: (...a) => alerts.push(a) };
export function persistSave(s) { persisted.push(s); return Promise.resolve(); }
export function deleteGuideAudioFile(p) { deleted.push(p); return Promise.resolve(); }
const noop = () => {}; export const setPitchMode = (m, lo, hi) => { globalThis.__pitch = { m, lo, hi }; }, setPitchRange = (lo, hi) => { globalThis.__pitchRange = { lo, hi }; };
export const sendCommand = noop, silenceAudio = noop, setActiveVoice = noop, setCustomTonalRange = noop, unmuteAudio = noop, stopGuideTrack = noop;
export const rmsOf = () => 0, rmsToLevel = () => 0, downsampleTrace = (x) => x;
export const setFullScaleG = noop, setTremorBand = (a, b, on) => { globalThis.__bandOn = on; }, beginSessionBuffers = noop, startTimers = noop, stopTimers = noop, stopRecordingBuffers = () => globalThis.__rec || ({ rmsTraceG: [], rmsAllTraceG: [], segments: [{ i: 0, atSec: 0, fullScaleG: 1, noiseFloorG: 0.02, tremorBandMinHz: 3, tremorBandMaxHz: 14, tremorBandFiltered: false }], events: [], packetCount: 0, elapsed: 0, liveFreqHz: globalThis.__liveFreq ?? 5 }), getFullScaleG = () => 1, setNoiseFloorG = (v) => { globalThis.__nf = v; }, getNoiseFloorG = () => 0.02, getTremorBand = () => ({}), setIntensityCeilingG = (v) => { globalThis.__ceiling = v; }, getIntensityCeilingG = () => globalThis.__ceiling ?? null;
export const setAudioHook = () => {}, getLiveState = () => ({ liveFreqHz: globalThis.__liveFreq ?? 5 });

export const getRecording = () => ({ rmsTraceG: [], rmsAllTraceG: [], segments: [], events: [], packetCount: 0, elapsed: 0, liveFreqHz: 0 }), applyCalibration = () => false, restoreRecording = noop, addSessionEvent = noop;
export const AppState = { addEventListener: () => ({ remove() {} }), currentState: 'active' };

// FIFTY-FIFTH follow-up: session foreground service calls, recorded
export const startSessionService = (config) => { (globalThis.__svc = globalThis.__svc || []).push(['start', config && config.duration]); return Promise.resolve(true); };
export const stopSessionService = () => { (globalThis.__svc = globalThis.__svc || []).push(['stop']); return Promise.resolve(true); };
// FIFTY-EIGHTH follow-up: call handling, recorded
export const setCallMuted = (on) => { (globalThis.__call = globalThis.__call || []).push(['mute', !!on]); };
export const pauseGuideTrackForCall = () => { (globalThis.__call = globalThis.__call || []).push(['guidePause']); };
export const resumeGuideTrackAfterCall = () => { (globalThis.__call = globalThis.__call || []).push(['guideResume']); };
export const onCallStateChange = (h) => { globalThis.__callHandler = h; };
