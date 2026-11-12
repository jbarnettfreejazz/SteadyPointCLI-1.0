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

// THIRTY-NINTH follow-up: Calibration Mode's level-100 detector, ported
// from the Flutter app's SustainedPeakDetector (sp_core metrics/
// calibration.dart) so both apps calibrate the same way. Replaces the old
// createSustainedPeakTracker(), which waited for a 5-second plateau at 60%
// of the running peak and took the level at the moment the button was
// tapped — it could lock in a warm-up level, and fell back to the single
// highest reading if the user relaxed before tapping.
//
// Fed the same ~2-second AC-RMS readings sessions use (rmsOf() over the
// live ROLL_WIN window), so level 100 is on exactly the session scale.
// Keeps, across the WHOLE recording (so when the user taps doesn't matter):
//   - bestSustainedG: the highest average over any full minSustainMs (1 s)
//   - bestBriefG:     the highest average over any briefMs (300 ms)
// The peak counts as HELD when bestSustainedG >= toleranceRatio (0.8) x
// bestBriefG — Flutter's simulation-chosen value: steady tremor fluctuating
// ±40% passes, a burst of 0.8 s or less doesn't. fullScaleG is the
// sustained value when held, otherwise the brief value (a real maximum,
// even though brief, rather than a diluted average).
export function createSustainedPeakDetector({ minSustainMs = 1000, briefMs = 300, toleranceRatio = 0.8 } = {}) {
  let recent = [];
  let firstAt = null;
  let hasData = false;
  let runningPeakG = 0;
  let bestSustainedG = null;
  let bestBriefG = null;
  const meanOf = (rs) => (rs.length ? rs.reduce((t, r) => t + r.g, 0) / rs.length : 0);

  const api = {
    addSample(nowMs, acRmsG) {
      if (acRmsG == null || !Number.isFinite(acRmsG)) return api.state();
      hasData = true;
      if (firstAt == null) firstAt = nowMs;
      if (acRmsG > runningPeakG) runningPeakG = acRmsG;
      recent.push({ g: acRmsG, at: nowMs });
      recent = recent.filter((r) => r.at >= nowMs - minSustainMs);
      const elapsed = nowMs - firstAt;
      if (elapsed >= briefMs) {
        const m = meanOf(recent.filter((r) => r.at >= nowMs - briefMs));
        if (bestBriefG == null || m > bestBriefG) bestBriefG = m;
      }
      if (elapsed >= minSustainMs) {
        const m = meanOf(recent);
        if (bestSustainedG == null || m > bestSustainedG) bestSustainedG = m;
      }
      return api.state();
    },
    state() {
      const peakWasSustained = bestSustainedG != null && bestBriefG != null && bestSustainedG >= bestBriefG * toleranceRatio;
      const fullScaleG = !hasData ? null : peakWasSustained ? bestSustainedG : bestBriefG ?? runningPeakG;
      return { hasData, runningPeakG, bestSustainedG, bestBriefG, peakWasSustained, fullScaleG };
    },
    reset() {
      recent = [];
      firstAt = null;
      hasData = false;
      runningPeakG = 0;
      bestSustainedG = null;
      bestBriefG = null;
    },
  };
  return api;
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

// Raised-cosine (Hann-style) taper weight for bandLimitedRms() below.
// FORTY-SECOND follow-up: the soft ramp now sits INSIDE the band — 0 at
// minHz rising to 1 at minHz + taperHz, and 1 at maxHz - taperHz falling
// to 0 at maxHz — so nothing outside [minHz, maxHz] is weighted at all
// (it used to ramp outside the limits, from minHz - taperHz and up to
// maxHz + taperHz). Still a smooth ramp rather than a hard 1/0 cutoff, so
// tremor wandering near a limit doesn't flicker in and out. For a band
// narrower than 2 x taperHz the two ramps meet in the middle.
function taperWeight(f, minHz, maxHz, taperHz) {
  if (f < minHz || f > maxHz) return 0;
  if (taperHz <= 0) return 1;
  const ramp = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
  return Math.min(ramp((f - minHz) / taperHz), ramp((maxHz - f) / taperHz));
}

// RMS-equivalent amplitude of ONLY the frequency content inside a user's
// calibrated tremor band [minHz, maxHz] — built so a deliberate voluntary
// movement (e.g. reaching for a glass) doesn't fully register as tremor
// intensity just because it's above the noise floor. A reach's own
// directed motion is low-frequency (well under a typical tremor band) and
// gets attenuated by this function, while any real oscillatory tremor
// riding on top of it (common in essential tremor's kinetic/action
// component, which often *worsens* during a reach rather than damping
// like Parkinsonian rest tremor does) stays in-band and is preserved.
//
// Uses a soft raised-cosine taper (see taperWeight() above) at the band
// edges rather than a hard cutoff, specifically because essential
// tremor's frequency range (~4-12Hz) is both wider and more
// individually variable than Parkinsonian tremor's narrower ~4-6Hz band,
// and can drift somewhat with age/disease duration between
// calibrations — a hard binary cutoff sitting exactly on a calibrated
// edge risks zeroing out real tremor content that's only slightly
// outside it. taperHz controls how wide that soft margin is on each
// side; defaults to 1.5Hz.
//
// FORTY-SECOND follow-up: that 0.5 Hz ramp now sits inside the band (see
// taperWeight()), so motion outside [minHz, maxHz] isn't counted at all.
// FORTY-FIRST follow-up: the soft margin is now 0.5 Hz (was 1.5 Hz). With
// 1.5 Hz, motion well below the band still partly counted — a tester with
// a 5.0 Hz minimum heard sonification from a 3.8 Hz tremor (~30% of it got
// through). Wizard-measured bands already carry a 1 Hz margin each side,
// so real tremor near the measured edge is still covered.
//
// Also new: each axis's 2-second slice has its straight-line drift removed
// (not just its mean) and is shaped with a Hann window before the FFT.
// Without that, large slow movements — an arm movement, or turning the
// wrist, which shifts gravity across the axes and shows up as a steady
// drift — "leaked" a little of their energy into every frequency,
// including the band. The Hann window's power loss is compensated, so a
// steady in-band tremor reads the same as before.
//
// Returned on the same scale as rmsOf() (same units, same "gravity-free
// AC-RMS across all three axes" definition) via Parseval's theorem, so it
// can be passed straight into the existing rmsToLevel()/fullScaleG
// pipeline unchanged. Known caveat: Calibration Mode's FULL_SCALE_G is
// still measured from broadband (non-band-limited) RMS — see
// CalibrationScreen.js — so a live band-limited reading during a
// similarly vigorous session will generally read at or slightly below
// what the same motion would have scored before this change, not
// exactly 100 even at calibration-level effort, since some of that
// effort's energy sits outside the tremor band. In practice this should
// be small for genuine tremor-like motion, which is mostly in-band by
// nature.
export const BAND_TAPER_HZ = 0.5;

// Removes the least-squares straight line (offset + drift) from a slice.
function detrend(values) {
  const n = values.length;
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - xm) * (values[i] - ym);
    sxx += (i - xm) * (i - xm);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return values.map((v, i) => v - ym - slope * (i - xm));
}

