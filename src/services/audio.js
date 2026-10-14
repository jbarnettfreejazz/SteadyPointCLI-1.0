import { AudioContext } from 'react-native-audio-api';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

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

// Per-instrument base trim (TWENTY-SECOND follow-up: now the base for each
// instrument's zone trims — see ZonedSampleVoice), originally compensating
// for each source recording's own measured peak level (checked directly,
// not assumed). Measured peaks:
// cello -15.4 dBFS, viola -21.7 dBFS, violin -20.5 dBFS; target -4 dBFS.
const TRIM_DB = {
  cello: 11.4,
  viola: 17.7,
  violin: 16.5,
};

// Each voice's pitch range (intensity 0 -> minFreq, 100 -> maxFreq,
// exponential/octave-space mapping) and output volume ceiling.
//
// TWENTY-SECOND follow-up: Cello/Viola/Violin are multi-sampled
// ZonedSampleVoices driven by the smooth pipeline (pitch follows
// INTENSITY, like Custom), each spanning its instrument's sampled range:
//   cello  65-1000Hz (C2 up; promoted from the Twenty-first follow-up's
//          "Cello A (test)", which replaced the original single-sample
//          Cello; "Cello B (test)" was removed)
//   viola  131-1175Hz (C3-D6, the full VSCO Viola Section range)
//   violin 196-1568Hz (G3-G6; the C7 sample exists but 2kHz+ is shrill
//          for continuous sonification)
// pan/maxGain are unchanged from the original instruments.
//
// "custom" is NOT a recorded sample — a pure sine-wave oscillator (see
// SineVoice below). minFreq/maxFreq here are just the startup defaults
// (200-700Hz, per the product spec); setCustomTonalRange() overwrites them
// from the user's persisted Settings choice at session start.
const VOICE_CONFIG = {
  cello: { pan: -0.45, minFreq: 65, maxFreq: 1000, maxGain: 0.4 },
  viola: { pan: 0, minFreq: 131, maxFreq: 1175, maxGain: 0.25 },
  violin: { pan: 0.45, minFreq: 196, maxFreq: 1568, maxGain: 0.4 },
  custom: { pan: 0, minFreq: 200, maxFreq: 700, maxGain: 0.25 },
};

// Voices that use the smoothed, intensity-driven, linear-ramp pipeline in
// updateAudio() (originally Custom-only). Since the TWENTY-SECOND follow-up
// that's every voice.
const SMOOTH_PIPELINE_VOICES = new Set(['cello', 'viola', 'violin', 'custom']);

// TWENTY-FIRST follow-up: multi-sampled cello (originally "Cello A"). The library's
// pitch-shifter clamps `semitones` to -12..+12 (StretcherNode.cpp), so a
// single recording can never span 65-1000Hz (~4 octaves). Instead, seven
// VSCO 2 CE "Cello Section / susvib" notes (CC0 — see AUDIO_SOURCES.md),
// one every perfect fifth, each pitch-shifted at most ~+/-3.5 semitones
// (the top note up to ~+6 to reach 1000Hz).
//
// refHz and loopRmsDb were MEASURED, not assumed (YIN pitch tracking and
// RMS over the 20%-80% loop region, mono mix). The library's labels are
// consistently one octave low (file "C1" = C2 at 65.40Hz — confirming the
// original engine's REFERENCE_FREQ assumption); every note is within 4 cents of
// equal temperament. cello.wav is byte-identical to the C2 zone's source,
// so it's reused rather than duplicated.
//
// Loudness: recordings differ by up to ~10dB, so each zone gets its own
// trim that matches its loop RMS to cello.wav's (ZONE_LOUDNESS_REF_DB) on
// top of the existing TRIM_DB.cello — Cello A stays at the level of the
// original sample, and hand-offs don't jump in volume. Higher notes may
// still sound louder on a phone speaker (better high-frequency response);
// tune per-zone by ear if so.
const CELLO_ZONES = [
  { file: 'cello.wav', refHz: 65.4, loopRmsDb: -29.4 }, // C2 (VSCO "C1")
  { file: 'cello_g2.wav', refHz: 97.98, loopRmsDb: -31.5 }, // G2 (VSCO "G1")
  { file: 'cello_d3.wav', refHz: 146.84, loopRmsDb: -30.6 }, // D3 (VSCO "D2")
  { file: 'cello_a3.wav', refHz: 219.91, loopRmsDb: -35.8 }, // A3 (VSCO "A2")
  { file: 'cello_e4.wav', refHz: 329.43, loopRmsDb: -35.7 }, // E4 (VSCO "E3")
  { file: 'cello_b4.wav', refHz: 493.87, loopRmsDb: -39.6 }, // B4 (VSCO "B3")
  { file: 'cello_f5.wav', refHz: 699.14, loopRmsDb: -38.5 }, // F5 (VSCO "F4")
];

