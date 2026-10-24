import { Alert } from 'react-native';
import * as live from '../state/liveSession';
import { sendCommand } from './ble';
import { persistSave } from './persistence';
import { silenceAudio, setActiveVoice, setCustomTonalRange, unmuteAudio } from './audio';
import { stopGuideTrack } from './guideTrackPlayer';
import { deleteGuideAudioFile } from './guideAudioPicker';
import { buildSessionRecord, RESUME_WINDOW_MIN } from '../utils/sessionRecord';
import * as checkpoint from './sessionCheckpoint';

const ICON_MAP = {
  meditative: { icon: 'brain', iconBg: 'bgInfo', iconColor: 'info' },
  engaged: { icon: 'pencil', iconBg: 'bgSuccess', iconColor: 'success' },
  active: { icon: 'walk', iconBg: 'bgWarning', iconColor: 'warning' },
};

// Custom-session edits can start from Home or from the Custom Sessions
// screen — return to whichever one the user came from.
function goBackOrHome(navigation) {
  if (navigation.canGoBack()) navigation.goBack();
  else navigation.navigate('home');
}

// TWENTY-FOURTH follow-up: where the current session was started from —
// 'setup' (Session setup → Begin session), 'quickStart' (Home templates /
// Continuous), 'custom' (a saved custom session) or 'similar' (Session
// Detail's "Start similar session"). Set by startSession(), read by
// endSession() to tag the session record and to decide whether Summary
// offers to save the setup as a custom session. Module-level because
// endSession() is called from several places with different state
// snapshots (RecordingScreen's store state, or the timer's start-time
// snapshot).
let currentSessionOrigin = { origin: 'setup', customSessionId: null, saveOffer: null };

// THIRTY-SIXTH follow-up: the running session's setup, captured when it
// starts (or resumes) — what endSession() and the checkpoint need to build
// its record. resumeOfId: the id of the saved session being continued
// after a reconnect (null for a new session). persist: false in demo mode.
let activeSession = null;

// The parts of a session's configuration a custom session stores.
function setupOf(s) {
  return {
    activityType: s.config.activityType,
    feedbackType: s.config.feedbackType,
    duration: s.config.duration,
    guideSource: s.guideMediaSource || null,
    guidePath: s.guideMediaSource === 'phone' ? s.guideMediaPath : null,
    guideName: s.guideMediaSource === 'phone' ? s.guideMediaName : '',
  };
}

// Is there already a custom session with this exact setup (regardless of
// its name)? Guide audio matches by file name — each pick copies the file
// to a new path, so paths differ even for the same audio.
export function findMatchingCustomSession(pinnedSessions, setup) {
  const soundOn = (f) => f === 'both' || f === 'audio';
  return (
    pinnedSessions.find(
      (p) =>
        p.activityType === setup.activityType &&
        soundOn(p.feedbackType) === soundOn(setup.feedbackType) &&
        (p.duration || null) === (setup.duration || null) &&
        (p.guideSource || null) === (setup.guideSource || null) &&
        (setup.guideSource !== 'phone' || (p.guideName || '') === (setup.guideName || '')),
    ) || null
  );
}

// Resets the setup form to defaults — mirrors resetSetup() in the original.
// Used by Home's "Configure new session" button.
export function resetSetupConfig(actions) {
  actions.setSetupMode('start');
  actions.setEditingPinnedId(null);
  actions.updateConfig({ feedbackType: 'both', activityType: 'meditative', activityNote: '', duration: 10, customName: '' });
  actions.clearGuideMedia();
}

// Loads a pinned session's config back into the setup form for editing —
// mirrors openSetupToEdit(id). Unlike the original (which couldn't
// persist a Blob across reloads and so always forced re-selecting the
// audio file), we restore the guide audio path directly since RN gives
// us a real, still-valid file on disk.
export function loadPinnedForEdit(state, actions, id) {
  const p = state.pinnedSessions.find((s) => s.id === id);
  if (!p) return;
  actions.setSetupMode('save');
  actions.setEditingPinnedId(id);
  actions.updateConfig({
    feedbackType: p.feedbackType,
    activityType: p.activityType,
    activityNote: '',
    duration: p.duration,
    customName: p.name,
  });
  if (p.guideSource === 'phone' && p.guidePath) {
    actions.setGuideMedia('phone', p.guideName, p.guidePath);
  } else {
    actions.clearGuideMedia();
  }
}

