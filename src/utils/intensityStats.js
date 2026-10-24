// TWENTY-SIXTH follow-up: session intensity measures that replace the
// SteadyPoint Score — the session's MEDIAN intensity and the share of the
// session spent in each intensity band.
//
// Bands are the same four the live Recording screen uses for its severity
// label (liveSession.js: None < 20 <= Mild < 45 <= Moderate < 70 <= High),
// with the same colours (RecordingScreen.js), so what users see during a
// session matches what they see afterwards. Lower intensity is better.

import { DEFAULT_FULL_SCALE_G, DEFAULT_NOISE_FLOOR_G, rmsToLevel } from './dsp';

export const INTENSITY_BANDS = [
  { key: 'none', label: 'None', range: 'below 20', upTo: 20, color: 'success', bg: 'bgSuccess' },
  { key: 'mild', label: 'Mild', range: '20–44', upTo: 45, color: 'info', bg: 'bgInfo' },
  { key: 'moderate', label: 'Moderate', range: '45–69', upTo: 70, color: 'warning', bg: 'bgWarning' },
  { key: 'high', label: 'High', range: '70+', upTo: Infinity, color: 'danger', bg: 'bgDanger' },
];

export function bandFor(level) {
  return INTENSITY_BANDS.find((b) => level < b.upTo) || INTENSITY_BANDS[INTENSITY_BANDS.length - 1];
}

// Median rather than mean (explicit product decision): a brief spike —
// e.g. picking the device up at the start — barely moves the median, so it
// reflects the session's typical level.
export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Whole-number percentages that always add up to exactly 100 (largest-
// remainder rounding), so the bar and legend never show 99% or 101%.
export function roundTo100(raw) {
  const keys = Object.keys(raw);
  const total = keys.reduce((t, k) => t + raw[k], 0);
  if (total <= 0) return Object.fromEntries(keys.map((k) => [k, 0]));
  const exact = keys.map((k) => ({ k, v: (raw[k] / total) * 100 }));
  const out = Object.fromEntries(exact.map(({ k, v }) => [k, Math.floor(v)]));
  let left = 100 - exact.reduce((t, { k }) => t + out[k], 0);
  exact
    .sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))
    .forEach(({ k }) => {
      if (left > 0) {
        out[k] += 1;
        left -= 1;
      }
    });
  return out;
}

// Share of readings in each band, as { none, mild, moderate, high } summing
// to 100.
export function bandPercentages(trace) {
  const counts = { none: 0, mild: 0, moderate: 0, high: 0 };
  for (const level of trace || []) counts[bandFor(level).key] += 1;
  return roundTo100(counts);
}

// Same validity gate the score used: at least 10 readings and 30 seconds.
export const MIN_READINGS = 10;
export const MIN_SECONDS = 30;

// ── THIRTIETH follow-up: showing every session on the CURRENT scale ──
//
// A 0-100 reading depends on the full scale (motion that reads as 100) and
// the noise floor (motion that reads as 0) in effect when it was measured.
// Both only stretch the scale, so a saved reading can be turned back into
// the motion (in g) it came from and re-scored with the user's current
// settings. This is done at display time only — saved sessions are never
// modified — so history always follows the current settings.
//
// Assumes the session's frequency band matches today's (agreed): band
// changes alter WHAT is measured and can't be converted. Analytics marks
// where the band or band filtering changed (see analyticsStats.js).
//
// Limits: a reading pinned at 0 or 100 is only a bound ("at least full
// scale"), so it's converted as if it sat exactly on that bound.

// A { fullScaleG, noiseFloorG } pair, with the same validation the live
// pipeline applies (liveSession.js setFullScaleG()/setNoiseFloorG()).
function validScale(fullScaleG, noiseFloorG) {
  const fs = typeof fullScaleG === 'number' && fullScaleG > 0 ? fullScaleG : DEFAULT_FULL_SCALE_G;
  const nf = typeof noiseFloorG === 'number' && noiseFloorG >= 0 && noiseFloorG < fs ? noiseFloorG : Math.min(DEFAULT_NOISE_FLOOR_G, fs / 2);
  return { fullScaleG: fs, noiseFloorG: nf };
}

// The scale sessions are shown on: the user's current settings.
export function displayScale(settings) {
  return validScale(settings?.fullScaleG, settings?.noiseFloorG);
}

// The scale a saved session (or Summary's results) was measured on. Sessions
// recorded before noiseFloorG was saved all used the 0.006 g default (the
// setting wasn't applied until the twenty-ninth follow-up).
export function sessionScale(s) {
  return validScale(s?.fullScaleG, s?.noiseFloorG);
}

function sameScale(a, b) {
  return Math.abs(a.fullScaleG - b.fullScaleG) < 1e-9 && Math.abs(a.noiseFloorG - b.noiseFloorG) < 1e-9;
}

// One 0-100 reading from scale `from` to scale `to` (unrounded; callers
// round). Inverse of dsp.js rmsToLevel(), then rmsToLevel() again.
export function rescaleLevel(level, from, to) {
  if (level == null) return level;
  const g = from.noiseFloorG + (Math.max(0, Math.min(100, level)) / 100) * (from.fullScaleG - from.noiseFloorG);
  if (g <= to.noiseFloorG) return 0;
  return Math.max(0, Math.min(100, ((g - to.noiseFloorG) / (to.fullScaleG - to.noiseFloorG)) * 100));
}

function needsRescale(s, scale) {
  return !!scale && !sameScale(sessionScale(s), scale);
}