// TWENTY-SECOND follow-up: same approach for Viola and Violin, from the
// same VSCO sets their original single samples came from (both CC0):
//  - Viola Section / susvib (soft v1 layer): labels one octave low like the
//    cello. Six notes a fifth apart, C3-B5; viola.wav (G3) is reused.
//    Top note shifts up ~+3 semitones to reach D6/1175Hz.
//  - Solo Violin / Arco Vib (soft "p" layer): labels match standard
//    notation (the original violin.wav measured A4 = 440.18Hz). Seven
//    notes G3-G6, alternating fourth/fifth steps (that set has G/A/C/E per
//    octave, no D). The solo player's intonation varies a little (C4 is
//    +21c, G6 +13c sharp) — irrelevant, since refHz is the MEASURED pitch.
//    G3's fundamental is weak (-28dB, third harmonic strongest, normal for
//    a violin's open G string); pitch verified at 195.5Hz from the
//    harmonic series, since autocorrelation tracking locked onto h3.
// Each instrument's zones are trimmed to match its ORIGINAL sample's loop
// RMS (refRmsDb), so each instrument keeps the level it had before.
const VIOLA_ZONES = [
  { file: 'viola_c3.wav', refHz: 130.83, loopRmsDb: -41.2 }, // C3 (VSCO "C2")
  { file: 'viola.wav', refHz: 196.07, loopRmsDb: -37.4 }, // G3 (VSCO "G2") — the original viola.wav
  { file: 'viola_d4.wav', refHz: 293.75, loopRmsDb: -41.5 }, // D4 (VSCO "D3")
  { file: 'viola_a4.wav', refHz: 440.06, loopRmsDb: -38.6 }, // A4 (VSCO "A3")
  { file: 'viola_e5.wav', refHz: 659.54, loopRmsDb: -41.2 }, // E5 (VSCO "E4")
  { file: 'viola_b5.wav', refHz: 989.03, loopRmsDb: -42.8 }, // B5 (VSCO "B4")
];
const VIOLIN_ZONES = [
  { file: 'violin_g3.wav', refHz: 195.5, loopRmsDb: -37.1 }, // G3
  { file: 'violin_c4.wav', refHz: 264.79, loopRmsDb: -33.1 }, // C4 (+21c)
  { file: 'violin_g4.wav', refHz: 391.82, loopRmsDb: -42.3 }, // G4
  { file: 'violin_c5.wav', refHz: 522.8, loopRmsDb: -29.4 }, // C5
  { file: 'violin_g5.wav', refHz: 786.28, loopRmsDb: -39.7 }, // G5
  { file: 'violin_c6.wav', refHz: 1043.09, loopRmsDb: -40.0 }, // C6
  { file: 'violin_g6.wav', refHz: 1579.92, loopRmsDb: -44.3 }, // G6 (+13c)
];
// Loop RMS of each instrument's ORIGINAL single sample — the loudness
// reference its zones are matched to (cello.wav / viola.wav / the removed
// violin.wav, A4 Solo Violin p).
const ZONE_LOUDNESS_REF_DB = { cello: -29.4, viola: -37.4, violin: -37.0 };
// Hand-off crossfade between neighbouring zones. Both zones track pitch in
// unison during the fade, so it's heard as a timbre blend, not a jump.
const ZONE_XFADE_SEC = 0.3;
// A neighbouring zone must be this many semitones closer than the current
// one before switching — stops rapid back-and-forth hand-offs when pitch
// hovers near the midpoint between two notes.
const ZONE_HYSTERESIS_SEMITONES = 1.0;

function bundledFilePath(fileName) {
  if (Platform.OS === 'ios') {
    return `${RNFS.MainBundlePath}/${fileName}`;
  }
  // Unverified — this project's real device testing has been iOS-only.
  return `file:///android_asset/custom/${fileName}`;
}

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
//
// TENTH follow-up: back on again — reported "lower tonal range sounds
// buzzy, higher is smooth" on Custom. Ruled out via quick no-code test:
// raising the Custom range's floor from 200Hz to 400Hz did NOT move or
// remove the buzz, so it isn't a fixed absolute-Hz band. Need a real
// capture (freq/gain/smoothedLevel per push, same fields as before) with
// onset/offset narrated against elapsedSec to find the real correlation,
// same methodology that found the actual pulsation cause.
//
// CONFIRMED (see the bisection test below): the buzzing was the
// BiquadFilter node, not Custom-specific and not a scheduling issue.
// Debug logging no longer needed for this investigation — back to off.
//
// ELEVENTH follow-up: back on again — investigating the reported
// "sonification continues after End Session" recurrence (Custom only,
// inconsistent duration across repeats — stops immediately / a few
// seconds / until Return to Home / past Home). Combined with the new
// absolute-timestamp '[sonification:hook]' (liveSession.js) and
// '[sonification:silence]' logs, a capture around End Session should
// show whether a packet is reaching updateAudio() after setAudioHook(null)
// runs (a hook re-registration or a late-arriving-packet race) or
// whether the EIGHTH follow-up's existing stopHard() guard is simply
// being outrun by a ramp scheduled after silenceAudio() already ran.
const SONIFICATION_DEBUG_LOGGING = false;