function buildPinnedEntry(state, existingId) {
  const name = (state.config.customName || '').trim() || (state.config.activityNote || '').trim().slice(0, 40);
  const icons = ICON_MAP[state.config.activityType] || ICON_MAP.meditative;
  return {
    ...(existingId !== null ? { id: existingId } : {}),
    name,
    feedbackType: state.config.feedbackType,
    activityType: state.config.activityType,
    duration: state.config.duration,
    guideSource: state.guideMediaSource,
    guidePath: state.guideMediaSource === 'phone' ? state.guideMediaPath : null,
    guideName: state.guideMediaSource === 'phone' ? state.guideMediaName : '',
    ...icons,
  };
}

// Mirrors savePinnedSession() — explicit "Save to Home" / "Update on Home" tap.
export async function savePinnedSession({ state, actions, navigation }) {
  const entry = buildPinnedEntry(state, state.editingPinnedId);
  let nextPinned;

  if (state.editingPinnedId !== null) {
    // If we swapped in a different audio file while editing, clean up the old one.
    const prev = state.pinnedSessions.find((s) => s.id === state.editingPinnedId);
    if (prev?.guidePath && prev.guidePath !== entry.guidePath) {
      await deleteGuideAudioFile(prev.guidePath);
    }
    actions.updatePinnedSession(state.editingPinnedId, entry);
    nextPinned = state.pinnedSessions.map((s) => (s.id === state.editingPinnedId ? { ...s, ...entry } : s));
  } else {
    // No cap on custom sessions any more (was 3, oldest replaced) — Home
    // shows the two most recently used, the rest are on the Custom
    // Sessions screen. A new one counts as just used, so it lists first.
    const now = Date.now();
    const created = { ...entry, createdAt: now, lastUsedAt: now };
    actions.addPinnedSession(created);
    nextPinned = [...state.pinnedSessions, { ...created, id: state.pinnedNextId }];
  }

  actions.setEditingPinnedId(null);
  actions.setSetupMode('start');
  actions.updateConfig({ customName: '', activityNote: '' });

  // persistSave takes an explicit snapshot rather than reading from `state`
  // again, because the dispatches above haven't been applied to the store
  // yet when this line runs (dispatch is async) — state.pinnedSessions here
  // would still be the pre-save value.
  // pinnedNextId must advance in the snapshot too when a session was added —
  // otherwise the stale counter is what gets persisted, and after an app
  // restart the next new custom session reuses an existing id.
  const added = state.editingPinnedId === null;
  await persistSave({ ...state, pinnedSessions: nextPinned, pinnedNextId: added ? state.pinnedNextId + 1 : state.pinnedNextId });
  goBackOrHome(navigation);
}

// TWENTY-FOURTH follow-up: Summary's "Save this setup" — saves a just-
// finished session's setup (results.saveOffer) as a new custom session.
// Returns { ok: true } or { ok: false, error } (empty or duplicate name).
export async function saveSetupAsCustomSession({ state, actions, setup, name }) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'Please enter a name.' };
  const key = trimmed.toLowerCase();
  if (state.pinnedSessions.some((p) => (p.name || '').trim().toLowerCase() === key)) {
    return { ok: false, error: `You already have a custom session named "${trimmed}".` };
  }
  const icons = ICON_MAP[setup.activityType] || ICON_MAP.meditative;
  const now = Date.now();
  const entry = { name: trimmed, ...setup, ...icons, createdAt: now, lastUsedAt: now };
  actions.addPinnedSession(entry);
  await persistSave({
    ...state,
    pinnedSessions: [...state.pinnedSessions, { ...entry, id: state.pinnedNextId }],
    pinnedNextId: state.pinnedNextId + 1,
  });
  return { ok: true };
}

// Mirrors deletePinnedSession(id).
export async function deletePinnedSession({ state, actions }, id) {
  const s = state.pinnedSessions.find((p) => p.id === id);
  if (s?.guidePath) await deleteGuideAudioFile(s.guidePath);
  actions.removePinnedSession(id);
  await persistSave({ ...state, pinnedSessions: state.pinnedSessions.filter((p) => p.id !== id) });
}

