import { AudioContext } from 'react-native-audio-api';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { mean } from '../utils/dsp';

// ══════════════════════════════════════════════════════
// AUDIO SONIFICATION — SAMPLE-BASED STRING TRIO, DUAL VELOCITY LAYERS
// Real recorded string samples (VSCO 2 Community Edition, CC0-licensed —
// verified directly against the LICENSE file in the source repo before
// use), pitch-shifted live via StretcherNode. Each voice now crossfades
// between TWO recordings of the same note at different bow velocities
// (soft/gentle vs loud/aggressive), rather than just turning the volume
// up and down on a single recording — a real player sounds different
// bowing harder, not just louder, and this reflects that.
//
// Bundled via react-native.config.js + `npx react-native-asset` — re-run
// that if the files in src/assets/audio/ ever change.
//
// IMPORTANT / UNVERIFIED: this library's note-naming convention (e.g. a
// cello file labeled "C1") appears to be shifted one octave from standard
// scientific pitch notation — a real cello can't play standard C1 (32.7Hz),
// so "C1" here most likely means standard C2 (65.4Hz). REFERENCE_FREQ below
// reflects that best guess.
//
// Cadence: this was throttled to ~300ms (called from liveSession.js's
// updateLiveMetrics) because calling react-native-audio-api's
// setTargetAtTime at full BLE packet rate (~50Hz) choked an earlier,
// oscillator-based engine. Now on a per-packet cadence again (called from
// pushPacket) as an experiment — StretcherNode is a different code path
// than raw OscillatorNode automation, so the original limitation may not
// apply here. If pitch/volume freezing or stalling reappears under real
// movement, that confirms the same limitation extends to this node type
// too, and this should revert to the throttled cadence.
// ══════════════════════════════════════════════════════

const ASSET_FILES = {
  cello: 'cello.wav',
  cello_loud: 'cello_loud.wav',
  viola: 'viola.wav',
  viola_loud: 'viola_loud.wav',
  violin: 'violin.wav',
  violin_loud: 'violin_loud.wav',
};

// Best-guess reference pitch of each bundled sample — see note above. Soft
// and loud layers are the same physical note, so they share one reference.
const REFERENCE_FREQ = {
  cello: 65.41, // labeled "C1" — assumed standard C2
  viola: 196.0, // labeled "G2" — assumed standard G3
  violin: 440.0, // labeled "A4" — assumed standard A4 (Solo Violin subset, may use standard notation)
};

// Per-voice input trim, compensating for each source recording's own
// measured peak level (checked directly, not assumed) so all three reach
// a common, properly audible level before our existing dynamic gain-
// staging (caps, master, delta-driven volume) touches the signal — see
// SampleVoice's trim gain node. Measured peaks: cello -15.4 dBFS, viola
// -21.7 dBFS, violin -20.5 dBFS. Target is -4 dBFS, chosen to leave
// substantial headroom even in the worst case (all three voices peaking
// simultaneously at full gain-cap) — verified well under half of maximum
// before this would risk clipping.
const TRIM_DB = {
  cello: 11.4, // -15.4 -> -4 dBFS
  viola: 17.7, // -21.7 -> -4 dBFS
  violin: 16.5, // -20.5 -> -4 dBFS
};

function bundledAssetPath(name) {
  const fileName = ASSET_FILES[name];
  if (Platform.OS === 'ios') {
    return `${RNFS.MainBundlePath}/${fileName}`;
  }
  // Unverified — see file header note in the previous single-layer version.
  return `file:///android_asset/custom/${fileName}`;
}