// TENTH follow-up, continued: the debug-log capture showed buzzing present
// even during several seconds of a completely static hold (fixed
// frequency, fixed gain, zero automation events firing) — ruling out
// every scheduling/retargeting-rate theory above. Confirmed present on
// Cello too (just less noticeable, "more integrated" into its own sample
// texture) — so this isn't Custom-specific or oscillator-specific either;
// it's shared chain. SampleVoice and SineVoice share nothing but the
// BiquadFilter -> GainNode -> StereoPannerNode -> masterGain -> destination
// plumbing and the underlying AudioContext, so bisect that shared chain:
// flip one of these to true to route around that node (construction-time
// wiring — restart the app/session after changing either) and see which
// one, if any, makes the buzz go away. Brightness has no audible effect
// while BYPASS_FILTER is true (the filter is simply not in the signal
// path), and panning is lost while BYPASS_PANNER is true — both expected,
// diagnostic-only side effects.
//
// CONFIRMED on-device with BYPASS_FILTER=true: the buzzing is completely
// gone on both Custom and Cello, across thorough testing. The
// BiquadFilterNode is the real root cause. Two things surfaced during
// that same testing, both logged here and deliberately NOT addressed yet
// (by explicit choice, to keep this fix focused):
//   1. A periodic/intermittent pulsation on Cello specifically, not
//      present on Custom. Possibly the long-standing, deliberately-
//      unsmoothed Cello gain path (see the THIRD-follow-up-era comment on
//      "Gain/brightness (Cello/Viola/Violin only)" further below) being
//      slightly more exposed now that the filter isn't incidentally
//      softening transients — unconfirmed, not yet investigated.
//   2. The intermittent "sonification continues after End Session" bug
//      recurring in some new case, separate from the EIGHTH follow-up's
//      stale-ramp fix (which was Custom/SineVoice-specific) — repro not
//      yet captured.
// DECISION: ship with BYPASS_FILTER=true rather than chase a filter fix
// or a brightness replacement right now — clean tone takes priority, and
// brightness is paused (not removed) until the filter question is
// revisited. So despite the name, this is the deliberate current
// shipping configuration, not a temporary diagnostic-only state; treat
// changing it back to false as a real product decision, not a revert.
// BYPASS_PANNER was never implicated and stays false.
const BYPASS_FILTER = true;
const BYPASS_PANNER = false;

