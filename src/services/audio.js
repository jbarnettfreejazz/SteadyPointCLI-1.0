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
//
// "custom" is NOT a recorded sample at all — per tester feedback asking
// for a cleaner/more precise tone than a pitch-shifted instrument sample,
// it's a pure sine-wave oscillator (see SineVoice below) at the user's own
// chosen pan/gain, mapping the combined dominant frequency into a
// user-defined minFreq/maxFreq range. minFreq/maxFreq here are just the
// startup defaults (200-700Hz, per the product spec); setCustomTonalRange()
// below overwrites them from the user's persisted Settings choice at
// session start.
const VOICE_CONFIG = {
  cello: { pan: -0.45, minFreq: 65, maxFreq: 130, maxGain: 0.4 },
  viola: { pan: 0, minFreq: 196, maxFreq: 330, maxGain: 0.25 },
  violin: { pan: 0.45, minFreq: 392, maxFreq: 784, maxGain: 0.4 },
  custom: { pan: 0, minFreq: 200, maxFreq: 700, maxGain: 0.25 },
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
//
// Was temporarily on for the sixth/seventh follow-up diagnostics (see
// README) — confirmed on-device that the seventh follow-up's linear-ramp
// fix resolved the pulsation (no pulsation during the exact same
// fast/large transitions that reliably reproduced it before), so back
// to off.
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
    this.softStretcher.semitones.setTargetAtTime(semitones, t, FREQ_RAMP_TIME_CONSTANT);
    if (DUAL_LAYER_ENABLED) this.loudStretcher.semitones.setTargetAtTime(semitones, t, FREQ_RAMP_TIME_CONSTANT);
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

// Backs the "custom" voice — a pure sine-wave tone at the mapped tremor
// frequency, with the same pan/filter/gain staging as SampleVoice above,
// but no sample to load and no pitch-shifting: the oscillator's own
// `frequency` AudioParam is just set directly to the mapped Hz value.
// Per Web Audio API spec, an OscillatorNode can only be start()ed once —
// so unlike SampleVoice (whose sample loading is async and gates `ready`),
// this is constructed, started, and immediately ready, all synchronously.
class SineVoice {
  constructor(ctx, { pan, maxFreq }) {
    this.ctx = ctx;

    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = pan;

    this.output = ctx.createGain();
    this.output.gain.value = 0;

    // Same expressive "brightness" lowpass as SampleVoice — on a pure sine
    // this mostly has no effect (a sine has no harmonics to filter out),
    // but is kept for consistency/headroom if the waveform type changes
    // later, and costs nothing to leave in.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2400;
    this.filter.Q.value = 1.0;
    this.filter.connect(this.output);
    this.output.connect(this.pan);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    // Starting frequency doesn't matter — overwritten by the first real
    // setFrequency() call once a dominant frequency is detected. Seeded at
    // maxFreq's midpoint-ish rather than the Web Audio default (440Hz) just
    // so a stray early update isn't a jarring out-of-range jump.
    this.osc.frequency.value = maxFreq;
    this.osc.connect(this.filter);
    this.osc.start(ctx.currentTime);

    // EIGHTH follow-up: see stopHard()'s comment below — these track each
    // AudioParam's most recently scheduled linear ramp END time, so
    // stopHard() can neutralize a still-pending one.
    this.gainRampEndTime = 0;
    this.freqRampEndTime = 0;
    this.brightRampEndTime = 0;
  }

  // Always ready immediately — no async sample load to wait on.
  get ready() {
    return true;
  }

  connect(node) {
    this.pan.connect(node);
  }

  // SEVENTH follow-up: a real device log (see README) showed pulsation
  // severity tracking the RATE/SIZE of level swings, not elapsed session
  // time — ruling out event accumulation (the SIXTH follow-up's theory)
  // and pointing at the retargeting itself. setTargetAtTime() schedules an
  // *exponential* approach toward a target; every time a new value arrives
  // before the previous approach finished, the curve's direction kinks.
  // During vigorous, fast-swinging motion this can happen close to 20x/sec
  // (the throttle ceiling) — a kink every ~50ms, each one audible.
  //
  // Fix: use linearRampToValueAtTime() instead, explicitly anchored with
  // setValueAtTime() at the parameter's own current value, spanning
  // rampSec (the ACTUAL elapsed time since the previous push, passed in by
  // the caller — not a fixed assumed interval, since real packet timing
  // jitters a little around the 50ms throttle). Each ramp's end is exactly
  // where the next one starts, so consecutive ramps chain into one
  // continuous piecewise-linear glide with no exponential-curve kink at
  // the seams, regardless of how fast or large the underlying swings are.
  setFrequency(freq, rampSec) {
    const t = this.ctx.currentTime;
    this.osc.frequency.setValueAtTime(this.osc.frequency.value, t);
    this.osc.frequency.linearRampToValueAtTime(freq, t + rampSec);
    this.freqRampEndTime = t + rampSec;
  }

  setGain(level, rampSec) {
    const t = this.ctx.currentTime;
    this.output.gain.setValueAtTime(this.output.gain.value, t);
    this.output.gain.linearRampToValueAtTime(level, t + rampSec);
    this.gainRampEndTime = t + rampSec;
  }

  setBrightness(value, rampSec) {
    const v = Math.pow(Math.max(0, Math.min(1, value)), 0.7);
    const cutoff = 800 + v * 2800;
    const t = this.ctx.currentTime;
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    this.filter.frequency.linearRampToValueAtTime(cutoff, t + rampSec);
    this.brightRampEndTime = t + rampSec;
  }

  // EIGHTH follow-up: reported bug — sonification kept audibly playing
  // after End Session, specifically on Custom. Cause: the SEVENTH
  // follow-up switched setGain() (above) to schedule a discrete-future-
  // end-time linearRampToValueAtTime(), unlike Cello/Viola/Violin's
  // setTargetAtTime() (an open-ended asymptotic curve with no scheduled
  // end event). If this stopHard() call's setValueAtTime(0, t) landed
  // while that ramp's end time was still in the future — routine, since
  // gain pushes happen up to 20x/sec during an active session, right up
  // until the moment End Session is pressed — the already-scheduled ramp
  // doesn't get cancelled (cancelScheduledValues() is avoided here; see
  // the dated SIGSEGV note near the top of this file) and still fires
  // afterward: per the Web Audio automation-event model, our fresh
  // setValueAtTime(0, t) becomes that ramp's new start point, so it
  // ramps from 0 back UP to its old target by its original end time —
  // and then just sits there, since nothing is scheduled afterward to
  // bring it back down.
  //
  // Fix: re-assert silence a second time, slightly AFTER the LATEST
  // scheduled ramp end-time we know about (gainRampEndTime, always kept
  // current by setGain() above) — STALE_RAMP_GUARD_SEC past it, not AT
  // it, deliberately: scheduling our override at the exact same
  // timestamp as the stale ramp's own end event would leave two events
  // tied at that instant, and which one wins at a tie is implementation-
  // defined — exactly the kind of ambiguity to avoid rather than risk.
  // Being strictly later than any ramp that could still be pending, this
  // second zero reliably wins once that stale ramp finishes playing out
  // its (now brief, bounded) resurgence, instead of leaving gain stuck
  // at its last nonzero value indefinitely. Frequency/brightness get the
  // same guard for consistency, even though they're inaudible once gain
  // is pinned at 0 — this also prevents a stray pending pitch/brightness
  // ramp from this session bleeding into whatever the oscillator does
  // when the next session re-anchors it.
  stopHard(t) {
    this.output.gain.setValueAtTime(0, t);
    if (this.gainRampEndTime > t) this.output.gain.setValueAtTime(0, this.gainRampEndTime + STALE_RAMP_GUARD_SEC);
    if (this.freqRampEndTime > t) this.osc.frequency.setValueAtTime(this.osc.frequency.value, this.freqRampEndTime + STALE_RAMP_GUARD_SEC);
    if (this.brightRampEndTime > t) this.filter.frequency.setValueAtTime(this.filter.frequency.value, this.brightRampEndTime + STALE_RAMP_GUARD_SEC);
  }

  stopSource() {
    try {
      this.osc.stop();
    } catch (e) {
      // already stopped, or never started — fine to ignore
    }
  }
}

let audioCtx = null;
let masterGain = null;
let cello = null,
  viola = null,
  violin = null,
  custom = null;

// Which single instrument is active for the current session — set once at
// startSession() time from the user's Settings choice, held fixed for the
// session's whole duration (mirrors setFullScaleG() in liveSession.js).
let activeVoiceName = 'cello';

export function setActiveVoice(name) {
  activeVoiceName = VOICE_CONFIG[name] ? name : 'cello';
}

// Called once at startSession() time (see sessionLogic.js) with the user's
// persisted Settings > Sonification > Tonal Range > Custom values, mirroring
// setActiveVoice()/setFullScaleG()'s "fixed for the session" pattern. Falls
// back to the existing custom range (or the 200-700Hz default above) on
// invalid input rather than throwing, since this runs on every session start.
export function setCustomTonalRange(minHz, maxHz) {
  const lo = Number(minHz);
  const hi = Number(maxHz);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= lo) return;
  VOICE_CONFIG.custom.minFreq = lo;
  VOICE_CONFIG.custom.maxFreq = hi;
}

