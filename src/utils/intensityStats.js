// TWENTY-SIXTH follow-up: session intensity measures that replace the
// SteadyPoint Score — the session's MEDIAN intensity and the share of the
// session spent in each intensity band.
//
// Bands are the same four the live Recording screen uses for its severity
// label (liveSession.js: None < 20 <= Mild < 45 <= Moderate < 70 <= High),
// with the same colours (RecordingScreen.js), so what users see during a
// session matches what they see afterwards. Lower intensity is better.

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

// Everything a screen needs about one saved session (or Summary's results):
// { valid, median, band, pct }. Sessions recorded from this follow-up on
// store medianIntensity / bandPct from the full-resolution trace. Older
// sessions are derived on the fly from their saved intensityTrace (an
// evenly-spaced ~150-point sample of the same readings), so history needs
// no migration.
export function sessionIntensity(s) {
  if (!s) return { valid: false, median: null, band: null, pct: null };
  const trace = s.intensityTrace || [];
  const valid = s.intensityValid ?? s.scoreValid ?? trace.length >= MIN_READINGS;
  if (!valid) return { valid: false, median: null, band: null, pct: null };
  const med = s.medianIntensity != null ? s.medianIntensity : median(trace);
  if (med == null) return { valid: false, median: null, band: null, pct: null };
  let pct = s.bandPct || null;
  if (!pct) {
    const stored = [s.pctNone, s.pctMild, s.pctModerate, s.pctHigh];
    pct = stored.every((v) => typeof v === 'number')
      ? roundTo100({ none: s.pctNone, mild: s.pctMild, moderate: s.pctModerate, high: s.pctHigh })
      : bandPercentages(trace);
  }
  const rounded = Math.round(med);
  return { valid: true, median: rounded, band: bandFor(rounded), pct };
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
