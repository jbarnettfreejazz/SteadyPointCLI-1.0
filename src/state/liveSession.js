import { rmsOf, std, dominantFreq, rmsToLevel, DEFAULT_FULL_SCALE_G } from '../utils/dsp';

// ══════════════════════════════════════════════════════
// LIVE SESSION STORE
// Mirrors the original HTML's high-frequency globals (recentX/Y/Z,
// dispX/Y/Z, sparkBuf, tremorLevel, liveFreqHz, etc.) plus its two
// interval loops:
//   - elapsed-time timer, every 1000ms  (tmr.t)
//   - metrics recompute,   every 300ms   (tmr.r, was updateLiveMetrics)
//
// This is a plain mutable store with subscribe/notify rather than
// reducer state, because pushPacket() fires at ~50Hz from BLE and we
// don't want that flooding React's reconciler. Only the Recording
// screen subscribes to this (via useLiveSession), so the rest of the
// app is unaffected.
// ══════════════════════════════════════════════════════

const SPARK_LEN = 50;
const ROLL_WIN = 100; // ~2s at 50Hz
// Dedicated, longer window just for sonification's combined-frequency
// detection (see combinedDominantFreq() in dsp.js) — kept separate from
// ROLL_WIN above, which drives intensity/tremorLevel/SteadyPoint Score
// and shouldn't be touched by this. Confirmed via real device logs that
// ~2s (barely one full cycle at a 0.5Hz test frequency) was too short
// for a stable FFT read; this gives low frequencies more complete
// cycles to work with.
const FREQ_WIN = 250; // ~5s at 50Hz

function freshState() {
  return {
    recentX: [],
    recentY: [],
    recentZ: [],
    // Separate, longer-window buffers just for sonification's frequency
    // detection — see FREQ_WIN above for why.
    freqWinX: [],
    freqWinY: [],
    freqWinZ: [],
    dispX: Array(SPARK_LEN).fill(0),
    dispY: Array(SPARK_LEN).fill(0),
    dispZ: Array(SPARK_LEN).fill(0),
    sparkBuf: Array(SPARK_LEN).fill(0),
    tremorHistory: Array(SPARK_LEN).fill(0),
    sessionBuffer: [], // { t (seconds), x, y, z }
    levelTrace: [], // tremorLevel at each updateLiveMetrics tick — full session trace for scoring
    tremorLevel: 0,
    displayLevel: 0,
    liveFreqHz: 0,
    liveXpct: 0,
    liveYpct: 0,
    liveZpct: 0,
    liveSev: 'None',
    packetTimes: [],
    elapsed: 0,
    isRecording: false,
    hasUnsaved: false,
  };
}

let state = freshState();
const listeners = new Set();
const timers = { elapsedInterval: null, metricsInterval: null };
let audioHook = null;

// The user-adjustable "full-scale range motion" setting (see Settings
// screen / dsp.js's rmsToLevel()) — set once at the start of each session
// (see sessionLogic.js's startSession()) so the value used stays fixed for
// that session's whole duration, even if the user changes the setting
// before their *next* session. Read back via getFullScaleG() when a
// session ends, so the exact value actually used gets persisted with it.
let fullScaleG = DEFAULT_FULL_SCALE_G;

export function setFullScaleG(value) {
  fullScaleG = typeof value === 'number' && value > 0 ? value : DEFAULT_FULL_SCALE_G;
}

export function getFullScaleG() {
  return fullScaleG;
}

// Registered by the Recording screen when audio feedback is enabled —
// mirrors the original's `if(audioEnabled()&&screen==='active') updateAudio(...)`
// inline call inside pushPacket().
export function setAudioHook(fn) {
  audioHook = fn;
}

function notify() {
  state = { ...state };
  for (const l of listeners) l(state);
}