// See the detailed comment on loadPair() below for what this controls and
// why it currently defaults to false.
const DUAL_LAYER_ENABLED = false;

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
    // peak, not just assumed) — cello/viola/violin source files peak at
    // roughly -15/-22/-21 dBFS respectively, well below full scale, so our
    // existing dynamic gain-staging below was operating on an already-faint
    // signal. This trim brings each voice up to a common, properly audible
    // level *before* that existing gain logic touches it, so none of the
    // existing safety margins/caps need to change.
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

  // Loads both velocity layers together and keeps them phase-locked —
  // each is a different recording of different length, so if loaded and
  // started independently (as soon as each individually finished
  // decoding), they'd loop on their own separate timing, unsynchronized
  // with each other. Crossfading into an unsynchronized loop position on
  // the other layer produced an audible stutter/attack artifact (reported
  // as "staccato"). Using one shared absolute loop window (based on
  // whichever file is shorter) and starting both sources at the exact
  // same scheduled time keeps them always at the same relative position
  // in their loop, so the crossfade blends cleanly regardless of when it
  // happens.
  // DIAGNOSTIC: when false, only the soft layer loads/plays — the loud
  // layer (and its StretcherNode) is skipped entirely, halving the number
  // of concurrent real-time pitch-shifters running (3 instead of 6 across
  // all voices). This directly tests whether that computational load is
  // the source of the reported "static"/staccato artifact, which several
  // rounds of smoothing/timing fixes haven't resolved — if disabling the
  // second layer eliminates it, that confirms a performance ceiling rather
  // than a tunable parameter, and the dual-layer approach needs a
  // fundamentally different, lighter-weight design.
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

    // Small forward offset so both start() calls land on the same sample-
    // accurate instant rather than racing each other at "now".
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
  // in [0,1], 0 = fully soft/gentle bowing, 1 = fully loud/aggressive
  // bowing. This is a genuine timbre change (a different recording), not
  // just a volume change — matches how a real player sounds different
  // bowing harder, not merely louder. Equal-power crossfade (cos/sin) for
  // a smoother perceptual blend than a straight linear fade.
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
  // so a session end is immediately silent rather than tailing off. Safe to
  // call even before loadPair() resolves (touches only the gain node,
  // built in the constructor).
  stopHard(t) {
    this.output.gain.cancelScheduledValues(t);
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

// Shared scale reference for pitch quantization — see quantizeToScale()
// below. All three voices quantize against this SAME root/scale, so no
// matter what each axis is doing independently, the notes they land on
// are always drawn from one consistent, consonant set rather than
// arbitrary continuous frequencies that can clash.
const SCALE_ROOT = 261.6256; // C4 (concert middle C)
// Major pentatonic: no half-step (dissonant) intervals between any two
// scale degrees, which is what makes this forgiving even under
// unpredictable, independent input.
const SCALE_INTERVALS = [0, 2, 4, 7, 9];

// Snaps a frequency to the nearest note in SCALE_INTERVALS (repeating
// every octave, relative to SCALE_ROOT) — works across any octave range
// since it's based on semitone distance from the root, not a fixed table.
function quantizeToScale(freq) {
  if (freq <= 0) return freq;
  const semitonesFromRoot = 12 * Math.log2(freq / SCALE_ROOT);
  const octave = Math.floor(semitonesFromRoot / 12);
  const withinOctave = semitonesFromRoot - octave * 12;

  let best = SCALE_INTERVALS[0];
  let bestDist = Math.abs(withinOctave - SCALE_INTERVALS[0]);
  for (const iv of SCALE_INTERVALS) {
    const d = Math.abs(withinOctave - iv);
    if (d < bestDist) {
      bestDist = d;
      best = iv;
    }
  }
  const distToNextOctaveRoot = Math.abs(withinOctave - 12);
  if (distToNextOctaveRoot < bestDist) {
    return SCALE_ROOT * Math.pow(2, octave + 1);
  }

  const nearestSemitone = octave * 12 + best;
  return SCALE_ROOT * Math.pow(2, nearestSemitone / 12);
}

let audioCtx = null;
let masterGain = null;
let cello = null,
  viola = null,
  violin = null;

// Per-voice mute state — X (cello), Y (viola), Z (violin), matching the
// axis mapping already used throughout the app. Lives here (not in the
// UI/reducer) so it takes effect immediately regardless of update cadence,
// and resets automatically at the start of each new session (see
// silenceAudio(), called at every session end).
let muted = { cello: false, viola: false, violin: false };

export function setVoiceMuted(voice, isMuted) {
  if (!(voice in muted)) return;
  muted[voice] = isMuted;
  // Silence immediately on mute, rather than waiting for the next natural
  // update cycle — unmuting doesn't need this, the next updateAudio() call
  // resumes normal dynamic gain control on its own.
  if (isMuted && audioCtx) {
    const voiceNode = { cello, viola, violin }[voice];
    voiceNode?.setGain(0);
  }
}

export function getMutedVoices() {
  return { ...muted };
}

let prevX = 0,
  prevY = 0,
  prevZ = 0;

let lastSent = {
  fx: 0,
  fy: 0,
  fz: 0,
  gx: -1,
  gy: -1,
  gz: -1,
  bx: -1,
  by: -1,
  bz: -1,
  ix: -1,
  iy: -1,
  iz: -1,
};
const FREQ_EPSILON = 2; // Hz
const GAIN_EPSILON = 0.03;
const BRIGHT_EPSILON = 0.02;
const INTENSITY_EPSILON = 0.04;

export function isAudioInitialized() {
  return !!audioCtx;
}

export function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.93;
  masterGain.connect(audioCtx.destination);

  cello = new SampleVoice(audioCtx, { pan: -0.45, referenceFreq: REFERENCE_FREQ.cello, trimDb: TRIM_DB.cello });
  viola = new SampleVoice(audioCtx, { pan: 0, referenceFreq: REFERENCE_FREQ.viola, trimDb: TRIM_DB.viola });
  violin = new SampleVoice(audioCtx, { pan: 0.45, referenceFreq: REFERENCE_FREQ.violin, trimDb: TRIM_DB.violin });

  cello.connect(masterGain);
  viola.connect(masterGain);
  violin.connect(masterGain);

  cello.loadPair(bundledAssetPath('cello'), bundledAssetPath('cello_loud')).catch((e) => console.warn('cello samples failed to load:', e.message));
  viola.loadPair(bundledAssetPath('viola'), bundledAssetPath('viola_loud')).catch((e) => console.warn('viola samples failed to load:', e.message));
  violin.loadPair(bundledAssetPath('violin'), bundledAssetPath('violin_loud')).catch((e) => console.warn('violin samples failed to load:', e.message));

  prevX = 0;
  prevY = 0;
  prevZ = 0;
  lastSent = { fx: 0, fy: 0, fz: 0, gx: -1, gy: -1, gz: -1, bx: -1, by: -1, bz: -1, ix: -1, iy: -1, iz: -1 };
}