// "custom" plays through its own SineVoice instance (see VOICE_CONFIG
// comment above) rather than a recorded sample.
function activeVoice() {
  return { cello, viola, violin, custom }[activeVoiceName];
}

// EIGHTH follow-up: see SineVoice.stopHard()'s comment above — the small
// buffer stopHard() schedules its post-ramp silence override past, rather
// than at, a stale ramp's own end time, to avoid an implementation-defined
// tie between two automation events at the exact same timestamp. A few
// milliseconds is plenty; it just needs to be > 0 and inaudible.
const STALE_RAMP_GUARD_SEC = 0.01;

let lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
const FREQ_EPSILON = 2; // Hz
const GAIN_EPSILON = 0.03;
const BRIGHT_EPSILON = 0.02;
const INTENSITY_EPSILON = 0.04;

// The FFT-based frequency recompute is meaningfully more CPU work than
// this engine has done before at its per-packet (~50Hz) cadence — see
// the file header note. Volume/brightness stay fully responsive every
// call (see updateAudio() below); only the expensive FFT/frequency part
// is throttled to this interval.
//
// CONFIRMED buzzy/pulsing artifact on the Custom sine voice (reported by
// testers, investigated via an outside code review — see
// investigation-notes.md): gain/frequency/brightness were ALL gated
// behind this same 300ms throttle until the first fix pass, each using a
// short setTargetAtTime() time constant (0.05-0.08s) that reached its
// target well within the 300ms gap and then sat perfectly flat until the
// next recompute — a periodic "snap, then hold" pattern repeating
// ~3.3x/sec, an audible periodic modulation in its own right, independent
// of actual CPU load. Fixed for all four voices by (1) decoupling
// gain/brightness from this throttle — they update every packet now —
// and (2) lengthening FREQ_RAMP_TIME_CONSTANT (below) for the FFT-based
// path's pitch ramp.
//
// That reduced, but didn't eliminate, the buzz specifically on Custom —
// which led to comparing against the team's separate Flutter/PWA app's
// sonification (a *different* codebase, `use-tremor-audio.ts`), confirmed
// via direct source review to sound clean for a more fundamental reason:
// it never uses an FFT for pitch at all. It drives pitch from std() (a
// cheap, continuously-computable statistic — see dsp.js) updated on every
// sample with zero throttling, not from this engine's FFT-based
// combinedDominantFreq() recomputed only every 300ms on a 5-second
// window. A sine has no harmonic content to mask ANY residual jitter in
// its pitch source, however small — the sample-based voices' own
// continuous timbral motion (bow noise, vibrato, broadband harmonics)
// buries the exact same FFT jitter completely, which is why only Custom
// ever exposed this, even after the throttle/ramp fix above reduced it.
//
// RESULT: Custom's pitch now bypasses this whole FFT-gated section
// entirely — see the `activeVoiceName === 'custom'` branch in
// updateAudio() below, which computes pitch directly from `normLevel`
// (the same already-calibrated 0-100 tremor level used for gain, no new
// signal needed) every packet, with no FFT, no throttle, and no
// smoothing-lag. This does change what Custom's pitch represents — from
// "the tremor's oscillation frequency" to "how much the motion is
// spreading," matching the Flutter/PWA app's actual (proven-clean)
// design — a deliberate, explicitly-confirmed product choice, scoped to
// Custom only. Cello/Viola/Violin keep the original FFT-based "pitch =
// dominant tremor frequency" design below, unchanged — their sample
// timbre already masks this fine, and there's no reason to touch a
// design that isn't broken for them.
const FREQ_RECOMPUTE_INTERVAL_MS = 300;
let lastFreqComputeTime = 0;
let cachedMappedFreq = null;