// Starts a saved custom session (from Home or the Custom Sessions screen)
// and records it as just used, which moves it to the top of the list.
// Usage is only recorded when the session actually starts — startSession()
// shows the "Not connected" alert and does nothing otherwise.
export function startCustomSession({ state, actions, navigation, session }) {
  if (state.isConnected) {
    const now = Date.now();
    actions.updatePinnedSession(session.id, { lastUsedAt: now });
    persistSave({
      ...state,
      pinnedSessions: state.pinnedSessions.map((p) => (p.id === session.id ? { ...p, lastUsedAt: now } : p)),
    });
  }
  startSession({
    state,
    actions,
    navigation,
    origin: 'custom',
    customSessionId: session.id,
    overrides: {
      config: {
        feedbackType: session.feedbackType,
        activityType: session.activityType,
        activityNote: '',
        duration: session.duration,
      },
      guideMediaSource: session.guideSource || null,
      guideMediaName: session.guideSource === 'phone' ? session.guideName || '' : '',
      guideMediaPath: session.guideSource === 'phone' ? session.guidePath || null : null,
    },
  });
}

// state/actions come from useStore(); navigation from useNavigation().
// `overrides` lets a caller (like Home's quickStart) set config/guide-media
// fields and start a session in one call. We can't just dispatch
// updateConfig() then read state.config right after — dispatch is async,
// so state here would still be the pre-update snapshot. Building an
// `effective` view of state solves that for everything *this* function
// needs, while still dispatching the real updates so the Recording/Summary
// screens (which read from the store fresh) see the correct values too.
// Mirrors startSimilarSession() — used from the Session Detail screen.
// Session records now store the actual guide file reference (guidePath/
// guideName) directly, not just the guide type — see endSession() in this
// file. Falls back to the old pinned-session lookup only for records saved
// before that fix existed (which won't have guidePath set).
export function startSimilarSession({ state, actions, navigation, session }) {
  let guideMediaSource = session.guideSource || null;
  let guideMediaName = session.guideName || '';
  let guideMediaPath = session.guidePath || null;

  if (guideMediaSource === 'phone' && !guideMediaPath) {
    const pinned = state.pinnedSessions.find(
      (p) =>
        p.activityType === session.activityType &&
        p.feedbackType === session.feedbackType &&
        p.guideSource === 'phone' &&
        p.guidePath,
    );
    if (pinned) {
      guideMediaName = pinned.guideName || '';
      guideMediaPath = pinned.guidePath;
    } else {
      guideMediaSource = null; // no file available to reuse — degrade gracefully
    }
  }

  startSession({
    state,
    actions,
    navigation,
    origin: 'similar',
    overrides: {
      config: {
        feedbackType: session.feedbackType,
        activityType: session.activityType,
        activityNote: '',
        duration: session.isContinuous ? null : session.duration,
        customName: '',
      },
      guideMediaSource,
      guideMediaName,
      guideMediaPath,
    },
  });
}

