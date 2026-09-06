import { Alert } from 'react-native';
import { rmsOf, rmsToLevel } from '../utils/dsp';
import * as live from '../state/liveSession';
import { sendCommand } from './ble';
import { persistSave } from './persistence';
import { silenceAudio, setActiveVoice } from './audio';
import { stopGuideTrack } from './guideTrackPlayer';
import { deleteGuideAudioFile } from './guideAudioPicker';

const ICON_MAP = {
  meditative: { icon: 'brain', iconBg: 'bgInfo', iconColor: 'info' },
  engaged: { icon: 'pencil', iconBg: 'bgSuccess', iconColor: 'success' },
  active: { icon: 'walk', iconBg: 'bgWarning', iconColor: 'warning' },
};

function todayKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
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
  } else if (state.pinnedSessions.length < 3) {
    actions.addPinnedSession(entry);
    nextPinned = [...state.pinnedSessions, { ...entry, id: state.pinnedNextId }];
  } else {
    // Replace oldest — also delete its guide-audio file, matching the original.
    const oldest = state.pinnedSessions[0];
    if (oldest?.guidePath) await deleteGuideAudioFile(oldest.guidePath);
    actions.removePinnedSession(oldest.id);
    actions.addPinnedSession(entry);
    nextPinned = [...state.pinnedSessions.slice(1), { ...entry, id: state.pinnedNextId }];
  }

  actions.setEditingPinnedId(null);
  actions.setSetupMode('start');
  actions.updateConfig({ customName: '', activityNote: '' });

  // persistSave takes an explicit snapshot rather than reading from `state`
  // again, because the dispatches above haven't been applied to the store
  // yet when this line runs (dispatch is async) — state.pinnedSessions here
  // would still be the pre-save value.
  await persistSave({ ...state, pinnedSessions: nextPinned });
  navigation.navigate('home');
}

// Mirrors deletePinnedSession(id).
export async function deletePinnedSession({ state, actions }, id) {
  const s = state.pinnedSessions.find((p) => p.id === id);
  if (s?.guidePath) await deleteGuideAudioFile(s.guidePath);
  actions.removePinnedSession(id);
  await persistSave({ ...state, pinnedSessions: state.pinnedSessions.filter((p) => p.id !== id) });
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
    overrides: {
      config: {
        feedbackType: session.feedbackType,
        activityType: session.activityType,
        activityNote: '',
        duration: session.duration,
        customName: '',
      },
      guideMediaSource,
      guideMediaName,
      guideMediaPath,
    },
  });
}

export function startSession({ state, actions, navigation, overrides }) {
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
  if (hasId && effective.setupMode === 'start') {
    if (effective.pinnedSessions.length >= 3) {
      const oldest = effective.pinnedSessions[0];
      if (oldest?.guidePath) deleteGuideAudioFile(oldest.guidePath);
      actions.removePinnedSession(oldest.id);
    }
    actions.addPinnedSession(buildPinnedEntry(effective, null));
  }

  actions.updateConfig({ customName: '', activityNote: '' });
  actions.setSetupMode('start');

  // Fixed for the whole session, even if the setting changes before the
  // *next* one — see liveSession.js's setFullScaleG() for why.
  live.setFullScaleG(effective.settings?.fullScaleG);
  setActiveVoice(effective.settings?.sonificationVoice);

  live.beginSessionBuffers();
  sendCommand('START');

  const totalSeconds = effective.config.duration * 60;
  live.startTimers({
    totalSeconds,
    onComplete: (secs) => endSession({ state: effective, actions, navigation, secs, byTimer: true }),
  });

  navigation.navigate('recording');
}

export function pauseRecording() {
  live.stopRecordingBuffers();
}