// Time constant for setFrequency()'s setTargetAtTime() ramp on the
// FFT-based path (SampleVoice's pitch-shifter — Cello/Viola/Violin only,
// see the buzzy/pulsing fix note above). Deliberately close to
// FREQ_RECOMPUTE_INTERVAL_MS itself, so pitch is still smoothly moving
// (not sitting flat) right up until the next recompute, rather than
// snapping to target early and holding.
const FREQ_RAMP_TIME_CONSTANT = 0.25;

// CONFIRMED (follow-up, after the FFT-removal fix above): a ~1-2 second
// periodic pulsation remained on Custom even with a stable, clean
// waveform — not present on Cello (whose pitch stays FFT-based) or on
// the Flutter/PWA app. Leading explanation: tremorLevel is the RMS of a
// ~2-second rolling window (ROLL_WIN in liveSession.js) — if the actual
// motion being measured has its own period anywhere near that window
// length (e.g. a ~0.5-1Hz test shake), a window that short relative to
// the signal's own period doesn't produce a flat RMS value; it
// genuinely ripples once per cycle of the input motion. That ripple has
// always been present in tremorLevel and already fed gain on every
// voice, but a volume ripple is subtle and easy to miss, especially
// under a sample's own texture. Now that Custom's pitch ALSO tracks
// this exact same level signal (the fix above), every bit of that
// ripple becomes an audible pitch wobble instead — far more
// perceptually salient than the same-sized volume wobble, and
// impossible for a bare sine to mask. Cello's pitch is immune since
// frequency-domain peak-picking doesn't care how much the amplitude
// envelope ripples.
//
// Fix: smooth the level value feeding Custom's PITCH specifically
// (gain stays fully responsive, unsmoothed, as before) via a simple
// exponential blend applied once per packet. CUSTOM_LEVEL_SMOOTHING_ALPHA
// is tuned for a ~0.4s time constant at the engine's assumed ~50Hz
// per-packet cadence (alpha = 1 - e^(-dt/tau), dt≈0.02s, tau≈0.4s) —
// long enough to substantially damp a single ~1-2s ripple cycle, short
// enough that genuine tremor onset/offset (which unfolds over multiple
// seconds) still comes through promptly.
const CUSTOM_LEVEL_SMOOTHING_ALPHA = 0.05;
let customSmoothedLevel = null;