// `origin` — see currentSessionOrigin above. Defaults to 'setup' (Session
// setup's Begin session passes nothing); every other caller passes its own.
export function startSession({ state, actions, navigation, overrides, origin = 'setup', customSessionId = null }) {
  const effective = overrides
    ? {
        ...state,
        config: { ...state.config, ...(overrides.config || {}) },
        guideMediaSource:
          overrides.guideMediaSource !== undefined ? overrides.guideMediaSource : state.guideMediaSource,
        guideMediaName: overrides.guideMediaName !== undefined ? overrides.guideMediaName : state.guideMediaName,
        guideMediaPath: overrides.guideMediaPath !== undefined ? overrides.guideMediaPath : state.guideMediaPath,
        setupMode: 'start',
        editingPinnedId: null,
      }
    : state;

  if (!effective.isConnected) {
    Alert.alert('Not connected', 'Please connect your M5Stick device first.');
    return;
  }

  if (overrides) {
    actions.setSetupMode('start');
    actions.setEditingPinnedId(null);
    actions.updateConfig(overrides.config || {});
    actions.setGuideMedia(effective.guideMediaSource, effective.guideMediaName, effective.guideMediaPath);
  }

  // Auto-pin to Home if the user named this session but didn't explicitly save it
  const hasId = !!(effective.config.customName || '').trim() || !!(effective.config.activityNote || '').trim();
  // No cap any more (was 3, oldest replaced). Since custom sessions can now
  // accumulate, starting with a name that matches an existing custom
  // session updates that one instead of adding a duplicate.
  if (hasId && effective.setupMode === 'start') {
    const now = Date.now();
    const entry = buildPinnedEntry(effective, null);
    const key = entry.name.trim().toLowerCase();
    const existing = effective.pinnedSessions.find((p) => (p.name || '').trim().toLowerCase() === key);
    if (existing) {
      if (existing.guidePath && existing.guidePath !== entry.guidePath) deleteGuideAudioFile(existing.guidePath);
      actions.updatePinnedSession(existing.id, { ...entry, name: existing.name, lastUsedAt: now }); // keep its own name/capitalization
    } else {
      actions.addPinnedSession({ ...entry, createdAt: now, lastUsedAt: now });
    }
  }

  // TWENTY-FOURTH follow-up: Summary offers "Save this setup as a custom
  // session?" only for a session started from Session setup that wasn't
  // just auto-saved by name (above) and doesn't match an existing custom
  // session's setup. Never for Quick Start, custom or "Start similar"
  // sessions. The setup is captured now, as configured.
  const autoSaved = hasId && effective.setupMode === 'start';
  const setup = setupOf(effective);
  const offer = origin === 'setup' && !autoSaved && !findMatchingCustomSession(effective.pinnedSessions, setup);
  currentSessionOrigin = { origin, customSessionId, saveOffer: offer ? setup : null };

  actions.updateConfig({ customName: '', activityNote: '' });
  actions.setSetupMode('start');

  applySessionSettings(effective.settings);

  // THIRTY-SIXTH follow-up: a new session replaces any disconnected session
  // that could still have been continued (it's already saved as it was).
  live.beginSessionBuffers();
  activeSession = {
    startedAtMs: Date.now(),
    config: {
      activityType: effective.config.activityType,
      feedbackType: effective.config.feedbackType,
      duration: effective.config.duration || null,
      activityNote: '',
    },
    guide: {
      source: effective.guideMediaSource || null,
      name: effective.guideMediaName || '',
      path: effective.guideMediaPath || null,
    },
    origin,
    customSessionId,
    totalSeconds: effective.config.duration ? effective.config.duration * 60 : 0,
    resumeOfId: null,
    persist: effective.appMode !== 'demo',
  };
  if (activeSession.persist) startCheckpointFor(activeSession, { fresh: true });
  sendCommand('START');

  const totalSeconds = activeSession.totalSeconds;
  live.startTimers({
    totalSeconds,
    onComplete: (secs) => endSession({ state: effective, actions, navigation, secs, byTimer: true }),
  });

  navigation.navigate('recording');
}

function startCheckpointFor(session, opts) {
  const { startedAtMs, config, guide, origin, customSessionId, totalSeconds, resumeOfId, sessionId } = session;
  return checkpoint.startCheckpointing(
    { startedAtMs, config, guide, origin, customSessionId, totalSeconds, resumeOfId, sessionId: sessionId ?? resumeOfId ?? null, ...(opts.carry || {}) },
    { fresh: !!opts.fresh },
  );
}

// Puts the calibration and sonification settings into effect for a session.
function applySessionSettings(settings) {
  // Fixed for the session unless changed with the Recording screen's "Edit
  // Calibration Settings" (THIRTY-SIXTH follow-up) — see liveSession.js's
  // setFullScaleG()/applyCalibration().
  live.setFullScaleG(settings?.fullScaleG);
  // TWENTY-NINTH follow-up: the noise floor setting is now actually applied
  // (was ignored in favour of dsp.js's built-in default). After
  // setFullScaleG() — it's validated against it.
  live.setNoiseFloorG(settings?.noiseFloorG);
  // Band filtering follows the explicit settings.bandFilterEnabled switch
  // (THIRTY-FIFTH follow-up; Settings > Calibration). Saving a wizard
  // calibration turns it on; users can also turn it on/off by hand. Existing
  // users were migrated from the old rule (on once lastCalibratedAt was set)
  // in persistence.js — see setTremorBand() in liveSession.js.
  live.setTremorBand(
    settings?.tremorBandMinHz,
    settings?.tremorBandMaxHz,
    !!settings?.bandFilterEnabled, // THIRTY-FIFTH follow-up: explicit switch (Settings > Calibration)
  );
  applySoundSettings(settings);
}

