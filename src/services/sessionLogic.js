import { Alert } from 'react-native';
import { rmsOf, rmsToLevel } from '../utils/dsp';
import * as live from '../state/liveSession';
import { sendCommand } from './ble';
import { persistSave } from './persistence';
import { silenceAudio, setActiveVoice, setCustomTonalRange, unmuteAudio } from './audio';
import { stopGuideTrack } from './guideTrackPlayer';
import { deleteGuideAudioFile } from './guideAudioPicker';
import { downsampleTrace } from '../utils/sessionStats';
import { median, bandPercentages } from '../utils/intensityStats';

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

  // Fixed for the whole session, even if the setting changes before the
  // *next* one — see liveSession.js's setFullScaleG() for why. Same
  // fixed-for-the-session treatment for the tremor frequency band, which
  // now gates live intensity/score via bandLimitedRms() (see dsp.js and
  // liveSession.js's updateLiveMetrics()).
  live.setFullScaleG(effective.settings?.fullScaleG);
  // Band-filtering only activates once the user has actually run
  // Calibration Mode at least once (lastCalibratedAt is only ever set by
  // CalibrationResultsScreen.js on real completion — unlike hasCalibrated,
  // it's never backfilled true for grandfathered/preset-only users) — see
  // setTremorBand() in liveSession.js for why this matters.
  live.setTremorBand(
    effective.settings?.tremorBandMinHz,
    effective.settings?.tremorBandMaxHz,
    !!effective.settings?.lastCalibratedAt,
  );
  setActiveVoice(effective.settings?.sonificationVoice);
  // Only meaningful when the "custom" tonal range voice is selected, but
  // cheap/harmless to always set — mirrors setFullScaleG()/setTremorBand()'s
  // "fixed for the whole session" treatment.
  setCustomTonalRange(effective.settings?.customTonalRangeMinHz, effective.settings?.customTonalRangeMaxHz);
  // THIRTEENTH follow-up: undo the previous session's endSession()
  // muting masterGain (see silenceAudio()/unmuteAudio() in audio.js) —
  // the AudioContext/voice graph persists across sessions, so without
  // this a session after the first would stay silent at the master bus
  // regardless of any individual voice's gain.
  unmuteAudio();

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

// `disconnected: true` marks a session that was force-ended because the app
// lost its BLE connection to the M5Stick mid-session (see RecordingScreen's
// connectivity guard). The record gets an `endReason`/`statusMessage` pair
// so Session Detail can explain the gap, and the caller is routed to a
// dedicated "Disconnected from device" screen instead of the normal Summary.
export function endSession({ state, actions, navigation, secs, byTimer = false, disconnected = false }) {
  live.stopTimers();
  const { buffer: sessionBuffer, levelTrace } = live.stopRecordingBuffers();
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

  // Intensity shift (start vs end of session) — unrelated to the
  // session's median intensity, kept as-is. Uses the same fullScaleG that
  // was actually in effect for this session (set at startSession time),
  // not the default, so these numbers are consistent with the live
  // display and the levelTrace used for intensity below.
  const sessionFullScaleG = live.getFullScaleG();
  // The tremor band actually in effect for this session (see startSession()
  // above) — persisted alongside fullScaleG for the same reason: so a
  // session's record stays self-describing even if the user's calibrated
  // band changes before their next session.
  const {
    tremorBandMinHz: sessionTremorBandMinHz,
    tremorBandMaxHz: sessionTremorBandMaxHz,
    tremorBandActive: sessionTremorBandActive,
  } = live.getTremorBand();
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

  // Validity gate (unchanged from the old SteadyPoint Score): a session is
  // only measured if it has at least 10 tremor-level samples AND lasted at
  // least 30 seconds. Otherwise it shows "—" (see utils/intensityStats.js).
  //
  // TWENTY-EIGHTH follow-up: the SteadyPoint Score (steadiness/consistency
  // blend) and its separate pctNone..pctHigh fields are gone. Sessions are
  // described by their median intensity and time in each band, computed
  // from the full-resolution trace. Older saved records keep their score
  // fields; sessionIntensity() still reads them for backwards compatibility.
  const intensityValid = levelTrace.length >= 10 && secs >= 30;
  const medianIntensity = intensityValid ? Math.round(median(levelTrace)) : null;
  const bandPct = intensityValid ? bandPercentages(levelTrace) : null;

  const liveState = live.getLiveState();
  // Mirrors the id the ADD_SESSION reducer case will assign — computed here
  // so the Summary screen can later attach a note to this exact record via
  // updateSession(sessionId, ...) without needing a fresh read of the store.
  const sessionId = state.todaySessionNextId;
  const results = {
    sessionId,
    reduction: reductionPct,
    fullScaleG: sessionFullScaleG,
    startLevel,
    endLevel,
    duration: Math.max(1, Math.round(secs / 60)),
    // TWENTY-EIGHTH follow-up: null when no dominant frequency was detected
    // (was a 5.7 Hz placeholder, which then showed up as real data).
    peakFreq: liveState.liveFreqHz > 0 ? liveState.liveFreqHz : null,
    samples: sessionBuffer.length,
    intensityTrace: downsampleTrace(levelTrace),
    intensityValid,
    medianIntensity,
    bandPct,
    // TWENTY-FOURTH follow-up — see currentSessionOrigin. saveOffer is the
    // setup Summary offers to save (null = don't offer).
    origin: currentSessionOrigin.origin,
    customSessionId: currentSessionOrigin.customSessionId,
    saveOffer: currentSessionOrigin.saveOffer,
  };

  actions.setResults(results);

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
    reduction: results.reduction,
    fullScaleG: results.fullScaleG,
    tremorBandMinHz: sessionTremorBandMinHz,
    tremorBandMaxHz: sessionTremorBandMaxHz,
    tremorBandFiltered: sessionTremorBandActive, // whether the band above was actually applied to this session's scoring, or just carried along informationally
    duration: results.duration,
    isContinuous: !state.config.duration, // true if this session had no fixed duration — see Continuous Session
    freq: results.peakFreq,
    samples: results.samples,
    intensityTrace: results.intensityTrace,
    intensityValid: results.intensityValid, // TWENTY-SIXTH follow-up
    medianIntensity: results.medianIntensity,
    bandPct: results.bandPct,
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
    origin: currentSessionOrigin.origin, // TWENTY-FOURTH follow-up: 'setup' | 'quickStart' | 'custom' | 'similar'
    customSessionId: currentSessionOrigin.customSessionId,
    endReason: disconnected ? 'disconnected' : 'completed',
    statusMessage: disconnected
      ? 'Session ended early — the app lost connection to your M5Stick device.'
      : null,
  });

  // persistSave needs the *next* state (post addSession),
  // so callers should trigger a save shortly after dispatch settles — see
  // RecordingScreen's useEffect on state.allSessions for the actual save call.

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