// SECOND follow-up (the smoothing fix above reduced, but didn't eliminate,
// the pulsation — now reported as occurring specifically WHILE the tremor
// level is actively rising or falling, not during a steady level).
// Leading explanation, given this engine's own documented history: Cello's
// pitch gets a new value at most ~3.3x/sec (FREQ_RECOMPUTE_INTERVAL_MS).
// Custom's FREQ_EPSILON gate, by contrast, rarely trips during a STEADY
// level (the computed frequency stays within 2Hz of lastSent.freq, so
// setFrequency() is barely called) but trips on nearly every packet while
// the level is actively changing (the target keeps drifting past the
// epsilon) — meaning Custom can burst 40-50 setFrequency() calls/sec
// specifically during the moments this bug reportedly occurs, far more
// than Cello ever issues. This exact native library has already shown a
// real scheduling limitation once before in this project (the
// cancelScheduledValues() SIGSEGV, traced to however many accumulated
// AudioParam automation events had built up) — a burst of rapid-fire
// setFrequency() calls landing on the native audio graph is a plausible
// trigger for a similar, non-crashing glitch.
//
// Fix: throttle how often Custom actually PUSHES a new frequency to the
// native oscillator to this interval — customSmoothedLevel itself still
// updates every packet (cheap, pure JS, no native call), only the
// setFrequency() call + epsilon check below is throttled. Still far more
// responsive than Cello's 300ms, while cutting Custom's native call
// volume during transitions by more than half.
const CUSTOM_PITCH_UPDATE_INTERVAL_MS = 50;
let lastCustomPitchUpdateTime = 0;