// Sonification settings for a session (also used when continuing one).
function applySoundSettings(settings) {
  setActiveVoice(settings?.sonificationVoice);
  // Only meaningful when the "custom" tonal range voice is selected, but
  // cheap/harmless to always set — mirrors setFullScaleG()/setTremorBand()'s
  // "fixed for the whole session" treatment.
  setCustomTonalRange(settings?.customTonalRangeMinHz, settings?.customTonalRangeMaxHz);
  // THIRTEENTH follow-up: undo the previous session's endSession()
  // muting masterGain (see silenceAudio()/unmuteAudio() in audio.js) —
  // the AudioContext/voice graph persists across sessions, so without
  // this a session after the first would stay silent at the master bus
  // regardless of any individual voice's gain.
  unmuteAudio();
}

// `disconnected: true` marks a session that was force-ended because the app
// lost its BLE connection to the M5Stick mid-session (see RecordingScreen's
// connectivity guard). The record gets an `endReason`/`statusMessage` pair
// so Session Detail can explain the gap, and the caller is routed to a
// dedicated "Disconnected from device" screen instead of the normal Summary.
//
// THIRTY-SIXTH follow-up: the record is built by utils/sessionRecord.js from
// the readings' motion values (no raw sensor samples). A disconnected
// session can be continued if the device reconnects within
// RESUME_WINDOW_MIN (see resumeSession()); a continued session's end
// updates its existing record instead of adding a new one.
export function endSession({ state, actions, navigation, secs, byTimer = false, disconnected = false }) {
  live.stopTimers();
  const recording = live.stopRecordingBuffers();
  // No point sending STOP to a device that's already gone — sendCommand()
  // would just warn and no-op, but skipping it makes the intent explicit.
  if (!disconnected) sendCommand('STOP');
  silenceAudio(); // stop tone immediately — screen stays mounted under Summary, so unmount-based cleanup won't fire yet
  // Also fully disconnect the audio update path — a BLE packet that
  // arrives in the brief window after sendCommand('STOP') would otherwise
  // still reach updateAudio() and, seeing silenceAudio()'s reset change-
  // tracking, immediately re-trigger sound. RecordingScreen's own effect
  // re-registers this on next mount, so this doesn't affect future sessions.
  live.setAudioHook(null);
  stopGuideTrack();

  const session = activeSession || {
    startedAtMs: Date.now() - (secs || 0) * 1000,
    config: { ...state.config, duration: state.config.duration || null },
    guide: { source: state.guideMediaSource || null, name: state.guideMediaName || '', path: state.guideMediaPath || null },
    origin: currentSessionOrigin.origin,
    customSessionId: currentSessionOrigin.customSessionId,
    resumeOfId: null,
    persist: state.appMode !== 'demo',
  };
  const endedAtMs = Date.now();
  const { record, results: built } = buildSessionRecord({
    rmsG: recording.rmsTraceG,
    rmsAllG: recording.rmsAllTraceG,
    segments: recording.segments,
    events: recording.events,
    elapsedSec: secs,
    startedAtMs: session.startedAtMs,
    endedAtMs,
    config: session.config,
    guide: session.guide,
    origin: session.origin,
    customSessionId: session.customSessionId,
    saveOffer: session.resumeOfId ? null : currentSessionOrigin.saveOffer,
    peakFreq: recording.liveFreqHz,
    packetCount: recording.packetCount,
    endReason: disconnected ? 'disconnected' : 'completed',
  });

  // Mirrors the id the ADD_SESSION reducer case will assign — computed here
  // so the Summary screen can later attach a note to this exact record via
  // updateSession(sessionId, ...) without needing a fresh read of the store.
  // A continued session keeps its existing id.
  const sessionId = session.resumeOfId ?? state.todaySessionNextId;
  actions.setResults({ ...built, sessionId });
  if (session.resumeOfId != null) actions.updateSession(sessionId, record);
  else actions.addSession(record);

  if (session.persist) {
    checkpoint.finishCheckpointing(disconnected ? 'disconnected' : 'finished', {
      sessionId,
      ...(disconnected ? { disconnectedAtMs: endedAtMs } : {}),
    });
  }
  activeSession = null;

  // persistSave needs the *next* state (post addSession/updateSession), so
  // RecordingScreen's useEffect on state.allSessions does the actual save
  // (then clears a finished session's checkpoint).

  actions.setScoreAnim(false);
  if (disconnected) {
    // Skip the normal Session Complete screen — the user needs to know
    // *why* the session stopped, not see a celebratory summary.
    navigation.navigate('disconnected');
  } else {
    navigation.navigate('summary');
    setTimeout(() => actions.setScoreAnim(true), 450);
  }
}

