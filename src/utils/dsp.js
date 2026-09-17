// ══════════════════════════════════════════════════════
// MATH / DSP UTILITIES
// Ported directly from steadypoint_v5.html — pure functions,
// no changes needed for React Native.
// ══════════════════════════════════════════════════════

export function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

export function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}

export function rmsOf(xs, ys, zs) {
  const n = xs.length;
  if (!n) return 0;
  const mx = mean(xs),
    my = mean(ys),
    mz = mean(zs);
  return Math.sqrt(
    xs.reduce((s, v, i) => s + (v - mx) ** 2 + (ys[i] - my) ** 2 + (zs[i] - mz) ** 2, 0) / n,
  );
}

// In-place recursive FFT (Cooley-Tukey), same as original.
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  const h = n >> 1,
    reE = [],
    imE = [],
    reO = [],
    imO = [];
  for (let i = 0; i < h; i++) {
    reE.push(re[i * 2]);
    imE.push(im[i * 2]);
    reO.push(re[i * 2 + 1]);
    imO.push(im[i * 2 + 1]);
  }
  fft(reE, imE);
  fft(reO, imO);
  for (let k = 0; k < h; k++) {
    const a = (-2 * Math.PI * k) / n,
      wr = Math.cos(a),
      wi = Math.sin(a);
    const tr = wr * reO[k] - wi * imO[k],
      ti = wr * imO[k] + wi * reO[k];
    re[k] = reE[k] + tr;
    im[k] = imE[k] + ti;
    re[k + h] = reE[k] - tr;
    im[k + h] = imE[k] - ti;
  }
}

export function dominantFreq(signal, sr) {
  let n = 1;
  while (n < signal.length) n <<= 1;
  const re = signal.slice(0, n).concat(new Array(Math.max(0, n - signal.length)).fill(0));
  const im = new Array(n).fill(0);
  fft(re, im);
  let best = -1,
    bestP = 0;
  for (let i = 1; i < n / 2; i++) {
    const f = (i * sr) / n;
    if (f >= 1 && f <= 15) {
      const p = re[i] * re[i] + im[i] * im[i];
      if (p > bestP) {
        bestP = p;
        best = i;
      }
    }
  }
  return best >= 0 ? parseFloat(((best * sr) / n).toFixed(1)) : 0;
}

export function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// Finds the FFT bin with the highest magnitude, excluding DC (0 Hz) — no
// source-range restriction during the search itself, matching the
// reference Python implementation's dominant_frequency() (the tremor/
// movement frequency range is only applied later, when mapping the
// result into an audible tone via mapRange()). Separate from the
// existing dominantFreq() above, which has its own fixed 1-15Hz search
// restriction baked in for its own established purpose (the "Dominant
// Freq" stat) — not touched by this.
function peakFreqUnrestricted(signal, sr) {
  let n = 1;
  while (n < signal.length) n <<= 1;
  if (n < 2) return null;
  const re = signal.slice(0, n).concat(new Array(Math.max(0, n - signal.length)).fill(0));
  const im = new Array(n).fill(0);
  fft(re, im);
  let best = -1,
    bestP = 0;
  for (let i = 1; i < n / 2; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    if (p > bestP) {
      bestP = p;
      best = i;
    }
  }
  return best >= 0 ? (best * sr) / n : null;
}

// Combined dominant frequency across all three axes, for sonification
// pitch — mirrors the reference's approach: FFT each axis separately
// (mean-removed, i.e. gravity/DC offset stripped), find each axis's own
// dominant frequency, then average whichever axes produced a usable
// result. Returns null if none did (e.g. not enough samples yet).
export function combinedDominantFreq(xs, ys, zs, sr, minSamples = 16) {
  const freqs = [];
  for (const axis of [xs, ys, zs]) {
    if (axis.length < minSamples) continue;
    const m = mean(axis);
    const centered = axis.map((v) => v - m);
    const f = peakFreqUnrestricted(centered, sr);
    if (f != null && f > 0) freqs.push(f);
  }
  if (freqs.length === 0) return null;
  return freqs.reduce((a, b) => a + b, 0) / freqs.length;
}

