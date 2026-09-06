import { AudioContext } from 'react-native-audio-api';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { combinedDominantFreq, mapRange } from '../utils/dsp';

// ══════════════════════════════════════════════════════
// AUDIO SONIFICATION — SINGLE COMBINED VOICE
// Previously: three independent voices (Cello=X, Viola=Y, Violin=Z), each
// driven by its own axis's position/delta. Replaced with a single voice
// (user-selected instrument, see Settings) driven by all three axes
// combined — found that three simultaneously-moving pitches felt busy/
// unpalatable even with pentatonic quantization; muting two of three
// voices made it "much more palatable," which is the direct motivation
// for this redesign.
//
// Ported from a reference Python implementation (sp_stdout.py) per an
// explicit spec: "the tone emitted maps to the tremor dominant frequency
// and the volume maps to the tremor intensity." Specifically:
//   - PITCH: FFT each axis separately (mean-removed, i.e. gravity/DC
//     stripped), find each axis's own dominant frequency, average
//     whichever axes produced a usable result — see combinedDominantFreq()
//     in dsp.js. That combined frequency (expected tremor/movement range,
//     SOURCE_FREQ_MIN_HZ-SOURCE_FREQ_MAX_HZ) is linearly mapped into the
//     selected instrument's own natural audible register.
//   - VOLUME: directly proportional to tremorLevel (the same 0-100
//     intensity value already shown elsewhere in the app), not a
//     movement-delta as before. "Silence when steady" still holds
//     naturally, since a still device has both near-zero AC-RMS and
//     near-zero tremorLevel.
//
// Design decisions made porting this, not explicitly specified either way:
//   - NOT quantizing pitch to the pentatonic scale used in the old
//     3-voice engine — that quantization existed specifically to prevent
//     dissonant clashes between simultaneous voices, which can't happen
//     with only one voice playing, and the new goal (accurately
//     represent the tremor's actual oscillation frequency) is better
//     served by a continuous, unquantized mapping. quantizeToScale() is
//     no longer used but easy to reintroduce if a more "musical" feel is
//     wanted back.
//   - Each instrument's mapped target range reuses the old per-axis
//     ranges from the 3-voice engine (cello 65-130Hz, viola 196-330Hz,
//     violin 392-784Hz) as its own natural register, rather than
//     inventing new ranges.
//   - The reference resamples each axis onto a uniform time grid before
//     the FFT, to be robust against irregular BLE packet timing. This
//     port skips that step and uses the raw rolling buffer directly
//     (same assumption the app's pre-existing dominantFreq()/"Dominant
//     Freq" stat already makes) — real BLE packet timing has been
//     regular enough in on-device testing throughout this project, and
//     adding real per-sample timestamp tracking would be a larger,
//     separate architecture change.
//   - Per-instrument gain caps, sample-based playback (dual-layer
//     crossfade infrastructure, currently disabled — see
//     DUAL_LAYER_ENABLED), trim levels, and per-packet cadence are all
//     unchanged from the 3-voice engine — see prior notes on those below.
//   - Running an FFT on 3 axes at the per-packet cadence (~50Hz) this
//     engine uses would be meaningfully more CPU work than anything this
//     engine has done before (checking movement position/delta is cheap;
//     an FFT per axis is not) — so the whole update (frequency, gain,
//     brightness) is internally throttled to roughly the
//     FREQ_RECOMPUTE_INTERVAL_MS cadence, not just the FFT-based
//     frequency calculation. This throttling was originally a guess at
//     fixing a reported crash during long (several-minute+)
//     sonification-on sessions — it didn't actually fix it (confirmed by
//     testing: still crashed at the same ~2-minute mark even throttled),
//     but is kept anyway since reducing native call volume is still
//     reasonable on its own merits.
//   - CONFIRMED (via an actual iOS crash log, not inference this time):
//     the real cause was calling `AudioParam.cancelScheduledValues()` in
//     stopHard() at session end — a SIGSEGV inside
//     react-native-audio-api's own native cancelScheduledValues()
//     implementation (a deque-iterator decrement failing), most likely
//     triggered by however many parameter-change events had accumulated
//     by that point in a longer session. Fixed by removing that call
//     entirely — setValueAtTime(0, t) alone still silences the gain.
//     Small accepted tradeoff: without an explicit cancel, a pending
//     ramp scheduled slightly beyond the silence point could
//     theoretically cause a brief audible blip before truly going
//     silent, which is clearly preferable to a crash.
//
// Per-axis mute (setVoiceMuted) has been removed entirely, not just from
// the UI — muting one of three voices doesn't have a coherent meaning
// when only one voice ever plays; the equivalent ("no sonification at
// all") is already the existing visual-only feedback-type toggle.
// ══════════════════════════════════════════════════════