// ── THIRTY-SIXTH follow-up: calibration changes during a session ──
// Applies Settings-style calibration values to the running session right
// away (the caller also saves them as the app's settings). Returns whether
// anything changed.
export function applyCalibrationDuringSession(patch) {
  const changed = live.applyCalibration(patch);
  if (changed && activeSession?.persist) checkpoint.flushCheckpoint();
  return changed;
}

// The Recording screen's sonification switch: keep the record's sound
// setting in step (and in the checkpoint).
export function noteFeedbackType(feedbackType) {
  if (!activeSession || activeSession.config.feedbackType === feedbackType) return;
  activeSession = { ...activeSession, config: { ...activeSession.config, feedbackType } };
  if (activeSession.persist) checkpoint.updateCheckpointMeta({ config: activeSession.config });
}

export function isSessionActive() {
  return !!activeSession;
}

// ── THIRTY-SIXTH follow-up: continuing a session after a disconnect ──

function withinResumeWindow(meta, now = Date.now()) {
  return (
    meta?.status === 'disconnected' &&
    typeof meta.disconnectedAtMs === 'number' &&
    now - meta.disconnectedAtMs <= RESUME_WINDOW_MIN * 60 * 1000
  );
}

// The session that can be continued, or null. Clears an expired one.
// Returns { meta, minutesAgo, isContinuous }.
export async function getResumableSession() {
  if (activeSession) return null;
  const cp = await checkpoint.loadCheckpoint();
  if (!cp) return null;
  if (cp.meta.status === 'disconnected' && !withinResumeWindow(cp.meta)) {
    await checkpoint.clearCheckpoint();
    return null;
  }
  if (!withinResumeWindow(cp.meta)) return null;
  return {
    meta: cp.meta,
    minutesAgo: Math.max(0, Math.round((Date.now() - cp.meta.disconnectedAtMs) / 60000)),
    isContinuous: !cp.meta.config?.duration,
  };
}

// The user chose not to continue: the session stays saved as it ended.
export function declineResume() {
  return checkpoint.clearCheckpoint();
}