// Like peakFreqUnrestricted, but excludes bins below minHz — used by the
// calibration frequency-band detector below to exclude near-0Hz drift/
// gravity/postural sway from counting as tremor.
function peakFreqAboveMinHz(signal, sr, minHz) {
  let n = 1;
  while (n < signal.length) n <<= 1;
  if (n < 2) return null;
  const re = signal.slice(0, n).concat(new Array(Math.max(0, n - signal.length)).fill(0));
  const im = new Array(n).fill(0);
  fft(re, im);
  let best = -1,
    bestP = 0;
  for (let i = 1; i < n / 2; i++) {
    const f = (i * sr) / n;
    if (f < minHz) continue;
    const p = re[i] * re[i] + im[i] * im[i];
    if (p > bestP) {
      bestP = p;
      best = i;
    }
  }
  return best >= 0 ? (best * sr) / n : null;
}

// Combined dominant frequency across all three axes, excluding near-0Hz
// content — same averaging approach as combinedDominantFreq() above, just
// with the minHz floor applied per-axis before averaging.
function combinedDominantFreqAboveMinHz(xs, ys, zs, sr, minHz, minSamples = 16) {
  const freqs = [];
  for (const axis of [xs, ys, zs]) {
    if (axis.length < minSamples) continue;
    const m = mean(axis);
    const f = peakFreqAboveMinHz(axis.map((v) => v - m), sr, minHz);
    if (f != null && f > 0) freqs.push(f);
  }
  return freqs.length === 0 ? null : freqs.reduce((a, b) => a + b, 0) / freqs.length;
}

// ══════════════════════════════════════════════════════
// CALIBRATION MODE — see Calibration_Mode_Design.pdf for the full spec.
// Two detectors, both run against the same calibration recording:
//   1. Sustained-peak amplitude tracker (stateful, live) -> FULL_SCALE_G
//   2. Sustained-frequency-band detector (batch, run once) -> tremor band
// ══════════════════════════════════════════════════════

// Stateful tracker for Calibration Mode's "hold your biggest tremor"
// step. Fed a new RMS reading on every tick; tracks the highest RMS seen
// so far (the running peak) and how long (continuously) the signal has
// stayed within toleranceRatio of that peak. Per the design doc: "When
// the RMS holds within a small tolerance of its running peak for at
// least 5 continuous seconds, the app treats that plateau as the user's
// true level 100." toleranceRatio isn't specified exactly in the design
// doc's text. Initially set to 0.85 (matching the plateau width shown in
// the doc's own reference chart), but real device testing found this
// was too strict — genuine vigorous shaking naturally oscillates and
// repeatedly dropped below 85% of peak, hard-resetting progress before
// it could ever accumulate 5 seconds. Loosened to 0.6 and switched from
// a hard reset to a decay (at decayMultiplier x the accumulation rate)
// on a dip — verified via synthetic testing to reliably reach 5 seconds
// during realistic oscillating vigorous motion, while still correctly
// returning to 0 within a few seconds of a genuine stop.
export function createSustainedPeakTracker({ toleranceRatio = 0.6, sustainSeconds = 5, decayMultiplier = 2 } = {}) {
  let runningPeak = 0;
  let sustainedMs = 0;
  let lastTickMs = null;
  // Recent (rms, timestamp) readings within the last sustainSeconds —
  // used to compute what was actually sustained (see sustainedValue
  // below), rather than reporting the all-time peak, which could be an
  // unrepresentative one-off spike (a bump, a sudden jerk) rather than
  // genuinely sustained effort. Per the design doc: "The RMS value
  // sustained during that 5-second window becomes the candidate value
  // for FULL_SCALE_G" — not "the highest value ever seen."
  let recentReadings = [];

  return {
    update(rms, nowMs) {
      runningPeak = Math.max(runningPeak, rms);
      const withinTolerance = runningPeak > 0 && rms >= runningPeak * toleranceRatio;
      const dt = lastTickMs != null ? Math.max(0, nowMs - lastTickMs) : 0;
      lastTickMs = nowMs;
      // Decays rather than hard-resets on a dip — confirmed via direct
      // testing that real vigorous shaking naturally oscillates enough to
      // repeatedly drop below tolerance, and a hard reset never let the
      // counter accumulate the full 5 seconds. Still correctly returns to
      // 0 within a few seconds of a genuine stop, since decay runs faster
      // than accumulation.
      sustainedMs = withinTolerance ? sustainedMs + dt : Math.max(0, sustainedMs - dt * decayMultiplier);
      const targetMs = sustainSeconds * 1000;

      recentReadings.push({ rms, atMs: nowMs });
      const cutoff = nowMs - targetMs;
      recentReadings = recentReadings.filter((r) => r.atMs >= cutoff);
      // Average of the recent readings that actually qualified as "at
      // the peak" (within tolerance) — excludes any dips that happened
      // to fall within this recent window, and excludes an old spike
      // once it's aged out of the recent-readings window even though
      // runningPeak itself never decreases.
      const qualifying = recentReadings.filter((r) => r.rms >= runningPeak * toleranceRatio);
      const sustainedValue = qualifying.length > 0 ? qualifying.reduce((s, r) => s + r.rms, 0) / qualifying.length : runningPeak;

      return {
        runningPeak,
        currentRms: rms,
        sustainedValue,
        sustainedMs: Math.min(sustainedMs, targetMs),
        sustainedSeconds: Math.min(sustainedMs, targetMs) / 1000,
        reached: sustainedMs >= targetMs,
      };
    },
    reset() {
      runningPeak = 0;
      sustainedMs = 0;
      lastTickMs = null;
      recentReadings = [];
    },
  };
}