const ASSET_FILES = {
  cello: 'cello.wav',
  cello_loud: 'cello_loud.wav',
  viola: 'viola.wav',
  viola_loud: 'viola_loud.wav',
  violin: 'violin.wav',
  violin_loud: 'violin_loud.wav',
};

// Best-guess reference pitch of each bundled sample (see AUDIO_SOURCES.md
// for the note-naming-convention caveat carried over from the 3-voice
// engine). Soft and loud layers are the same physical note, so they
// share one reference.
const REFERENCE_FREQ = {
  cello: 65.41, // labeled "C1" — assumed standard C2
  viola: 196.0, // labeled "G2" — assumed standard G3
  violin: 440.0, // labeled "A4" — assumed standard A4 (Solo Violin subset, may use standard notation)
};

// Per-voice input trim, compensating for each source recording's own
// measured peak level (checked directly, not assumed). Measured peaks:
// cello -15.4 dBFS, viola -21.7 dBFS, violin -20.5 dBFS; target -4 dBFS.
const TRIM_DB = {
  cello: 11.4,
  viola: 17.7,
  violin: 16.5,
};

// Each instrument's own natural register — both the target range its
// pitch is mapped into, and its output volume ceiling. Reused unchanged
// from the old per-axis 3-voice engine.
const VOICE_CONFIG = {
  cello: { pan: -0.45, minFreq: 65, maxFreq: 130, maxGain: 0.4 },
  viola: { pan: 0, minFreq: 196, maxFreq: 330, maxGain: 0.25 },
  violin: { pan: 0.45, minFreq: 392, maxFreq: 784, maxGain: 0.4 },
};

// Expected tremor/movement frequency range that combinedDominantFreq()
// produces — mapped from here into whichever instrument is selected.
const SOURCE_FREQ_MIN_HZ = 0.5;
const SOURCE_FREQ_MAX_HZ = 20.0;

function bundledAssetPath(name) {
  const fileName = ASSET_FILES[name];
  if (Platform.OS === 'ios') {
    return `${RNFS.MainBundlePath}/${fileName}`;
  }
  // Unverified — this project's real device testing has been iOS-only.
  return `file:///android_asset/custom/${fileName}`;
}

// See the detailed comment on loadPair() below for what this controls and
// why it currently defaults to false.
const DUAL_LAYER_ENABLED = false;

// Flip to true to re-enable the [sonification] diagnostic console.log in
// updateAudio() (sr/level/rawFreq/smoothedFreq/mappedFreq per update) —
// this is what real device logs were captured with throughout the
// frequency-detection investigation (see README). Kept behind a flag
// rather than removed outright, since it may be needed again.
const SONIFICATION_DEBUG_LOGGING = false;

class SampleVoice {
  constructor(ctx, { pan, referenceFreq, trimDb = 0 }) {
    this.ctx = ctx;
    this.referenceFreq = referenceFreq;
    this.softReady = false;
    this.loudReady = false;

    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = pan;

    this.output = ctx.createGain();
    this.output.gain.value = 0;

    // Lowpass filter kept for the same "brightness" expressive control as
    // before, layered on top of whichever velocity blend is playing.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2400;
    this.filter.Q.value = 1.0;
    this.filter.connect(this.output);
    this.output.connect(this.pan);

    // Compensates for how quiet the source recording actually is (measured
    // peak, not just assumed) — see TRIM_DB above.
    this.trim = ctx.createGain();
    this.trim.gain.value = Math.pow(10, trimDb / 20);
    this.trim.connect(this.filter);

    // Soft and loud velocity layers play simultaneously at all times, each
    // through its own gain node — setIntensity() crossfades between them.
    // Both feed into the shared trim/filter/output/pan stage above.
    this.softGain = ctx.createGain();
    this.softGain.gain.value = 1; // fully soft at rest
    this.softGain.connect(this.trim);

    this.loudGain = ctx.createGain();
    this.loudGain.gain.value = 0; // silent until intensity rises
    this.loudGain.connect(this.trim);
  }

  get ready() {
    return this.softReady && this.loudReady;
  }

  connect(node) {
    this.pan.connect(node);
  }