// Hann window of length n, and its mean square (for power compensation).
const hannCache = new Map();
function hann(n) {
  if (!hannCache.has(n)) {
    const w = Array.from({ length: n }, (_, i) => (n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1));
    hannCache.set(n, { w, meanSq: w.reduce((t, v) => t + v * v, 0) / n });
  }
  return hannCache.get(n);
}

export function bandLimitedRms(xs, ys, zs, sr, minHz, maxHz, taperHz = BAND_TAPER_HZ) {
  const n = xs.length;
  if (!n || !ys.length || !zs.length) return 0;

  let bandSumSq = 0;
  for (const axis of [xs, ys, zs]) {
    if (axis.length < 8) continue;
    let padN = 1;
    while (padN < axis.length) padN <<= 1;
    const { w, meanSq } = hann(axis.length);
    const shaped = detrend(axis).map((v, i) => v * w[i]);
    const re = shaped.concat(new Array(Math.max(0, padN - axis.length)).fill(0));
    const im = new Array(padN).fill(0);
    fft(re, im);

    let axisPower = 0;
    for (let i = 1; i < padN / 2; i++) {
      const f = (i * sr) / padN;
      const w = taperWeight(f, minHz, maxHz, taperHz);
      if (w <= 0) continue;
      axisPower += w * (re[i] * re[i] + im[i] * im[i]);
    }
    // Parseval: sum_i(x_i - mean)^2 (over the original, non-padded samples)
    // == (2/padN) * sum over the positive-frequency half of |X[k]|^2 (the
    // factor of 2 accounts for the mirrored negative-frequency half of a
    // real-valued signal's spectrum; DC/Nyquist are negligible here since
    // the signal is mean-centered and taperWeight() zeroes anything near
    // 0Hz or the Nyquist edge anyway).
    // Divided by the window's mean square to undo the Hann window's power
    // loss, so the result stays on the same scale as rmsOf().
    bandSumSq += (2 * axisPower) / padN / meanSq;
  }

  // Matches rmsOf()'s definition: sqrt of the mean (per original sample)
  // of the summed squared deviations across all three axes.
  return Math.sqrt(bandSumSq / n);
}