// SEVENTH follow-up (see the fuller comment further below, near the push
// counters): each linear ramp needs to span the ACTUAL elapsed time since
// that specific parameter's own previous push, not a fixed interval —
// gain/brightness/frequency don't always push on the same tick (their
// epsilon gates differ), so a shared timestamp would understate the gap
// for whichever one pushes less often. 0 means "no push yet this
// session," which setFrequency/setGain/setBrightness's callers treat as
// a signal to fall back to CUSTOM_RAMP_FALLBACK_SEC.
let customGainLastPushMs = 0;
let customBrightLastPushMs = 0;
let customFreqLastPushMs = 0;

// Fallback ramp duration for Custom's (SineVoice's) linear ramps — see the
// SEVENTH follow-up comment on SineVoice's setFrequency/setGain/
// setBrightness, further below. Only used for the very first push of a
// session (there is no previous push yet to measure a real elapsed gap
// from); every push after that uses the actual measured elapsed time
// instead. Matches CUSTOM_PITCH_UPDATE_INTERVAL_MS's own cadence as a
// reasonable default.
const CUSTOM_RAMP_FALLBACK_SEC = CUSTOM_PITCH_UPDATE_INTERVAL_MS / 1000;

// SIXTH follow-up diagnostic: reported pulsation starts clean at session
// start, gets MORE frequent the longer the session runs, and only during
// active level changes (never at rest or holding steady) — a pattern
// that fits scheduled-AudioParam-event accumulation (this exact native
// library crashed once before from exactly that, see the
// cancelScheduledValues() SIGSEGV note above) rather than a per-transition
// artifact alone. Custom's oscillator is one persistent node, live for
// the whole session, pushed far more often (every 50ms here) than Cello's
// pitch-shifter ever is (every 300ms) — so if events really are piling up
// unboundedly, Custom should accumulate roughly 6x faster.
//
// FIRST ATTEMPT AT THIS BUG: a single customPushCount incremented right
// after the throttle gate, unconditionally. CONFIRMED WRONG by a real
// device log — at complete rest (level=0, gain/freq never changing),
// it still climbed at the same ~17/sec rate as an actively-changing run,
// because it was counting throttle-gate passes (i.e. just elapsed time
// at ~20Hz), not actual native AudioParam calls. Useless for telling
// accumulation apart from the passage of time.
//
// Fixed version: three separate counters, each incremented ONLY inside
// the branch that actually calls voice.setGain/setBrightness/setFrequency
// (i.e. only when the epsilon check trips and a real automation event is
// scheduled on that AudioParam). Kept separate rather than summed because
// each is a distinct AudioParam with its own internal event history —
// gain/brightness/frequency could in principle accumulate at different
// rates. customSessionStartMs marks when counting started from zero, so
// the debug line can show elapsed session time alongside each count.
let customGainPushCount = 0;
let customBrightPushCount = 0;
let customFreqPushCount = 0;
let customSessionStartMs = 0;