// Batch analysis over a full calibration recording (chronological
// {t,x,y,z} samples, matching the existing sessionBuffer format) to find
// the user's true tremor frequency band. Per the design doc: excludes
// near-0Hz drift/gravity/postural sway, and only counts a frequency
// range as the true band if it's sustained continuously for at least
// sustainSeconds — a brief transient (e.g. bumping the sensor) is
// discarded for not persisting long enough.
//
// Approach: compute the single combined dominant frequency (same
// well-tested concept as combinedDominantFreq() above) for a sequence of
// overlapping short snapshots across the whole recording, then look for
// stretches of consecutive snapshots whose readings stay mutually close
// together (within consistencyToleranceHz of each other) for at least
// sustainSeconds — real tremor's frequency naturally jitters a bit but
// stays roughly consistent, while a one-off spike or bump won't have
// enough consistent neighbors around it to qualify. Rejected an earlier
// design that tracked many individual frequency bins directly: it
// required a Hann window to avoid spectral-leakage false positives, and
// even then, under-detected a realistic jittering-tremor test signal.
// This simpler design reuses a concept already validated elsewhere in
// this file and was confirmed directly against both an isolated brief
// transient (correctly rejected) and a sustained, naturally-jittering
// tremor-like signal (correctly detected) before being used here.
//
// Returns {minHz, maxHz} or null if no sustained band was found (e.g.
// recording too short, or nothing sustained long enough).
export function detectSustainedFrequencyBand(sessionBuffer, opts = {}) {
  const {
    sr = 50,
    windowSeconds = 1,
    stepSeconds = 0.25,
    minHzExcluded = 1, // near-0Hz drift/gravity/postural sway isn't tremor
    maxHz = 20,
    sustainSeconds = 2,
    consistencyToleranceHz = 2, // how far apart snapshots in a stretch may be and still count as "the same" sustained band
  } = opts;

  const windowSamples = Math.round(windowSeconds * sr);
  if (sessionBuffer.length < windowSamples) return null;
  const stepSamples = Math.max(1, Math.round(stepSeconds * sr));
  const totalSnapshots = Math.floor((sessionBuffer.length - windowSamples) / stepSamples) + 1;

  // Same lesson learned (and fixed) twice already elsewhere in this file
  // — during near-silence, "which bin has the most energy" still returns
  // *something*, driven by floating-point noise rather than a real
  // signal. Confirmed directly: without this gate, an isolated 1-second
  // transient in an otherwise-silent recording produced a spurious
  // "sustained" reading from the silent portions. MIN_SNAPSHOT_RMS is set
  // comfortably above typical sensor noise floor.
  const MIN_SNAPSHOT_RMS = 0.01;

  const snapshotFreqs = [];
  for (let s = 0; s < totalSnapshots; s++) {
    const start = s * stepSamples;
    const slice = sessionBuffer.slice(start, start + windowSamples);
    const xs = slice.map((d) => d.x),
      ys = slice.map((d) => d.y),
      zs = slice.map((d) => d.z);
    if (rmsOf(xs, ys, zs) < MIN_SNAPSHOT_RMS) {
      snapshotFreqs.push(null);
      continue;
    }
    const f = combinedDominantFreqAboveMinHz(xs, ys, zs, sr, minHzExcluded, Math.round(windowSamples * 0.6));
    snapshotFreqs.push(f != null && f <= maxHz ? f : null);
  }

  const requiredCount = Math.ceil(sustainSeconds / stepSeconds);
  let bestMin = null;
  let bestMax = null;
  for (let i = 0; i <= snapshotFreqs.length - requiredCount; i++) {
    const stretch = snapshotFreqs.slice(i, i + requiredCount);
    if (stretch.some((v) => v == null)) continue; // require a valid reading throughout the whole stretch
    const lo = Math.min(...stretch),
      hi = Math.max(...stretch);
    if (hi - lo <= consistencyToleranceHz) {
      if (bestMin == null || lo < bestMin) bestMin = lo;
      if (bestMax == null || hi > bestMax) bestMax = hi;
    }
  }

  return bestMin == null ? null : { minHz: bestMin, maxHz: bestMax };
}