// Continues the disconnected session: restores what was recorded, applies
// the current settings (noting any calibration change), marks the
// reconnect on the session's chart and carries on recording. The clock
// continues from where it stopped (the disconnected gap isn't counted).
export async function resumeSession({ state, actions, navigation }) {
  if (!state.isConnected) {
    Alert.alert('Not connected', 'Please connect your M5Stick device first.');
    return false;
  }
  const cp = await checkpoint.loadCheckpoint();
  if (!cp || !withinResumeWindow(cp.meta)) {
    Alert.alert('Session can’t be continued', `Sessions can be continued for ${RESUME_WINDOW_MIN} minutes after a disconnect.`);
    return false;
  }
  const m = cp.meta;
  const n = Math.min(cp.rmsTraceG.length, cp.rmsAllTraceG.length);

  live.restoreRecording({
    rmsTraceG: cp.rmsTraceG.slice(0, n),
    rmsAllTraceG: cp.rmsAllTraceG.slice(0, n),
    segments: m.segments || [],
    events: m.events || [],
    packetCount: m.packetCount || 0,
    elapsed: m.elapsed || 0,
    liveFreqHz: m.liveFreqHz || 0,
  });
  // Settings may have changed while disconnected: apply the current ones
  // (a calibration change is noted on the session's chart).
  live.applyCalibration({ ...state.settings, bandFilterEnabled: !!state.settings?.bandFilterEnabled });
  applySoundSettings(state.settings);
  live.addSessionEvent('reconnect', { gapSec: Math.max(0, Math.round((Date.now() - m.disconnectedAtMs) / 1000)) });

  activeSession = {
    startedAtMs: m.startedAtMs,
    config: m.config,
    guide: m.guide || { source: null, name: '', path: null },
    origin: m.origin,
    customSessionId: m.customSessionId ?? null,
    totalSeconds: m.totalSeconds || 0,
    resumeOfId: m.sessionId,
    persist: true,
  };
  currentSessionOrigin = { origin: m.origin, customSessionId: m.customSessionId ?? null, saveOffer: null };
  actions.setSetupMode('start');
  actions.setEditingPinnedId(null);
  actions.updateConfig({ ...m.config, duration: m.config?.duration || null, customName: '', activityNote: '' });
  actions.setGuideMedia(activeSession.guide.source, activeSession.guide.name, activeSession.guide.path);
  startCheckpointFor(activeSession, { carry: { chunkCount: m.chunkCount || 0, savedReadings: n } });

  sendCommand('START');
  const effective = { ...state, config: { ...state.config, ...m.config } };
  live.startTimers({
    totalSeconds: activeSession.totalSeconds,
    onComplete: (secs) => endSession({ state: effective, actions, navigation, secs, byTimer: true }),
  });
  navigation.navigate('recording');
  return true;
}

// ── THIRTY-SIXTH follow-up: recovery at launch ──
// Called by App.js with the just-loaded saved state, before the app shows.
// If a checkpoint shows a session whose record isn't fully saved — the app
// was closed mid-session, or before the end-of-session save finished — the
// record is rebuilt from the checkpoint and added (or updated). Returns the
// sessions/next id to use and whether anything changed.
export async function recoverOnLaunch({ allSessions = [], todaySessionNextId = 100 }) {
  const cp = await checkpoint.loadCheckpoint();
  if (!cp) return { allSessions, todaySessionNextId, changed: false };
  const m = cp.meta;
  const n = Math.min(cp.rmsTraceG.length, cp.rmsAllTraceG.length);
  const existing = m.sessionId != null ? allSessions.find((s) => s.id === m.sessionId) : null;
  const needsRecord =
    m.status === 'recording' || !existing || (existing.elapsedSec ?? 0) < (m.elapsed ?? 0) - 1;

  let sessions = allSessions;
  let nextId = todaySessionNextId;
  let changed = false;
  if (needsRecord && n > 0) {
    const endReason = m.status === 'disconnected' ? 'disconnected' : m.status === 'finished' ? 'completed' : 'interrupted';
    const { record } = buildSessionRecord({
      rmsG: cp.rmsTraceG.slice(0, n),
      rmsAllG: cp.rmsAllTraceG.slice(0, n),
      segments: m.segments,
      events: m.events,
      elapsedSec: m.elapsed || 0,
      startedAtMs: m.startedAtMs,
      endedAtMs: m.lastSavedAtMs || Date.now(),
      config: m.config,
      guide: m.guide,
      origin: m.origin,
      customSessionId: m.customSessionId,
      peakFreq: m.liveFreqHz,
      packetCount: m.packetCount,
      endReason,
    });
    const id = existing ? existing.id : m.sessionId ?? m.resumeOfId ?? nextId;
    if (allSessions.some((s) => s.id === id)) {
      sessions = allSessions.map((s) => (s.id === id ? { ...s, ...record, id } : s));
    } else {
      sessions = [{ ...record, id }, ...allSessions];
      nextId = Math.max(nextId, id + 1);
    }
    changed = true;
  }

  // Keep a disconnected session that can still be continued; otherwise the
  // checkpoint has done its job. An interrupted session can't be continued
  // (its device connection is gone along with the app).
  if (!withinResumeWindow(m)) await checkpoint.clearCheckpoint();
  return { allSessions: sessions, todaySessionNextId: nextId, changed };
}