  // Loads both velocity layers together and keeps them phase-locked — see
  // git history for the fuller explanation (independent, unsynchronized
  // loops produced an audible stutter when crossfading between them).
  // DIAGNOSTIC: when DUAL_LAYER_ENABLED is false, only the soft layer
  // loads/plays — confirmed via direct testing that running two
  // simultaneous real-time pitch-shifters per voice was a genuine
  // computational load ceiling on this device/library, not a tunable
  // timing issue, so this stays off by default.
  async loadPair(softPath, loudPath) {
    if (!DUAL_LAYER_ENABLED) {
      const softBuffer = await this.ctx.decodeAudioDataSource(softPath);
      const loopStart = softBuffer.duration * 0.2;
      const loopEnd = softBuffer.duration * 0.8;

      this.softStretcher = this.ctx.createStretcher();
      this.softSource = this.ctx.createBufferSource();
      this.softSource.buffer = softBuffer;
      this.softSource.loop = true;
      this.softSource.loopStart = loopStart;
      this.softSource.loopEnd = loopEnd;
      this.softSource.connect(this.softStretcher);
      this.softStretcher.connect(this.softGain);
      this.softSource.start(this.ctx.currentTime);

      this.softReady = true;
      this.loudReady = true; // no loud layer to wait on — ready as soon as soft is
      return;
    }

    const [softBuffer, loudBuffer] = await Promise.all([
      this.ctx.decodeAudioDataSource(softPath),
      this.ctx.decodeAudioDataSource(loudPath),
    ]);

    const shorterDuration = Math.min(softBuffer.duration, loudBuffer.duration);
    const loopStart = shorterDuration * 0.2;
    const loopEnd = shorterDuration * 0.8;

    this.softStretcher = this.ctx.createStretcher();
    this.softSource = this.ctx.createBufferSource();
    this.softSource.buffer = softBuffer;
    this.softSource.loop = true;
    this.softSource.loopStart = loopStart;
    this.softSource.loopEnd = loopEnd;
    this.softSource.connect(this.softStretcher);
    this.softStretcher.connect(this.softGain);

    this.loudStretcher = this.ctx.createStretcher();
    this.loudSource = this.ctx.createBufferSource();
    this.loudSource.buffer = loudBuffer;
    this.loudSource.loop = true;
    this.loudSource.loopStart = loopStart;
    this.loudSource.loopEnd = loopEnd;
    this.loudSource.connect(this.loudStretcher);
    this.loudStretcher.connect(this.loudGain);

    const startAt = this.ctx.currentTime + 0.05;
    this.softSource.start(startAt);
    this.loudSource.start(startAt);

    this.softReady = true;
    this.loudReady = true;
  }

  setFrequency(freq) {
    if (!this.ready) return;
    const semitones = 12 * Math.log2(freq / this.referenceFreq);
    const t = this.ctx.currentTime;
    this.softStretcher.semitones.setTargetAtTime(semitones, t, 0.05);
    if (DUAL_LAYER_ENABLED) this.loudStretcher.semitones.setTargetAtTime(semitones, t, 0.05);
  }

  setGain(level) {
    if (!this.ready) return;
    this.output.gain.setTargetAtTime(level, this.ctx.currentTime, 0.08);
  }

  // Crossfades between the soft and loud velocity-layer recordings — value
  // in [0,1]. Equal-power crossfade (cos/sin) for a smoother perceptual
  // blend than a straight linear fade.
  setIntensity(value) {
    if (!this.ready || !DUAL_LAYER_ENABLED) return;
    const v = Math.max(0, Math.min(1, value));
    const t = this.ctx.currentTime;
    this.softGain.gain.setTargetAtTime(Math.cos((v * Math.PI) / 2), t, 0.25);
    this.loudGain.gain.setTargetAtTime(Math.sin((v * Math.PI) / 2), t, 0.25);
  }

  setBrightness(value) {
    if (!this.ready) return;
    const v = Math.pow(Math.max(0, Math.min(1, value)), 0.7);
    const cutoff = 800 + v * 2800;
    this.filter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.06);
  }

  // Hard cutoff to silence — cancels any in-flight ramp rather than fading,
  // so a session end is immediately silent rather than tailing off.
  stopHard(t) {
    this.output.gain.setValueAtTime(0, t);
  }

  stopSource() {
    try {
      this.softSource?.stop();
    } catch (e) {
      // already stopped, or never started — fine to ignore
    }
    try {
      this.loudSource?.stop();
    } catch (e) {
      // already stopped, or never started — fine to ignore
    }
  }
}