// SEVENTH follow-up — the SIXTH follow-up's accumulation theory TESTED
// AND REJECTED: a real device log (see README) showed pulsation starting
// at ~5s into a BRAND NEW session (right as motion began after a steady
// hold) and clearly worsening at ~25s specifically during fast, large
// level swings — not gradually over minutes. freqPush climbed ~15.6/sec
// during the worst stretch, close to the throttle ceiling; nowhere does
// severity track elapsed session time independent of how fast/large the
// swings are. Accumulation predicts worse-over-minutes regardless of
// motion; this log shows worse-with-vigor within seconds. Rejected.
//
// Real mechanism: setTargetAtTime() schedules an EXPONENTIAL approach
// toward a target. Every time a new value lands before the previous
// approach finished — which happens up to ~20x/sec (the throttle
// ceiling) during vigorous motion — the curve's direction kinks. Each
// kink is a small discontinuity in the derivative of gain/pitch/
// brightness, and enough of them close together is audible as
// pulsation, worse exactly when swings are fast/large (more frequent,
// bigger kinks) — matching the log precisely.
//
// Fix: SineVoice's setFrequency/setGain/setBrightness (below) now use
// linearRampToValueAtTime() instead, each ramp spanning exactly the real
// elapsed time since the previous push. Consecutive linear ramps chain
// together with no curve-direction kink at the seams, however fast or
// large the underlying swings are. Scoped to Custom only — Cello/Viola/
// Violin's pitch-shifter keeps its original setTargetAtTime() ramp,
// unchanged, since nobody has reported this as a problem there.

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
  custom = new SineVoice(audioCtx, { pan: VOICE_CONFIG.custom.pan, maxFreq: VOICE_CONFIG.custom.maxFreq });

  cello.connect(masterGain);
  viola.connect(masterGain);
  violin.connect(masterGain);
  custom.connect(masterGain);

  cello.loadPair(bundledAssetPath('cello'), bundledAssetPath('cello_loud')).catch((e) => console.warn('cello samples failed to load:', e.message));
  viola.loadPair(bundledAssetPath('viola'), bundledAssetPath('viola_loud')).catch((e) => console.warn('viola samples failed to load:', e.message));
  violin.loadPair(bundledAssetPath('violin'), bundledAssetPath('violin_loud')).catch((e) => console.warn('violin samples failed to load:', e.message));
  // custom (SineVoice) needs no loadPair() — it's synchronously ready, see
  // its class comment above.

  lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
  lastFreqComputeTime = 0;
  cachedMappedFreq = null;
  customSmoothedLevel = null;
  lastCustomPitchUpdateTime = 0;
  customGainLastPushMs = 0;
  customBrightLastPushMs = 0;
  customFreqLastPushMs = 0;
  customGainPushCount = 0;
  customBrightPushCount = 0;
  customFreqPushCount = 0;
  customSessionStartMs = Date.now();
}