// Linearly maps value from [srcMin,srcMax] into [dstMin,dstMax], clamping
// out-of-range input first. Mirrors the reference's map_to_audible().
export function mapRange(value, srcMin, srcMax, dstMin, dstMax) {
  if (value == null) return null;
  const clamped = Math.min(Math.max(value, srcMin), srcMax);
  const ratio = (clamped - srcMin) / (srcMax - srcMin);
  return dstMin + ratio * (dstMax - dstMin);
}

// Maps a gravity-free AC-RMS value (see rmsOf() above) to an absolute
// 0-100 tremor intensity level, calibrated against fixed device thresholds
// rather than anything session-relative — so the same physical tremor
// severity always produces the same level, comparable across sessions
// that share the same fullScaleG setting (see below — this is now
// user-adjustable, so comparisons across sessions with *different*
// fullScaleG values should account for that; each session stores the
// value it was actually computed with).
// NOISE_FLOOR_G: below this, the sensor reads as still (level 0) — now
// user-adjustable via Settings (Calibration Mode design), defaulting to
// DEFAULT_NOISE_FLOOR_G. Not measured by Calibration Mode itself (no
// measurement step produces it); manually editable only.
// fullScaleG: this RMS value (in units of g) maps to level 100 — user-
// adjustable via Settings ("Full-scale range motion that reads as
// intensity 100"), defaulting to DEFAULT_FULL_SCALE_G.
export const DEFAULT_NOISE_FLOOR_G = 0.006;
export const DEFAULT_FULL_SCALE_G = 0.35;

export function rmsToLevel(rms, fullScaleG = DEFAULT_FULL_SCALE_G, noiseFloorG = DEFAULT_NOISE_FLOOR_G) {
  if (rms <= noiseFloorG) return 0;
  const pct = ((rms - noiseFloorG) / (fullScaleG - noiseFloorG)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

export function severityInfo(level, colors) {
  if (level < 20) return { label: 'None', color: colors.success };
  if (level < 45) return { label: 'Mild', color: colors.info };
  if (level < 70) return { label: 'Moderate', color: colors.warning };
  return { label: 'High', color: colors.danger };
}

export function orbSize(level, screenWidth) {
  const cap = Math.min(screenWidth * 0.52, 202);
  return Math.min(Math.round(112 + level * 0.9), cap);
}

export function orbRGB(l) {
  const t = l / 100,
    a = [29, 158, 117],
    b = [186, 117, 23];
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