let audioCtx = null;
let masterGain = null;
let cello = null,
  viola = null,
  violin = null;

// Which single instrument is active for the current session — set once at
// startSession() time from the user's Settings choice, held fixed for the
// session's whole duration (mirrors setFullScaleG() in liveSession.js).
let activeVoiceName = 'cello';

export function setActiveVoice(name) {
  activeVoiceName = VOICE_CONFIG[name] ? name : 'cello';
}

function activeVoice() {
  return { cello, viola, violin }[activeVoiceName];
}

let lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
const FREQ_EPSILON = 2; // Hz
const GAIN_EPSILON = 0.03;
const BRIGHT_EPSILON = 0.02;
const INTENSITY_EPSILON = 0.04;

// The FFT-based frequency recompute is meaningfully more CPU work than
// this engine has done before at its per-packet (~50Hz) cadence — see
// the file header note. Volume stays fully responsive every call; only
// the expensive part is throttled.
const FREQ_RECOMPUTE_INTERVAL_MS = 300;
let lastFreqComputeTime = 0;
let cachedMappedFreq = null;

// Exponential smoothing of the raw combined-frequency estimate across
// successive recomputes — specified in the reference implementation
// (FREQ_SMOOTHING_ALPHA) but missed during the initial port. Confirmed
// via real device logs to be a real gap: raw combinedFreq swung wildly
// (e.g. 0.5Hz to 10Hz) between consecutive ~300ms samples during a
// steady, metronome-guided shake test, with no temporal stability at
// all. Lower alpha = more smoothing/slower to respond.
const FREQ_SMOOTHING_ALPHA = 0.2;
let smoothedFreq = null;

// Confirmed via a motionless-device test: below this tremorLevel, the FFT
// has no real signal to find and reports noise-driven peaks as if they
// were a genuine frequency (readings of 10-20Hz+ with zero actual
// movement). Roughly the low end of the "Mild" tremor band.
const MIN_INTENSITY_FOR_FREQ = 8;

// Confirmed via real device logs: below MIN_INTENSITY_FOR_FREQ, simply
// freezing the pitch at its last value feels broken during a genuine
// slow-down — the pitch appears to "get stuck" rather than descending,
// even though intensity (and therefore volume) is clearly still fading.
// Instead, ease the pitch down toward the bottom of the source range —
// faster than the normal smoothing, so it settles within a couple of
// seconds rather than lingering.
const FREQ_DECAY_ALPHA = 0.25;

export function isAudioInitialized() {
  return !!audioCtx;
}

export function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.93;
  masterGain.connect(audioCtx.destination);

  cello = new SampleVoice(audioCtx, { pan: VOICE_CONFIG.cello.pan, referenceFreq: REFERENCE_FREQ.cello, trimDb: TRIM_DB.cello });
  viola = new SampleVoice(audioCtx, { pan: VOICE_CONFIG.viola.pan, referenceFreq: REFERENCE_FREQ.viola, trimDb: TRIM_DB.viola });
  violin = new SampleVoice(audioCtx, { pan: VOICE_CONFIG.violin.pan, referenceFreq: REFERENCE_FREQ.violin, trimDb: TRIM_DB.violin });

  cello.connect(masterGain);
  viola.connect(masterGain);
  violin.connect(masterGain);

  cello.loadPair(bundledAssetPath('cello'), bundledAssetPath('cello_loud')).catch((e) => console.warn('cello samples failed to load:', e.message));
  viola.loadPair(bundledAssetPath('viola'), bundledAssetPath('viola_loud')).catch((e) => console.warn('viola samples failed to load:', e.message));
  violin.loadPair(bundledAssetPath('violin'), bundledAssetPath('violin_loud')).catch((e) => console.warn('violin samples failed to load:', e.message));

  lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
  lastFreqComputeTime = 0;
  cachedMappedFreq = null;
}