// recentX/Y/Z are the rolling packet buffers from liveSession.js.
export function updateAudio(recentX, recentY, recentZ) {
  if (!cello || !cello.ready || !viola.ready || !violin.ready) return; // still loading samples
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const RECENT_WINDOW = 4;
  const rawX = recentX.length ? mean(recentX.slice(-RECENT_WINDOW)) : 0;
  const rawY = recentY.length ? mean(recentY.slice(-RECENT_WINDOW)) : 0;
  const rawZ = recentZ.length ? mean(recentZ.slice(-RECENT_WINDOW)) : 0;

  const x = Math.min(Math.max(rawX, 0), 1);
  const y = Math.min(Math.max(rawY, 0), 1);
  const z = Math.min(Math.max(rawZ, 0), 1);

  const celloFreq = quantizeToScale(65 + x * 65);
  const violaFreq = quantizeToScale(196 + y * 134);
  const violinFreq = quantizeToScale(392 + z * 392);

  const dx = Math.abs(x - prevX);
  const dy = Math.abs(y - prevY);
  const dz = Math.abs(z - prevZ);
  prevX = x;
  prevY = y;
  prevZ = z;

  const gCello = muted.cello ? 0 : Math.min(dx * 4.0, 0.4);
  const gViola = muted.viola ? 0 : Math.min(dy * 4.0, 0.25);
  const gViolin = muted.violin ? 0 : Math.min(dz * 4.0, 0.4);

  // Same underlying movement signal as gain (delta since last update), but
  // normalized to [0,1] uncapped by each voice's volume ceiling — this
  // drives the soft/loud velocity-layer crossfade, so "louder" and "more
  // vigorous bowing" track the same intensity together rather than being
  // independent.
  const iCello = Math.min(dx * 4.0, 1);
  const iViola = Math.min(dy * 4.0, 1);
  const iViolin = Math.min(dz * 4.0, 1);

  if (Math.abs(celloFreq - lastSent.fx) > FREQ_EPSILON) {
    cello.setFrequency(celloFreq);
    lastSent.fx = celloFreq;
  }
  if (Math.abs(violaFreq - lastSent.fy) > FREQ_EPSILON) {
    viola.setFrequency(violaFreq);
    lastSent.fy = violaFreq;
  }
  if (Math.abs(violinFreq - lastSent.fz) > FREQ_EPSILON) {
    violin.setFrequency(violinFreq);
    lastSent.fz = violinFreq;
  }

  if (Math.abs(gCello - lastSent.gx) > GAIN_EPSILON) {
    cello.setGain(gCello);
    lastSent.gx = gCello;
  }
  if (Math.abs(gViola - lastSent.gy) > GAIN_EPSILON) {
    viola.setGain(gViola);
    lastSent.gy = gViola;
  }
  if (Math.abs(gViolin - lastSent.gz) > GAIN_EPSILON) {
    violin.setGain(gViolin);
    lastSent.gz = gViolin;
  }

  if (Math.abs(iCello - lastSent.ix) > INTENSITY_EPSILON) {
    cello.setIntensity(iCello);
    lastSent.ix = iCello;
  }
  if (Math.abs(iViola - lastSent.iy) > INTENSITY_EPSILON) {
    viola.setIntensity(iViola);
    lastSent.iy = iViola;
  }
  if (Math.abs(iViolin - lastSent.iz) > INTENSITY_EPSILON) {
    violin.setIntensity(iViolin);
    lastSent.iz = iViolin;
  }

  if (Math.abs(x - lastSent.bx) > BRIGHT_EPSILON) {
    cello.setBrightness(x);
    lastSent.bx = x;
  }
  if (Math.abs(y - lastSent.by) > BRIGHT_EPSILON) {
    viola.setBrightness(y);
    lastSent.by = y;
  }
  if (Math.abs(z - lastSent.bz) > BRIGHT_EPSILON) {
    violin.setBrightness(z);
    lastSent.bz = z;
  }
}

export function silenceAudio() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  cello?.stopHard(t);
  viola?.stopHard(t);
  violin?.stopHard(t);
  lastSent = { fx: 0, fy: 0, fz: 0, gx: -1, gy: -1, gz: -1, bx: -1, by: -1, bz: -1, ix: -1, iy: -1, iz: -1 };
  muted = { cello: false, viola: false, violin: false };
}

// Buffer sources are one-shot per the Web Audio spec — once stopped they
// can't be restarted, so a full teardown means the *next* initAudio() call
// builds a fresh graph from scratch. In practice this stays unused (the
// audio graph is built once and kept alive for the app's lifetime — see
// RecordingScreen.js), same reasoning as before: closing and recreating a
// native AudioContext back-to-back was unreliable on this library's
// current version.
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