// FORTY-FOURTH follow-up: the tremor's frequency for "Pitch follows:
// Frequency" sonification. Same 2-second slices and preparation as
// bandLimitedRms() (drift removed, Hann window) so it has no extra lag and
// slow movement doesn't leak in; the three axes' power spectra are ADDED
// (one combined spectrum, so the result is a frequency actually present —
// not an average of three separate peaks), and only [minHz, maxHz] is
// searched (the tremor band when filtering is on). Zero-padded to twice the
// next power of two and refined with parabolic interpolation on the log
// power around the peak, so it moves smoothly rather than in bin-sized
// steps. Returns the frequency in Hz, or null if there's nothing to find.
export function tremorPeakFrequency(xs, ys, zs, sr, minHz, maxHz) {
  const info = tremorPeakInfo(xs, ys, zs, sr, minHz, maxHz);
  return info ? info.hz : null;
}

// FIFTIETH follow-up: same as tremorPeakFrequency(), plus edgeSpill —
// true when the strongest point inside [minHz, maxHz] sits on the edge of
// the range with the spectrum still RISING beyond it. That means the real
// peak is outside the range and what's inside is only its spill-over (a
// 2-second slice can't separate frequencies sharply), not a tremor of its
// own. A genuine tremor right at the edge is still a peak (the spectrum
// falls on the far side), so it's not flagged. Returns { hz, edgeSpill } or
// null.
export function tremorPeakInfo(xs, ys, zs, sr, minHz, maxHz, interiorShare = SPILL_INTERIOR_PEAK_SHARE) {
  const n = Math.min(xs.length, ys.length, zs.length);
  if (n < 16 || !(maxHz > minHz)) return null;
  let padN = 1;
  while (padN < n) padN <<= 1;
  padN <<= 1;
  const { w } = hann(n);
  const power = new Array(padN / 2).fill(0);
  for (const axis of [xs, ys, zs]) {
    const shaped = detrend(axis.slice(-n)).map((v, i) => v * w[i]);
    const re = shaped.concat(new Array(padN - n).fill(0));
    const im = new Array(padN).fill(0);
    fft(re, im);
    for (let k = 1; k < padN / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  const binHz = sr / padN;
  const kLo = Math.max(1, Math.ceil(minHz / binHz));
  const kHi = Math.min(padN / 2 - 2, Math.floor(maxHz / binHz));
  let best = -1;
  for (let k = kLo; k <= kHi; k++) if (best < 0 || power[k] > power[best]) best = k;
  if (best < 0 || !(power[best] > 0)) return null;
  let offset = 0;
  const a = power[best - 1];
  const b = power[best];
  const c = power[best + 1];
  if (a > 0 && c > 0) {
    const la = Math.log(a);
    const lb = Math.log(b);
    const lc = Math.log(c);
    const denom = la - 2 * lb + lc;
    if (denom < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / denom));
  }
  let edgeSpill =
    (best === kLo && kLo - 1 >= 1 && power[kLo - 1] > power[best]) ||
    (best === kHi && kHi + 1 < padN / 2 && power[kHi + 1] > power[best]);
  // SIXTY-THIRD follow-up: only spill when there's no real peak inside the
  // band. Slow hand wander (~0.1–0.4 Hz) leaks into a low band edge such as
  // 0.5 Hz and could out-power a genuine in-band tremor at that edge, which
  // muted the tremor and drew its dot hollow inside the box. Now, if the
  // edge is only a slope from outside, the strongest interior local maximum
  // wins — provided it carries at least interiorShare of the edge's power
  // (so window ripple and sensor noise can't stand in for a tremor that is
  // really outside the band).
  if (edgeSpill) {
    const edgePower = power[best];
    let inner = -1;
    for (let k = kLo + 1; k < kHi; k++) {
      if (power[k] > power[k - 1] && power[k] >= power[k + 1] && power[k] >= interiorShare * edgePower) {
        if (inner < 0 || power[k] > power[inner]) inner = k;
      }
    }
    if (inner >= 0) {
      best = inner;
      edgeSpill = false;
      offset = 0;
      const a2 = power[best - 1];
      const b2 = power[best];
      const c2 = power[best + 1];
      if (a2 > 0 && c2 > 0) {
        const la = Math.log(a2);
        const lb = Math.log(b2);
        const lc = Math.log(c2);
        const denom = la - 2 * lb + lc;
        if (denom < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / denom));
      }
    }
  }
  return { hz: Math.min(maxHz, Math.max(minHz, (best + offset) * binHz)), edgeSpill };
}
// Share of a spilling edge's power an interior peak needs to count as the
// band's own tremor (SIXTY-THIRD follow-up; tuned in README's 63rd section).
export const SPILL_INTERIOR_PEAK_SHARE = 0.1;

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
  // Guard against a floor at/above full scale (would divide by zero or
  // invert the scale): anything above the floor is then simply 100.
  if (fullScaleG <= noiseFloorG) return 100;
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