export function subscribeLive(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLiveState() {
  return state;
}

export function resetLiveSession() {
  stopTimers();
  state = freshState();
  notify();
}

// Called at the start of a new session — resets buffers but doesn't
// touch timers (sessionLogic.startSession owns those).
export function beginSessionBuffers() {
  state = { ...freshState(), isRecording: true };
  notify();
}

export function stopRecordingBuffers() {
  const buffer = state.sessionBuffer;
  const levelTrace = state.levelTrace;
  state = { ...state, isRecording: false };
  notify();
  return { buffer, levelTrace };
}

// Mirrors pushPacket(ax, ay, az) — buffer bookkeeping only, no metrics math
// (that's updateLiveMetrics, run on its own 300ms cadence below).
export function pushPacket(ax, ay, az) {
  state.recentX.push(ax);
  state.recentY.push(ay);
  state.recentZ.push(az);
  if (state.recentX.length > ROLL_WIN) {
    state.recentX.shift();
    state.recentY.shift();
    state.recentZ.shift();
  }

  state.freqWinX.push(ax);
  state.freqWinY.push(ay);
  state.freqWinZ.push(az);
  if (state.freqWinX.length > FREQ_WIN) {
    state.freqWinX.shift();
    state.freqWinY.shift();
    state.freqWinZ.shift();
  }

  state.dispX = [...state.dispX.slice(-(SPARK_LEN - 1)), ax];
  state.dispY = [...state.dispY.slice(-(SPARK_LEN - 1)), ay];
  state.dispZ = [...state.dispZ.slice(-(SPARK_LEN - 1)), az];

  const now = Date.now();
  state.packetTimes.push(now);
  state.packetTimes = state.packetTimes.filter((t) => now - t < 2000);

  if (state.isRecording) {
    state.sessionBuffer.push({ t: now / 1000, x: ax, y: ay, z: az });
    state.hasUnsaved = true;
  }

  // Audio updates fire per packet (~50Hz) again — retesting specifically
  // against the single-layer sample engine (DUAL_LAYER_ENABLED = false in
  // audio.js). The earlier per-packet test that failed (audible staccato/
  // bouncing-bow artifact) was against the DUAL-layer engine, running 6
  // simultaneous real-time pitch-shifters — since confirmed (by disabling
  // the loud layer) to be a genuine computational load ceiling on this
  // device/library, not a cadence problem per se. Single-layer at full
  // packet rate hasn't been tested since that finding, so this is a fresh
  // test of whether the responsiveness gap vs. the source HTML prototype
  // (which updates every packet) can be closed now. If pitch/volume
  // freezing or stalling reappears under real movement, that means even
  // single-layer can't sustain this rate, and this should revert to
  // calling audioHook from updateLiveMetrics below instead (~300ms).
  if (audioHook) {
    try {
      // Same sr formula used by updateLiveMetrics() for the existing
      // "Dominant Freq" stat — reused here so the new sonification
      // pitch's FFT uses a consistent sample-rate estimate.
      const sr = state.packetTimes.length > 1 ? state.packetTimes.length / 2 : 50;
      audioHook(state.recentX, state.recentY, state.recentZ, state.tremorLevel, sr, {
        x: state.freqWinX,
        y: state.freqWinY,
        z: state.freqWinZ,
      });
    } catch (e) {
      console.warn('audioHook failed:', e.message);
    }
  }

  // Note: the waveform display wants fresh dispX/Y/Z, so we notify at
  // packet rate. If this proves too chatty on lower-end Android devices,
  // throttle this to every Nth packet.
  notify();
}

// Mirrors updateLiveMetrics() — run every 300ms while a session is active.
// Waits for ~1s of data (not just 8 samples/~150ms) before computing a
// level — with the fixed absolute scale (see rmsToLevel() in dsp.js),
// a too-small window can be dominated by a single early transient (e.g.
// the natural motion of picking up/repositioning the device right as a
// session starts), reporting a misleadingly high level for a moment. The
// old session-relative scale mostly absorbed this since the scale itself
// adapted to whatever the peak was; the new fixed scale doesn't, so this
// warm-up period substitutes for that.
const METRICS_WARMUP_SAMPLES = 50;

function updateLiveMetrics() {
  if (state.recentX.length < METRICS_WARMUP_SAMPLES) return;

  const rms = rmsOf(state.recentX, state.recentY, state.recentZ);
  const tremorLevel = rmsToLevel(rms, fullScaleG);
  state.tremorLevel = tremorLevel;
  state.sparkBuf = [...state.sparkBuf.slice(-(SPARK_LEN - 1)), tremorLevel];
  state.tremorHistory = state.sparkBuf;

  if (state.isRecording) {
    state.levelTrace.push(tremorLevel);
  }

  // Rate-limits the headline display value toward tremorLevel rather than
  // jumping straight to it — a sharp still-to-moving (or moving-to-still)
  // transition can dominate the RMS/variance calculation even with a full
  // rolling window, since std() is especially sensitive to sudden jumps.
  // MAX_STEP_PER_UPDATE ~30 means a full 0-100 swing takes roughly 1
  // second (at the 300ms metrics cadence) to fully catch up.
  const MAX_STEP_PER_UPDATE = 30;
  const delta = tremorLevel - state.displayLevel;
  state.displayLevel = Math.round(state.displayLevel + Math.max(-MAX_STEP_PER_UPDATE, Math.min(MAX_STEP_PER_UPDATE, delta)));

  // Per-axis, Y weighted x1.28 to match real device calibration data
  const sdX = std(state.recentX),
    sdY = std(state.recentY) * 1.28,
    sdZ = std(state.recentZ);
  const sdMax = Math.max(sdX, sdY, sdZ, 0.001);
  state.liveXpct = Math.min(100, Math.round((sdX / sdMax) * 100));
  state.liveYpct = Math.min(100, Math.round((sdY / sdMax) * 100));
  state.liveZpct = Math.min(100, Math.round((sdZ / sdMax) * 25)); // kept visually low, matches original

  const sr = state.packetTimes.length > 1 ? state.packetTimes.length / 2 : 50;
  if (state.recentX.length >= 64) {
    const df = dominantFreq(state.recentY, sr); // Y axis carries the most energy
    if (df > 0) state.liveFreqHz = df;
  }

  if (state.displayLevel < 20) state.liveSev = 'None';
  else if (state.displayLevel < 45) state.liveSev = 'Mild';
  else if (state.displayLevel < 70) state.liveSev = 'Moderate';
  else state.liveSev = 'High';

  notify();
}

export function startTimers({ onElapsedTick, onComplete, totalSeconds } = {}) {
  stopTimers();
  timers.elapsedInterval = setInterval(() => {
    state.elapsed += 1;
    notify();
    onElapsedTick?.(state.elapsed);
    if (totalSeconds && state.elapsed >= totalSeconds) {
      onComplete?.(state.elapsed);
    }
  }, 1000);
  timers.metricsInterval = setInterval(updateLiveMetrics, 300);
}

export function stopTimers() {
  if (timers.elapsedInterval) clearInterval(timers.elapsedInterval);
  if (timers.metricsInterval) clearInterval(timers.metricsInterval);
  timers.elapsedInterval = null;
  timers.metricsInterval = null;
}
