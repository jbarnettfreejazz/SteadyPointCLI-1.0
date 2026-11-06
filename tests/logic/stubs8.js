export const sendCommand = (c) => { (globalThis.__cmds = globalThis.__cmds || []).push(c); };
export const setPitchMode = () => {}, setPitchRange = () => {};
export const silenceAudio = () => {}, setActiveVoice = () => {}, setCustomTonalRange = () => {}, unmuteAudio = () => {}, stopGuideTrack = () => {};
export const deleteGuideAudioFile = async () => {};
export const persistSave = async () => {};
export const Alert = { alert: (...a) => { (globalThis.__alerts = globalThis.__alerts || []).push(a); } };
export const AppState = { addEventListener: () => ({ remove() {} }), currentState: 'active' };

// FIFTY-FIFTH follow-up: session foreground service calls, recorded
export const startSessionService = (config) => { (globalThis.__svc = globalThis.__svc || []).push(['start', config && config.duration]); return Promise.resolve(true); };
export const stopSessionService = () => { (globalThis.__svc = globalThis.__svc || []).push(['stop']); return Promise.resolve(true); };
// FIFTY-EIGHTH follow-up: call handling, recorded
export const setCallMuted = (on) => { (globalThis.__call = globalThis.__call || []).push(['mute', !!on]); };
export const pauseGuideTrackForCall = () => { (globalThis.__call = globalThis.__call || []).push(['guidePause']); };
export const resumeGuideTrackAfterCall = () => { (globalThis.__call = globalThis.__call || []).push(['guideResume']); };
export const onCallStateChange = (h) => { globalThis.__callHandler = h; };