// recentX/Y/Z are the rolling packet buffers from liveSession.js.
// tremorLevel is the same 0-100 intensity value shown elsewhere in the
// app. sr is the current estimated packet rate (see liveSession.js).
export function updateAudio(recentX, recentY, recentZ, tremorLevel, sr, freqWin) {
  const voice = activeVoice();
  if (!voice || !voice.ready) return; // still loading samples
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = Date.now();
  if (now - lastFreqComputeTime < FREQ_RECOMPUTE_INTERVAL_MS) return; // throttles ALL native calls below, not just frequency
  lastFreqComputeTime = now;

  const config = VOICE_CONFIG[activeVoiceName];
  const level = Math.max(0, Math.min(100, tremorLevel || 0));

  // Uses the dedicated longer window (see FREQ_WIN in liveSession.js), not
  // the shorter recentX/Y/Z used for gain below — confirmed via real
  // device logs that ~2s was too short to reliably resolve low
  // frequencies (barely one full cycle at 0.5Hz).
  const fx = freqWin?.x ?? recentX;
  const fy = freqWin?.y ?? recentY;
  const fz = freqWin?.z ?? recentZ;

  // Only trust a dominant-frequency reading when there's enough real signal
  // above the noise floor for it to be meaningful — confirmed via a
  // motionless-device test that, absent this gate, the FFT reports
  // whichever bin happens to have the most noise energy as if it were a
  // real frequency (readings of 10-20Hz+ with zero actual movement).
  // MIN_INTENSITY_FOR_FREQ mirrors roughly the low end of the "Mild"
  // tremor band — comfortably above sensor noise, well below requiring
  // strong/obvious movement.
  let combined = null;
  if (level >= MIN_INTENSITY_FOR_FREQ) {
    combined = combinedDominantFreq(fx, fy, fz, sr || 50, 100);
    if (combined != null) {
      smoothedFreq = smoothedFreq == null ? combined : smoothedFreq * (1 - FREQ_SMOOTHING_ALPHA) + combined * FREQ_SMOOTHING_ALPHA;
    }
  } else if (smoothedFreq != null) {
    smoothedFreq = smoothedFreq * (1 - FREQ_DECAY_ALPHA) + SOURCE_FREQ_MIN_HZ * FREQ_DECAY_ALPHA;
    if (Math.abs(smoothedFreq - SOURCE_FREQ_MIN_HZ) < 0.05) smoothedFreq = null; // fully settled — fresh start next time real movement resumes
  }
  cachedMappedFreq =
    smoothedFreq != null
      ? mapRange(smoothedFreq, SOURCE_FREQ_MIN_HZ, SOURCE_FREQ_MAX_HZ, config.minFreq, config.maxFreq)
      : null;
  // Gated behind SONIFICATION_DEBUG_LOGGING — see that flag's comment above.
  if (SONIFICATION_DEBUG_LOGGING) {
    console.log('[sonification]', 'sr=' + (sr || 50).toFixed?.(1), 'level=' + level.toFixed(1), 'rawFreq=' + (combined != null ? combined.toFixed(2) : 'null'), 'smoothedFreq=' + (smoothedFreq != null ? smoothedFreq.toFixed(2) : 'null'), 'mappedFreq=' + (cachedMappedFreq != null ? cachedMappedFreq.toFixed(1) : 'null'));
  }

  if (cachedMappedFreq != null && Math.abs(cachedMappedFreq - lastSent.freq) > FREQ_EPSILON) {
    voice.setFrequency(cachedMappedFreq);
    lastSent.freq = cachedMappedFreq;
  }

  const normLevel = level / 100;
  const gain = normLevel * config.maxGain;

  if (Math.abs(gain - lastSent.gain) > GAIN_EPSILON) {
    voice.setGain(gain);
    lastSent.gain = gain;
  }
  if (Math.abs(normLevel - lastSent.bright) > BRIGHT_EPSILON) {
    voice.setBrightness(normLevel);
    lastSent.bright = normLevel;
  }
  if (DUAL_LAYER_ENABLED && Math.abs(normLevel - lastSent.intensity) > INTENSITY_EPSILON) {
    voice.setIntensity(normLevel);
    lastSent.intensity = normLevel;
  }
}

export function silenceAudio() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  cello?.stopHard(t);
  viola?.stopHard(t);
  violin?.stopHard(t);
  lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
  lastFreqComputeTime = 0;
  cachedMappedFreq = null;
  smoothedFreq = null;
}

// Buffer sources are one-shot per the Web Audio spec — once stopped they
// can't be restarted, so a full teardown means the *next* initAudio() call
// builds a fresh graph from scratch. In practice this stays unused (the
// audio graph is built once and kept alive for the app's lifetime — see
// RecordingScreen.js).
export function destroyAudio() {
  if (!audioCtx) return;
  try {
    cello?.stopSource();
    viola?.stopSource();
    violin?.stopSource();
    audioCtx.close?.();
  } catch (e) {
    // already stopped/closed — fine to ignore
  }
  audioCtx = null;
  masterGain = null;
  cello = viola = violin = null;
}