// Backs the "custom" voice — a pure sine-wave tone at the mapped tremor
// frequency, with the same pan/filter/gain staging as SampleVoice above,
// but no sample to load and no pitch-shifting: the oscillator's own
// `frequency` AudioParam is just set directly to the mapped Hz value.
// Per Web Audio API spec, an OscillatorNode can only be start()ed once —
// so unlike SampleVoice (whose sample loading is async and gates `ready`),
// this is constructed, started, and immediately ready, all synchronously.
class SineVoice {
  constructor(ctx, { pan, maxFreq, harmonics = null }) {
    this.ctx = ctx;

    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = pan;

    this.output = ctx.createGain();
    this.output.gain.value = 0;

    // Same expressive "brightness" lowpass as SampleVoice — on a pure sine
    // this mostly has no effect (a sine has no harmonics to filter out),
    // but is kept for consistency/headroom if the waveform type changes
    // later, and costs nothing to leave in.
    //
    // TENTH follow-up: BYPASS_FILTER/BYPASS_PANNER (see their comment near
    // SONIFICATION_DEBUG_LOGGING) route around this node, or the
    // StereoPannerNode below, for the shared-chain bisection test.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2400;
    this.filter.Q.value = 1.0;
    if (!BYPASS_FILTER) this.filter.connect(this.output);
    if (!BYPASS_PANNER) this.output.connect(this.pan);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    // TWENTIETH follow-up: optional harmonic waveform (built for the since-
    // removed "Cello B" prototype; currently unused, harmless) — same
    // oscillator, same smooth control path, richer timbre. Imaginary
    // (sine) coefficients carry the amplitudes; real (cosine) are zero.
    if (harmonics) {
      const real = harmonics.map(() => 0);
      this.osc.setPeriodicWave(ctx.createPeriodicWave(real, harmonics.slice()));
    }
    // Starting frequency doesn't matter — overwritten by the first real
    // setFrequency() call once a dominant frequency is detected. Seeded at
    // maxFreq's midpoint-ish rather than the Web Audio default (440Hz) just
    // so a stray early update isn't a jarring out-of-range jump.
    this.osc.frequency.value = maxFreq;
    this.osc.connect(BYPASS_FILTER ? this.output : this.filter);
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
    (BYPASS_PANNER ? this.output : this.pan).connect(node);
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

// TWENTY-FIRST follow-up: multi-sampled voice (Cello since the TWENTY-SECOND
// follow-up, Viola and Violin too). Originally replaced the
// Twentieth follow-up's SmoothSampleAdapter (single cello.wav, 65-130Hz) —
// same interface and smooth-pipeline semantics as SineVoice (linear ramps
// anchored at the current value over the caller's capped rampSec, stale-
// ramp guard in stopHard()), but pitch is spread across CELLO_ZONES.
//
// Each zone is its own looping buffer source -> stretcher -> zone gain
// (trim x crossfade). A zone's gain node is connected to the shared output
// ONLY while that zone is in use: this library renders by pulling from the
// destination (AudioNode::processAudio recurses through connected inputs),
// so a disconnected zone's real-time pitch-shifter does no work. At most
// two zones run at once (during a ZONE_XFADE_SEC hand-off). Running too
// many simultaneous pitch-shifters has hit this device's CPU ceiling
// before (see DUAL_LAYER_ENABLED).
//
// Pitch per zone: the stretcher's `semitones` param, ramped linearly
// (= exponential in Hz, matching the smooth pipeline's octave-space
// mapping), anchored at the zone's own last target. A zone that has just
// been (re)connected jumps straight to its target pitch — inaudible, since
// its crossfade gain starts from 0.
class ZonedSampleVoice {
  constructor(ctx, { pan, zones, baseTrimDb, refRmsDb }) {
    this.ctx = ctx;
    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = pan;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    if (!BYPASS_PANNER) this.output.connect(this.pan);
    this.zones = zones.map((z) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      return {
        ...z,
        trim: Math.pow(10, (baseTrimDb + refRmsDb - z.loopRmsDb) / 20),
        gain,
        source: null,
        stretcher: null,
        connected: false,
        lastSemitones: null,
        disconnectTimer: null,
      };
    });
    this.loaded = false;
    this.activeIndex = -1;
    this.gainRampEndTime = 0;
    this.freqRampEndTime = 0;
  }

  get ready() {
    return this.loaded;
  }

  connect(node) {
    (BYPASS_PANNER ? this.output : this.pan).connect(node);
  }

  async load() {
    const buffers = await Promise.all(this.zones.map((z) => this.ctx.decodeAudioDataSource(bundledFilePath(z.file))));
    buffers.forEach((buffer, i) => {
      const z = this.zones[i];
      z.stretcher = this.ctx.createStretcher();
      z.source = this.ctx.createBufferSource();
      z.source.buffer = buffer;
      z.source.loop = true;
      z.source.loopStart = buffer.duration * 0.2; // same loop region as SampleVoice
      z.source.loopEnd = buffer.duration * 0.8;
      z.source.connect(z.stretcher);
      z.stretcher.connect(z.gain);
      // z.gain is deliberately NOT connected yet — see class comment.
      z.source.start(this.ctx.currentTime);
    });
    this.loaded = true;
  }

  _semitonesFor(z, freq) {
    return Math.max(-12, Math.min(12, 12 * Math.log2(freq / z.refHz)));
  }

  _nearestIndex(freq) {
    let best = 0;
    let bestDist = Infinity;
    this.zones.forEach((z, i) => {
      const d = Math.abs(Math.log2(freq / z.refHz));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  _connectZone(z) {
    if (z.disconnectTimer) {
      clearTimeout(z.disconnectTimer);
      z.disconnectTimer = null;
    }
    if (!z.connected) {
      z.gain.connect(this.output);
      z.connected = true;
      z.lastSemitones = null; // stale — jump to target on next pitch push
      return true;
    }
    return false;
  }

  _scheduleDisconnect(z) {
    if (z.disconnectTimer) clearTimeout(z.disconnectTimer);
    z.disconnectTimer = setTimeout(() => {
      z.disconnectTimer = null;
      if (z.connected && this.zones[this.activeIndex] !== z) {
        z.gain.disconnect(this.output);
        z.connected = false;
      }
    }, (ZONE_XFADE_SEC + 0.1) * 1000);
  }

  // Picks (and if needed crossfades to) the zone for `freq`.
  _selectZone(freq, t) {
    const best = this._nearestIndex(freq);
    if (this.activeIndex < 0) {
      const z = this.zones[best];
      this._connectZone(z);
      z.gain.gain.setValueAtTime(z.trim, t);
      this.activeIndex = best;
      return;
    }
    if (best === this.activeIndex) return;
    const cur = this.zones[this.activeIndex];
    const next = this.zones[best];
    const distCur = Math.abs(12 * Math.log2(freq / cur.refHz));
    const distNext = Math.abs(12 * Math.log2(freq / next.refHz));
    if (distCur - distNext < ZONE_HYSTERESIS_SEMITONES) return;

    const wasConnected = !this._connectZone(next);
    next.gain.gain.setValueAtTime(wasConnected ? next.gain.gain.value : 0, t);
    next.gain.gain.linearRampToValueAtTime(next.trim, t + ZONE_XFADE_SEC);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
    cur.gain.gain.linearRampToValueAtTime(0, t + ZONE_XFADE_SEC);
    this._scheduleDisconnect(cur);
    this.activeIndex = best;
    if (SONIFICATION_DEBUG_LOGGING) console.log('[sonification:zone]', cur.file, '->', next.file, 'at', freq.toFixed(1) + 'Hz');
  }

  setGain(level, rampSec) {
    const g = this.output.gain;
    const t = this.ctx.currentTime;
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + rampSec);
    this.gainRampEndTime = t + rampSec;
  }

  setFrequency(freq, rampSec) {
    const t = this.ctx.currentTime;
    this._selectZone(freq, t);
    for (const z of this.zones) {
      if (!z.connected) continue;
      const semis = this._semitonesFor(z, freq);
      const p = z.stretcher.semitones;
      p.setValueAtTime(z.lastSemitones ?? semis, t);
      p.linearRampToValueAtTime(semis, t + rampSec);
      z.lastSemitones = semis;
    }
    this.freqRampEndTime = t + rampSec;
  }

  setBrightness() {
    // no-op — BYPASS_FILTER keeps the filter out of every chain
  }

  // Same guard as SineVoice.stopHard() (EIGHTH follow-up).
  stopHard(t) {
    const g = this.output.gain;
    g.setValueAtTime(0, t);
    if (this.gainRampEndTime > t) g.setValueAtTime(0, this.gainRampEndTime + STALE_RAMP_GUARD_SEC);
    if (this.freqRampEndTime > t) {
      for (const z of this.zones) {
        if (z.connected && z.lastSemitones != null) {
          z.stretcher.semitones.setValueAtTime(z.lastSemitones, this.freqRampEndTime + STALE_RAMP_GUARD_SEC);
        }
      }
    }
  }

  stopSource() {
    for (const z of this.zones) {
      try {
        z.source?.stop();
      } catch (e) {
        // already stopped, or never started — fine to ignore
      }
    }
  }

  // Session end / sonification toggled OFF (called from silenceAudio(),
  // after stopHard() and the masterGain mute): disconnect every zone so no
  // pitch-shifter keeps running between sessions; the next session starts
  // fresh on whichever zone its first pitch selects.
  release() {
    const t = this.ctx.currentTime;
    for (const z of this.zones) {
      if (z.disconnectTimer) {
        clearTimeout(z.disconnectTimer);
        z.disconnectTimer = null;
      }
      z.gain.gain.setValueAtTime(0, t);
      if (z.connected) {
        z.gain.disconnect(this.output);
        z.connected = false;
      }
      z.lastSemitones = null;
    }
    this.activeIndex = -1;
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
  // TWENTY-SECOND follow-up: 'cello_a'/'cello_b' (Twentieth/Twenty-first
  // follow-up prototypes) no longer exist — anything unknown falls back to
  // 'cello' (also migrated in persistence.js).
  activeVoiceName = VOICE_CONFIG[name] ? name : 'cello';
}

export function unmuteAudio() {
  if (masterGain) masterGain.gain.value = MASTER_GAIN_LEVEL;
}

// EIGHTEENTH follow-up: background audio. Info.plist now declares the
// `audio` UIBackgroundModes entry, so sonification keeps playing when the
// app is backgrounded mid-session (react-native-audio-api 0.4.18 already
// configures AVAudioSession as Playback on start/resume — checked in its
// ios/audioapi/ios/core/AudioPlayer.m — so no category change is needed).
//
// But this module deliberately keeps one AudioContext alive for the app's
// whole lifetime (see RecordingScreen.js), and a running AVAudioEngine
// counts as "playing audio" to iOS even when it's rendering pure silence —
// with the `audio` background mode, that alone would keep the app alive in
// the background indefinitely after its first sonification session,
// draining battery and contrary to App Store guideline 2.5.4. So the
// engine is now paused (AudioContext.suspend()) whenever sonification is
// silenced — End Session, or the in-session toggle turned OFF — and
// resumed when it's enabled again. This is suspend/resume, NOT close/
// rebuild (the latter is the thing found unreliable on this library
// before): the graph, sources, and oscillator all stay intact.
//
// Native suspend()/resume() each run on their own detached std::thread
// (see AudioContextHostObject.h), so two calls issued close together (a
// quick OFF->ON toggle) could otherwise execute out of order and leave the
// engine paused while sonification is supposedly on. engineQueue chains
// them so each runs only after the previous one has completed.
//
// Kill switch: if suspend/resume misbehaves on-device (e.g. no sound in
// a second session, or a crash on session start), set this to false — the
// engine then stays running as before, and the only cost is the
// battery/backgrounding concern above.
const SUSPEND_ENGINE_WHEN_SILENT = true;
let engineSuspended = false; // our own intent, not the native state
let engineOpsInFlight = 0;
let engineQueue = Promise.resolve();

function queueEngineOp(label, op) {
  engineOpsInFlight += 1;
  engineQueue = engineQueue
    .then(op)
    .catch((e) => console.warn(`[sonification:engine] ${label} failed:`, e?.message))
    .finally(() => {
      engineOpsInFlight -= 1;
    });
}

function suspendEngine() {
  if (!SUSPEND_ENGINE_WHEN_SILENT || !audioCtx || engineSuspended) return;
  engineSuspended = true;
  const ctx = audioCtx;
  console.log('[sonification:engine]', 'suspend at', Date.now());
  queueEngineOp('suspend', () => ctx.suspend());
}

// Called by RecordingScreen whenever sonification becomes active for a
// recording session (session start with sound on, or the toggle turned
// ON) — alongside unmuteAudio().
export function resumeAudio() {
  if (!audioCtx || !engineSuspended) return;
  engineSuspended = false;
  const ctx = audioCtx;
  console.log('[sonification:engine]', 'resume at', Date.now());
  queueEngineOp('resume', () => ctx.resume());
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
// TWENTIETH follow-up: pitch-relative push threshold for the non-Custom
// smooth voices (see the pitchMoved check in updateAudio()). 0.1 semitone
// is ~0.6% in frequency — below a noticeable step, comparable to what 2Hz
// gives Custom across its own range.
const PITCH_EPSILON_SEMITONES = 0.1;
const GAIN_EPSILON = 0.03;
const BRIGHT_EPSILON = 0.02;

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
//
// TWENTY-SECOND follow-up: the FFT-based pitch path described above is
// gone — every voice (Cello/Viola/Violin as multi-sampled ZonedSampleVoices,
// Custom as SineVoice) now uses the smooth, intensity-driven pipeline in
// updateAudio(). The history above is kept for context; see README.

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

// FOURTEENTH follow-up: upper bound on every Custom linear ramp. The
// SEVENTH follow-up sized each ramp to the real elapsed time since that
// parameter's previous push — correct during active change, but that gap
// is UNBOUNDED: GAIN_EPSILON (0.03 on a 0-0.25 gain range, ~8 steps
// total) means gain pushes stop entirely during any steady stretch, so
// the next push after a hold gets a ramp as long as the hold itself. A
// real device log showed rampSec values of 2-9s routinely (22 of 73 gain
// pushes >1s, max 9.36s). Effects: (1) volume responds seconds late after
// any steady stretch; (2) a long ramp still in flight when stopHard() runs
// isn't cancelled (cancelScheduledValues() is unsafe here — see the
// SIGSEGV note at the top), so it climbs back up from 0 until its
// original end time — the mechanism behind sound at displayed Intensity 0
// and the variable-length post-End-Session sound (now also backstopped by
// the THIRTEENTH follow-up's masterGain mute).
//
// 0.3s rather than something shorter: the same log shows gaps between
// consecutive pushes during genuine active change are mostly 0.12-0.36s,
// so a 0.3s cap leaves the SEVENTH follow-up's seamless ramp chaining
// intact during motion (avoiding a "ramp, then hold" stepping pattern,
// the kind of periodic modulation fixed several follow-ups ago), while
// bounding post-hold lag and any stale-ramp resurgence to 0.3s.
const CUSTOM_RAMP_MAX_SEC = 0.3;

// Ramp length for a Custom push: real elapsed time since this parameter's
// previous push (SEVENTH follow-up), capped at CUSTOM_RAMP_MAX_SEC
// (FOURTEENTH follow-up); falls back to CUSTOM_RAMP_FALLBACK_SEC for the
// first push of a session.
function customRampSec(nowMs, lastPushMs) {
  if (!lastPushMs) return CUSTOM_RAMP_FALLBACK_SEC;
  return Math.min((nowMs - lastPushMs) / 1000, CUSTOM_RAMP_MAX_SEC);
}

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

export function isAudioInitialized() {
  return !!audioCtx;
}

// THIRTEENTH follow-up: named so silenceAudio()'s mute and
// unmuteAudio()'s restore (below) can't drift out of sync with the
// value set here at construction.
const MASTER_GAIN_LEVEL = 0.93;

export function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = MASTER_GAIN_LEVEL;
  masterGain.connect(audioCtx.destination);

  // TWENTY-SECOND follow-up: all three strings are multi-sampled
  // ZonedSampleVoices. Each one's zones connect to its output only while
  // in use (see ZonedSampleVoice), so an idle instrument does no work.
  cello = new ZonedSampleVoice(audioCtx, { pan: VOICE_CONFIG.cello.pan, zones: CELLO_ZONES, baseTrimDb: TRIM_DB.cello, refRmsDb: ZONE_LOUDNESS_REF_DB.cello });
  viola = new ZonedSampleVoice(audioCtx, { pan: VOICE_CONFIG.viola.pan, zones: VIOLA_ZONES, baseTrimDb: TRIM_DB.viola, refRmsDb: ZONE_LOUDNESS_REF_DB.viola });
  violin = new ZonedSampleVoice(audioCtx, { pan: VOICE_CONFIG.violin.pan, zones: VIOLIN_ZONES, baseTrimDb: TRIM_DB.violin, refRmsDb: ZONE_LOUDNESS_REF_DB.violin });
  custom = new SineVoice(audioCtx, { pan: VOICE_CONFIG.custom.pan, maxFreq: VOICE_CONFIG.custom.maxFreq });

  cello.connect(masterGain);
  viola.connect(masterGain);
  violin.connect(masterGain);
  custom.connect(masterGain);

  for (const [name, v] of [
    ['cello', cello],
    ['viola', viola],
    ['violin', violin],
  ]) {
    v.load().catch((e) => console.warn(`${name} samples failed to load:`, e.message));
  }
  // custom (SineVoice) needs no load — it's synchronously ready, see its
  // class comment above.

  lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
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
  // EIGHTEENTH follow-up: only a fallback for a suspension we didn't
  // request (e.g. iOS pausing the engine) — never while our own
  // suspend/resume is queued or in flight, which would race it (see
  // queueEngineOp above). Routed through the same queue.
  if (!engineSuspended && engineOpsInFlight === 0 && audioCtx.state === 'suspended') {
    const ctx = audioCtx;
    queueEngineOp('resume (fallback)', () => ctx.resume());
  }

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
  // TWENTIETH follow-up: this branch originally served Custom only; it now
  // serves every voice in SMOOTH_PIPELINE_VOICES (`config` is the active
  // voice's own range/gain). Variable names keep their historical
  // custom* prefix.
  if (SMOOTH_PIPELINE_VOICES.has(activeVoiceName)) {
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
    if (atRest) {
      // ELEVENTH follow-up: reported bug — after a long/intense tremor,
      // sound could still be heard at what the UI already showed as 0
      // intensity. Cause: this branch used to call the ordinary
      // voice.setGain(0, rampSec) here, exactly like any other push. But
      // setGain() just anchors-and-ramps — it does NOT cancel any
      // already-scheduled FUTURE ramp (Web Audio automation events are
      // time-ordered, not call-ordered, and cancelScheduledValues() is
      // unsafe in this library; see the SIGSEGV note near the top of this
      // file). The longer/more intense the preceding tremor, the more
      // likely an earlier gain push scheduled a ramp whose end time lands
      // AFTER this rest-triggered push's own end time — that stale ramp
      // still fires later and pulls gain back up, reviving audible sound.
      // This is the exact same mechanism as the EIGHTH follow-up's
      // "sound continues after End Session" bug, just reached via this
      // rest-detection path instead of stopHard(). stopHard() already
      // carries the fix (the STALE_RAMP_GUARD_SEC backstop) — reuse it
      // here rather than a plain setGain() call, so reaching true rest
      // gets the same protection as ending a session does.
      if (gain !== lastSent.gain) {
        if (SONIFICATION_DEBUG_LOGGING) console.log('[sonification:rest]', 'at=' + nowMs, 'pendingGainRampSec=' + (voice.gainRampEndTime - voice.ctx.currentTime).toFixed(2));
        voice.stopHard(voice.ctx.currentTime);
        lastSent.gain = gain;
        customGainLastPushMs = nowMs;
        customGainPushCount += 1; // see the counters' comment above
      }
    } else if (Math.abs(gain - lastSent.gain) > GAIN_EPSILON) {
      const gainRampSec = customRampSec(nowMs, customGainLastPushMs);
      voice.setGain(gain, gainRampSec);
      // FOURTEENTH follow-up diagnostic: gapSec is the raw time since the
      // previous gain push (what the ramp used to be); rampSec is the capped
      // value actually scheduled — rampSec should never exceed CUSTOM_RAMP_MAX_SEC.
      if (SONIFICATION_DEBUG_LOGGING) console.log('[sonification:gainpush]', 'at=' + nowMs, 'target=' + gain.toFixed(3), 'gapSec=' + (customGainLastPushMs ? ((nowMs - customGainLastPushMs) / 1000).toFixed(2) : 'first'), 'rampSec=' + gainRampSec.toFixed(2));
      lastSent.gain = gain;
      customGainLastPushMs = nowMs;
      customGainPushCount += 1; // see the counters' comment above
    }
    if (atRest ? customSmoothedLevel !== lastSent.bright : Math.abs(customSmoothedLevel - lastSent.bright) > BRIGHT_EPSILON) {
      const brightRampSec = customRampSec(nowMs, customBrightLastPushMs);
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
    // TWENTIETH follow-up: FREQ_EPSILON (2Hz) is a fine step in Custom's
    // 200-700Hz range (~0.05-0.17 semitone) but about half a semitone in
    // Cello's 65-130Hz register — slow intensity changes would glide half a
    // semitone, then hold, i.e. audible pitch stepping. Non-Custom smooth
    // voices use a pitch-relative threshold (PITCH_EPSILON_SEMITONES)
    // instead; Custom keeps its exact, proven behavior.
    const pitchMoved =
      activeVoiceName === 'custom'
        ? Math.abs(freq - lastSent.freq) > FREQ_EPSILON
        : !(lastSent.freq > 0) || Math.abs(12 * Math.log2(freq / lastSent.freq)) > PITCH_EPSILON_SEMITONES;
    if (pitchMoved) {
      const freqRampSec = customRampSec(nowMs, customFreqLastPushMs);
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
      // ELEVENTH follow-up: absolute 'at' timestamp added so this can be
      // cross-referenced against liveSession.js's '[sonification:hook]'
      // SET/CLEARED log lines (also absolute Date.now()) — lets a single
      // capture show exactly when the last real push happened relative to
      // End Session's setAudioHook(null) call.
      console.log('[sonification:custom]', 'at=' + nowMs, 'elapsedSec=' + elapsedSec, 'gainPush=' + customGainPushCount, 'brightPush=' + customBrightPushCount, 'freqPush=' + customFreqPushCount, 'level=' + level.toFixed(1), 'smoothedLevel=' + (customSmoothedLevel * 100).toFixed(1), 'gain=' + gain.toFixed(3), 'freq=' + freq.toFixed(1));
    }
  }
  // TWENTY-SECOND follow-up: the original FFT-based pitch path for the
  // single-sample Cello/Viola/Violin lived here. Every voice is now in
  // SMOOTH_PIPELINE_VOICES, so the branch above always handles it.
}

export function silenceAudio() {
  if (!audioCtx) return;
  // ELEVENTH follow-up: logged unconditionally (called at most a few
  // times per session) with an absolute timestamp, cross-referenced
  // against '[sonification:custom]' and '[sonification:hook]' lines —
  // see their comments.
  const t = audioCtx.currentTime;
  // THIRTEENTH follow-up: pendingGainRampSec > 0 means a Custom gain ramp
  // scheduled before this call is still in flight and will pull gain back
  // up from 0 until it ends — the predicted length of any post-stop sound.
  console.log('[sonification:silence]', 'silenceAudio() called at', Date.now(), 'pendingGainRampSec=' + (custom ? (custom.gainRampEndTime - t).toFixed(2) : 'n/a'));
  cello?.stopHard(t);
  viola?.stopHard(t);
  violin?.stopHard(t);
  custom?.stopHard(t);
  // THIRTEENTH follow-up: reported bug — Custom sometimes kept playing a
  // single frozen tone after End Session, indefinitely, until navigating
  // past Summary to Home. Two on-device captures (one that stopped
  // cleanly, one that didn't) showed IDENTICAL JS-level state at the
  // moment of this call in both cases: in both, the gain automation had
  // already settled (no pending future ramp — gainPush hadn't
  // incremented in several real seconds, so stopHard()'s STALE_RAMP_GUARD_SEC
  // backstop correctly saw nothing to guard against either way) before
  // this function ran its per-voice stopHard() calls above. Since the two
  // runs are indistinguishable at this level yet produced different
  // outcomes, the failure isn't in this module's scheduling logic — it's
  // react-native-audio-api (already the source of one confirmed bug in
  // this file, the cancelScheduledValues() SIGSEGV noted near the top)
  // occasionally not applying a settled AudioParam's setValueAtTime(0, t)
  // to the native render graph.
  //
  // Fix: don't rely solely on each voice's own per-param automation.
  // masterGain sits downstream of all four voices, right before
  // destination, and until now its gain has only ever been assigned once
  // at construction (0.93) — never scheduled/automated. Muting it here
  // with a plain synchronous value write (not a scheduled automation
  // event) goes through a simpler native code path than the per-voice
  // setValueAtTime() calls above, independent of whatever is occasionally
  // dropping those. It's unmuted again at the start of the next session
  // (see unmuteAudio(), called from sessionLogic.js's startSession()).
  if (masterGain) masterGain.gain.value = 0; // reversed by unmuteAudio() below
  // TWENTY-FIRST/SECOND follow-ups: disconnect every string zone so no
  // pitch-shifter keeps running between sessions.
  cello?.release();
  viola?.release();
  violin?.release();
  lastSent = { freq: 0, gain: -1, bright: -1, intensity: -1 };
  customSmoothedLevel = null;
  lastCustomPitchUpdateTime = 0;
  customGainLastPushMs = 0;
  customBrightLastPushMs = 0;
  customFreqLastPushMs = 0;
  customGainPushCount = 0;
  customBrightPushCount = 0;
  customFreqPushCount = 0;
  customSessionStartMs = 0;
  // EIGHTEENTH follow-up: pause the engine so iOS doesn't keep the app
  // alive in the background rendering silence — see suspendEngine().
  // Queued after the gain writes above, so the voices are already
  // silenced/muted when rendering stops (and when it later resumes).
  suspendEngine();
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
  engineSuspended = false; // EIGHTEENTH follow-up: next initAudio() starts a fresh, running context
}