// THIRTY-SECOND follow-up: sessions recorded since the thirty-first
// follow-up also saved the motion (g) behind each trace point (rmsTraceG,
// index-aligned with intensityTrace). Re-scoring that directly is exact —
// no 0/100 pinning, no whole-number coarseness — so it's used when present.
function hasGTrace(s, key = 'rmsTraceG') {
  const g = s?.[key];
  return Array.isArray(g) && g.length > 0 && g.length === (s.intensityTrace || []).length;
}

// The session's saved intensity trace on `scale` (whole numbers, like the
// saved trace). Used by the Intensity Over Session chart.
export function sessionTrace(s, scale) {
  const trace = s?.intensityTrace || [];
  if (!needsRescale(s, scale)) return trace;
  if (hasGTrace(s)) return s.rmsTraceG.map((g) => rmsToLevel(g, scale.fullScaleG, scale.noiseFloorG));
  const from = sessionScale(s);
  return trace.map((v) => Math.round(rescaleLevel(v, from, scale)));
}

// THIRTY-SIXTH follow-up: long sessions save the largest motion in each
// trace point's time slice (rmsPeakTraceG); scored on `scale` (or the
// session's own) for the chart's peak line. null when not saved.
export function sessionPeakTrace(s, scale) {
  const p = s?.rmsPeakTraceG;
  if (!Array.isArray(p) || p.length === 0 || p.length !== (s.intensityTrace || []).length) return null;
  const sc = scale || sessionScale(s);
  return p.map((g) => rmsToLevel(g, sc.fullScaleG, sc.noiseFloorG));
}

// THIRTY-SECOND follow-up: a session's median intensity measured on ALL
// frequencies (rmsAllTraceG — includes voluntary movement, independent of
// the band), scored on `scale`. null when the session predates that field
// or was too short to measure. Used by Analytics' "All motion" view.
export function allMotionMedian(s, scale) {
  if (!hasGTrace(s, 'rmsAllTraceG')) return null;
  const trace = s.intensityTrace || [];
  const valid = s.intensityValid ?? s.scoreValid ?? trace.length >= MIN_READINGS;
  if (!valid) return null;
  const sc = scale || sessionScale(s);
  return Math.round(median(s.rmsAllTraceG.map((g) => rmsToLevel(g, sc.fullScaleG, sc.noiseFloorG))));
}

// Start-vs-end reduction (%) on `scale`, recomputed from the saved start and
// end levels the same way endSession() computes it.
export function sessionReduction(s, scale) {
  if (!needsRescale(s, scale) || typeof s.startLevel !== 'number' || typeof s.endLevel !== 'number') {
    return s.reduction;
  }
  const from = sessionScale(s);
  const start = Math.round(rescaleLevel(s.startLevel, from, scale));
  const end = Math.round(rescaleLevel(s.endLevel, from, scale));
  return start > 0 ? Math.max(0, Math.round(((start - end) / start) * 100)) : 0;
}

// Everything a screen needs about one saved session (or Summary's results):
// { valid, median, band, pct }. Sessions recorded from this follow-up on
// store medianIntensity / bandPct from the full-resolution trace. Older
// sessions are derived on the fly from their saved intensityTrace (an
// evenly-spaced ~150-point sample of the same readings), so history needs
// no migration.
//
// `scale` (optional, from displayScale(state.settings)): when the session
// was measured on a different full scale / noise floor, the median is
// converted exactly (converting keeps the order of readings, so the middle
// reading stays in the middle) and the band split is recomputed from the
// converted ~150-point trace (approximate — typically within a few %).
export function sessionIntensity(s, scale) {
  if (!s) return { valid: false, median: null, band: null, pct: null };
  const trace = s.intensityTrace || [];
  const valid = s.intensityValid ?? s.scoreValid ?? trace.length >= MIN_READINGS;
  if (!valid) return { valid: false, median: null, band: null, pct: null };
  let med = s.medianIntensity != null ? s.medianIntensity : median(trace);
  if (med == null) return { valid: false, median: null, band: null, pct: null };
  let pct = s.bandPct || null;
  if (!pct) {
    const stored = [s.pctNone, s.pctMild, s.pctModerate, s.pctHigh];
    pct = stored.every((v) => typeof v === 'number')
      ? roundTo100({ none: s.pctNone, mild: s.pctMild, moderate: s.pctModerate, high: s.pctHigh })
      : bandPercentages(trace);
  }
  let rescaled = false;
  if (needsRescale(s, scale)) {
    // The stored median converts exactly unless it was itself pinned at 0
    // or 100 (then it's only a bound); in that case use the saved motion
    // trace when the session has one (THIRTY-SECOND follow-up).
    const pinned = med <= 0 || med >= 100;
    med = pinned && hasGTrace(s) ? median(sessionTrace(s, scale)) : rescaleLevel(med, sessionScale(s), scale);
    if (trace.length > 0) pct = bandPercentages(sessionTrace(s, scale));
    rescaled = true;
  }
  const rounded = Math.round(med);
  return { valid: true, median: rounded, band: bandFor(rounded), pct, rescaled };
}

// One-line headline for Summary, by median band. Neutral and supportive —
// describes the session rather than grading it.
export function intensityHeadline(info) {
  if (!info.valid) return 'Session too short to measure.';
  return {
    none: 'A calm session.',
    mild: 'Mostly mild tremor this session.',
    moderate: 'Moderate tremor this session.',
    high: 'Higher tremor this session.',
  }[info.band.key];
}