export function endSession({ state, actions, navigation, secs, byTimer = false }) {
  live.stopTimers();
  const { buffer: sessionBuffer, levelTrace } = live.stopRecordingBuffers();
  sendCommand('STOP');
  silenceAudio(); // stop tone immediately — screen stays mounted under Summary, so unmount-based cleanup won't fire yet
  // Also fully disconnect the audio update path — a BLE packet that
  // arrives in the brief window after sendCommand('STOP') would otherwise
  // still reach updateAudio() and, seeing silenceAudio()'s reset change-
  // tracking, immediately re-trigger sound. RecordingScreen's own effect
  // re-registers this on next mount, so this doesn't affect future sessions.
  live.setAudioHook(null);
  stopGuideTrack();

  // Intensity shift (start vs end of session) — unrelated to the
  // SteadyPoint Score itself, kept as-is. Uses the same fullScaleG that
  // was actually in effect for this session (set at startSession time),
  // not the default, so these numbers are consistent with the live
  // display and the levelTrace used for the score below.
  const sessionFullScaleG = live.getFullScaleG();
  let startLevel = 0,
    endLevel = 0,
    reductionPct = 0;
  if (sessionBuffer.length >= 20) {
    const tenPct = Math.max(5, Math.floor(sessionBuffer.length * 0.1));
    const sd = sessionBuffer.slice(0, tenPct);
    const ed = sessionBuffer.slice(-tenPct);
    const srms = rmsOf(sd.map((d) => d.x), sd.map((d) => d.y), sd.map((d) => d.z));
    const erms = rmsOf(ed.map((d) => d.x), ed.map((d) => d.y), ed.map((d) => d.z));
    startLevel = rmsToLevel(srms, sessionFullScaleG);
    endLevel = rmsToLevel(erms, sessionFullScaleG);
    reductionPct = startLevel > 0 ? Math.max(0, Math.round(((startLevel - endLevel) / startLevel) * 100)) : 0;
  }

  // SteadyPoint Score — validity gate: a session is only scored if it has
  // at least 10 tremor-level samples AND lasted at least 30 seconds.
  // Otherwise score is invalid (displayed as "—" rather than a number).
  const scoreValid = levelTrace.length >= 10 && secs >= 30;

  let score = null,
    steadiness = null,
    consistency = null,
    pctNone = null,
    pctMild = null,
    pctModerate = null,
    pctHigh = null;

  if (scoreValid) {
    // Steadiness (85% of score): average "band credit" across the whole
    // trace — None=1.0, Mild=0.7, Moderate=0.35, High=0.0.
    const bandCredit = (level) => {
      if (level < 20) return 1.0;
      if (level < 45) return 0.7;
      if (level < 70) return 0.35;
      return 0.0;
    };
    steadiness = (levelTrace.reduce((s, l) => s + bandCredit(l), 0) / levelTrace.length) * 100;

    // Consistency (15% of score): rewards a smooth, stable trace and
    // penalizes erratic spikes.
    const traceMean = levelTrace.reduce((s, l) => s + l, 0) / levelTrace.length;
    const traceStd = Math.sqrt(levelTrace.reduce((s, l) => s + (l - traceMean) ** 2, 0) / levelTrace.length);
    consistency = Math.max(0, Math.min(100, 100 - traceStd * 1.5));

    score = Math.max(0, Math.min(100, Math.round(0.85 * steadiness + 0.15 * consistency)));

    // Band percentages — what fraction of the session was spent in each
    // tremor band. Feeds the Analytics "Time in Bands" panel.
    const n = levelTrace.length;
    pctNone = Math.round((levelTrace.filter((l) => l < 20).length / n) * 100);
    pctMild = Math.round((levelTrace.filter((l) => l >= 20 && l < 45).length / n) * 100);
    pctModerate = Math.round((levelTrace.filter((l) => l >= 45 && l < 70).length / n) * 100);
    pctHigh = Math.round((levelTrace.filter((l) => l >= 70).length / n) * 100);
  }

  const liveState = live.getLiveState();
  // Mirrors the id the ADD_SESSION reducer case will assign — computed here
  // so the Summary screen can later attach a note to this exact record via
  // updateSession(sessionId, ...) without needing a fresh read of the store.
  const sessionId = state.todaySessionNextId;
  const results = {
    sessionId,
    score,
    scoreValid,
    steadiness,
    consistency,
    pctNone,
    pctMild,
    pctModerate,
    pctHigh,
    reduction: reductionPct,
    fullScaleG: sessionFullScaleG,
    startLevel,
    endLevel,
    duration: Math.max(1, Math.round(secs / 60)),
    peakFreq: liveState.liveFreqHz > 0 ? liveState.liveFreqHz : 5.7,
    samples: sessionBuffer.length,
  };

  actions.setResults(results);
  actions.recordCompletedSession(results.score, results.duration, state.config.activityType);

  const now = new Date();
  const hh = now.getHours(),
    mm = now.getMinutes();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  const timeStr = `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
  const sessionLabel =
    (state.config.activityNote || '').trim() ||
    { meditative: 'Meditation session', engaged: 'Engaged session', active: 'Active session' }[
      state.config.activityType
    ] ||
    'Session';

  actions.addSession({
    dateKey: todayKey(),
    date: 'Today',
    time: timeStr,
    label: sessionLabel,
    score: results.score,
    scoreValid: results.scoreValid,
    steadiness: results.steadiness,
    consistency: results.consistency,
    pctNone: results.pctNone,
    pctMild: results.pctMild,
    pctModerate: results.pctModerate,
    pctHigh: results.pctHigh,
    reduction: results.reduction,
    fullScaleG: results.fullScaleG,
    duration: results.duration,
    freq: results.peakFreq,
    startLevel: results.startLevel,
    endLevel: results.endLevel,
    activityType: state.config.activityType,
    feedbackType: state.config.feedbackType,
    guideSource: state.guideMediaSource || null,
    // Storing the actual file reference directly (not just the type) means
    // "Start similar session" no longer depends on finding a matching
    // pinned session to reconnect the guide audio — that lookup silently
    // failed whenever no matching pinned entry existed (which became the
    // normal case once My Sessions / the Setup note field were hidden,
    // since those were the only ways new pinned entries got created).
    guidePath: state.guideMediaSource === 'phone' ? state.guideMediaPath : null,
    guideName: state.guideMediaSource === 'phone' ? state.guideMediaName : '',
  });

  // persistSave needs the *next* state (post addSession/recordCompletedSession),
  // so callers should trigger a save shortly after dispatch settles — see
  // RecordingScreen's useEffect on state.allSessions for the actual save call.

  actions.setScoreAnim(false);
  navigation.navigate('summary');
  setTimeout(() => actions.setScoreAnim(true), 450);
}