// recentX/Y/Z are the rolling packet buffers from liveSession.js.
// tremorLevel is the same 0-100 intensity value shown elsewhere in the
// app. sr is the current estimated packet rate (see liveSession.js).
export function updateAudio(recentX, recentY, recentZ, tremorLevel, sr, freqWin) {
  const voice = activeVoice();
  if (!voice || !voice.ready) return; // still loading samples
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const config = VOICE_CONFIG[activeVoiceName];
  const level = Math.max(0, Math.min(100, tremorLevel || 0));
  const normLevel = level / 100;

  // THIRD follow-up, and the actual root cause of the whole pulsation saga:
  // tremorLevel ISN'T continuous. It's recomputed by updateLiveMetrics()'s
  // own separate 300ms timer in liveSession.js, not by this function —
  // so even though updateAudio() runs every packet (~20ms), the VALUE it
  // reads only changes ~3.3x/sec. It's a staircase, not a smooth curve.
  // During a steady tremor, consecutive steps are nearly identical, so
  // the staircase is invisible. During an actively rising or falling
  // level, each 300ms step is a real, audible jump. The two fixes above
  // smoothed PITCH against exactly this, but gain/brightness were never
  // smoothed at all — directly exposed to this same staircase the whole
  // time, on every voice, since the very first build. A volume jump every
  // 300ms during a change is a literal pulsation, in both directions —
  // this has likely been the dominant real cause all along, just far
  // less audible wrapped in Viola's/Cello's own texture than on a bare
  // sine (the same "sine exposes everything" theme throughout this whole
  // investigation).
  //
  // Fix, scoped to Custom only: gain and brightness now read the SAME
  // smoothed level already computed for pitch (customSmoothedLevel),
  // instead of raw normLevel — so all three move together off one
  // continuous signal, rather than gain/brightness jumping in steps
  // while pitch glides smoothly beside them (which could itself read as
  // a mismatched-timing artifact, separate from the staircase itself).
  // Cello/Viola/Violin's gain/brightness remain unsmoothed/fully
  // responsive below, matching the original design intent — nobody has
  // reported this as a problem for them, and there's no reason to trade
  // away their responsiveness pre-emptively.
  if (activeVoiceName === 'custom') {
    // NINTH follow-up: reported bug — after tremoring, returning the stick
    // to true rest (Intensity reading of 0) left a faint tone playing
    // instead of true silence, on Custom specifically. This is the same
    // class of issue the three stringed tonal ranges' gain/brightness were
    // already protected against (see the "updated every call... NOT
    // smoothed" comment on Cello/Viola/Violin's own gain/brightness
    // further below) — they read raw normLevel directly, so at rest
    // (normLevel=0) their gain is exactly 0 on the very next packet, no
    // lag. Custom's gain/brightness, by contrast, read customSmoothedLevel
    // (the FOURTH follow-up), an exponential blend that only ever
    // approaches 0 asymptotically and never mathematically reaches it.
    // Combined with GAIN_EPSILON/BRIGHT_EPSILON only pushing a new value
    // when it differs from the last one by more than the epsilon, the
    // decay eventually slows to sub-epsilon steps and simply stops being
    // pushed — stranding gain at whatever small nonzero value it last
    // reached, indefinitely, as an audible floor.
    //
    // Fix: treat normLevel === 0 (true rest) as a special case — snap
    // customSmoothedLevel directly to 0 instead of blending toward it, and
    // below, let the resulting gain/brightness push happen unconditionally
    // (bypassing GAIN_EPSILON/BRIGHT_EPSILON) whenever the last sent value
    // isn't already exactly 0. This guarantees rest always actually
    // reaches true silence, the same way Cello/Viola/Violin already do,
    // without touching their unsmoothed path or weakening the epsilon
    // gates that fixed the FOURTH follow-up's AM-sideband pulsation during
    // genuine active transitions (this only ever fires once motion has
    // fully stopped).
    const atRest = normLevel === 0;
    // See CUSTOM_LEVEL_SMOOTHING_ALPHA's comment above. Updated every
    // packet (cheap, pure JS) regardless of the native-push throttle below.
    customSmoothedLevel = atRest ? 0 : (customSmoothedLevel == null ? normLevel : customSmoothedLevel * (1 - CUSTOM_LEVEL_SMOOTHING_ALPHA) + normLevel * CUSTOM_LEVEL_SMOOTHING_ALPHA);

    // FOURTH follow-up: smoothing gain/brightness (the fix above) made the
    // pulsation MORE rapid and pulled it closer in pitch to the carrier —
    // worse, not better. Cause: customSmoothedLevel creeps toward its
    // target by a small amount on every packet (~20ms), and GAIN_EPSILON/
    // BRIGHT_EPSILON are small enough that nearly every packet's tiny
    // creep still trips them. That meant setGain()/setBrightness() were
    // each re-targeting the native exponential ramp every 20-40ms during
    // a transition — a new ramp target arriving before the previous one
    // had settled, every single packet. Rapid re-targeting like that reads
    // as amplitude modulation at a packet-rate frequency (tens of Hz),
    // which is exactly "more rapid" and, as AM sidebands sitting right next
    // to the carrier, exactly "closer in pitch to the underlying tone."
    // Pitch below was already spared this because CUSTOM_PITCH_UPDATE_INTERVAL_MS
    // already throttled its native push — gain/brightness never had that
    // same throttle, so they got the full brunt of it.
    //
    // Fix: throttle the native push for gain/brightness the exact same way
    // as pitch, using the SAME interval/clock, so all three update together
    // once per CUSTOM_PITCH_UPDATE_INTERVAL_MS instead of gain/brightness
    // retargeting on every packet while pitch waits. customSmoothedLevel
    // itself keeps updating every packet underneath — only how often that
    // value reaches the native AudioParams is gated.
    const nowMs = Date.now();
    if (nowMs - lastCustomPitchUpdateTime < CUSTOM_PITCH_UPDATE_INTERVAL_MS) return;
    lastCustomPitchUpdateTime = nowMs;
    if (customSessionStartMs === 0) customSessionStartMs = nowMs;

    const gain = customSmoothedLevel * config.maxGain;
    if (atRest ? gain !== lastSent.gain : Math.abs(gain - lastSent.gain) > GAIN_EPSILON) {
      const gainRampSec = customGainLastPushMs ? (nowMs - customGainLastPushMs) / 1000 : CUSTOM_RAMP_FALLBACK_SEC;
      voice.setGain(gain, gainRampSec);
      lastSent.gain = gain;
      customGainLastPushMs = nowMs;
      customGainPushCount += 1; // see the counters' comment above
    }
    if (atRest ? customSmoothedLevel !== lastSent.bright : Math.abs(customSmoothedLevel - lastSent.bright) > BRIGHT_EPSILON) {
      const brightRampSec = customBrightLastPushMs ? (nowMs - customBrightLastPushMs) / 1000 : CUSTOM_RAMP_FALLBACK_SEC;
      voice.setBrightness(customSmoothedLevel, brightRampSec);
      lastSent.bright = customSmoothedLevel;
      customBrightLastPushMs = nowMs;
      customBrightPushCount += 1;
    }

    // Exponential (not linear) interpolation between minFreq/maxFreq —
    // equal increases in level produce equal-sized pitch steps in
    // perceptual (octave) space, matching the Flutter/PWA app's own
    // octave-based mapping, rather than equal steps in raw Hz. (This is
    // the pitch MAPPING curve, unrelated to the SEVENTH follow-up's linear
    // vs exponential RAMP SCHEDULING fix below — both "exponential" but
    // about different things.)
    const freq = config.minFreq * Math.pow(config.maxFreq / config.minFreq, customSmoothedLevel);
    if (Math.abs(freq - lastSent.freq) > FREQ_EPSILON) {
      const freqRampSec = customFreqLastPushMs ? (nowMs - customFreqLastPushMs) / 1000 : CUSTOM_RAMP_FALLBACK_SEC;
      voice.setFrequency(freq, freqRampSec);
      lastSent.freq = freq;
      customFreqLastPushMs = nowMs;
      customFreqPushCount += 1;
    }
    // Gated behind SONIFICATION_DEBUG_LOGGING — see that flag's comment above.
    // elapsedSec + the three push counts are the diagnostic for the
    // within-session escalation report — see the counters' comment above.
    // If pulsation onset/worsening tracks a rising push count rather than
    // elapsedSec alone, that points at event accumulation; if it tracks
    // elapsedSec regardless of how many pushes have actually happened
    // (e.g. mostly holding steady, counts barely moving, but it still
    // degrades), that rules it out.
    if (SONIFICATION_DEBUG_LOGGING) {
      const elapsedSec = customSessionStartMs ? ((nowMs - customSessionStartMs) / 1000).toFixed(1) : '0.0';
      console.log('[sonification:custom]', 'elapsedSec=' + elapsedSec, 'gainPush=' + customGainPushCount, 'brightPush=' + customBrightPushCount, 'freqPush=' + customFreqPushCount, 'level=' + level.toFixed(1), 'smoothedLevel=' + (customSmoothedLevel * 100).toFixed(1), 'gain=' + gain.toFixed(3), 'freq=' + freq.toFixed(1));
    }
    return; // skip the generic/FFT-based path below entirely
  }

  // Gain/brightness (Cello/Viola/Violin only): updated every call (real
  // BLE packet cadence, ~50Hz) — deliberately NOT gated behind the FFT
  // throttle below. See the buzzy/pulsing-artifact fix note on
  // FREQ_RECOMPUTE_INTERVAL_MS above: these used to wait on that same
  // 300ms gate, which produced a perceptible ~3.3Hz "snap, then hold"
  // stepping in volume — inaudible under a sample's own timbral motion.
  // Decoupling them removes that stepping for these three voices.
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

  // Frequency (Cello/Viola/Violin only): the FFT-based recompute is
  // meaningfully more CPU work than anything else this engine does at
  // per-packet cadence, so only this part stays throttled to
  // FREQ_RECOMPUTE_INTERVAL_MS.
  const now = Date.now();
  if (now - lastFreqComputeTime < FREQ_RECOMPUTE_INTERVAL_MS) return;
  lastFreqComputeTime = now;

  // Uses the dedicated longer window (see FREQ_WIN in liveSession.js), not
  // the shorter recentX/Y/Z used for gain above — confirmed via real
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
}

export function silenceAudio() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  cello?.stopHard(t);
  viola?.stopHard(t);
  violin?.stopHard(t);
  custom?.stopHard(t);
  lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
  lastFreqComputeTime = 0;
  cachedMappedFreq = null;
  smoothedFreq = null;
  customSmoothedLevel = null;
  lastCustomPitchUpdateTime = 0;
  customGainLastPushMs = 0;
  customBrightLastPushMs = 0;
  customFreqLastPushMs = 0;
  customGainPushCount = 0;
  customBrightPushCount = 0;
  customFreqPushCount = 0;
  customSessionStartMs = 0;
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
    custom?.stopSource();
    audioCtx.close?.();
  } catch (e) {
    // already stopped/closed — fine to ignore
  }
  audioCtx = null;
  masterGain = null;
  cello = viola = violin = custom = null;
}
