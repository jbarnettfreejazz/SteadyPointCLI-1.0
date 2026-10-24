// TWENTY-SEVENTH follow-up: calculations behind the redesigned Analytics
// screen (no SteadyPoint Score). Everything is derived from saved session
// records via sessionIntensity() (utils/intensityStats.js), so sessions from
// before the redesign are included. Pure functions — no React — so they can
// be tested on their own.
import { sessionIntensity, roundTo100, INTENSITY_BANDS, allMotionMedian, bandFor } from './intensityStats';
import { todayKey } from './sessionStats';

const DAY_MS = 86400000;

export const PERIODS = [
  { key: '7d', label: '7D', days: 7, sub: 'last 7 days', chartTitle: '7-DAY INTENSITY' },
  { key: '30d', label: '30D', days: 30, sub: 'last 30 days', chartTitle: '30-DAY INTENSITY' },
  { key: 'all', label: 'All', days: null, sub: 'all time', chartTitle: 'ALL-TIME INTENSITY' },
];

export const ACTIVITY_TYPES = [
  { key: 'meditative', label: 'Meditative' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'active', label: 'Active' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Oct 12" — chart axis labels. dateKey is 'YYYY-MM-DD'.
export function shortDate(dateKey) {
  const [, m, d] = (dateKey || '').split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : '';
}

// "Oct 20, 2026" from an ISO timestamp, in local time — Settings' "Band
// filtering: On since …" (THIRTY-THIRD follow-up).
export function dateFromIso(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// "Mon, Oct 12" — calmest-session card.
export function longDate(dateKey) {
  const [y, m, d] = (dateKey || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}`;
}

// Same day-key convention as sessionStats.todayKey(), so period boundaries
// line up with how sessions are stamped.
function dayKeyDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - n * DAY_MS).toISOString().slice(0, 10);
}

const avg = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

// THIRTY-SEVENTH follow-up: session-type filter and duration weighting.
export const SESSION_TYPES = [
  { key: 'all', label: 'All sessions' },
  { key: 'timed', label: 'Timed' },
  { key: 'continuous', label: 'Continuous' },
];

// A session's recorded length in seconds (for duration weighting).
export function sessionSeconds(s) {
  if (typeof s.elapsedSec === 'number' && s.elapsedSec > 0) return s.elapsedSec;
  if (typeof s.duration === 'number' && s.duration > 0) return s.duration * 60;
  return 60;
}

// Average of `values`, each weighted by its session's length when
// `weighted` (so a 4-hour session counts 48x a 5-minute one); a plain
// average otherwise. Rounded; null when empty.
function wavg(values, sessions, weighted) {
  if (!values.length) return null;
  if (!weighted) return avg(values);
  let sum = 0;
  let wsum = 0;
  values.forEach((v, i) => {
    const w = sessionSeconds(sessions[i]);
    sum += v * w;
    wsum += w;
  });
  return Math.round(sum / wsum);
}
const soundOn = (s) => s.feedbackType === 'both' || s.feedbackType === 'audio';

// Sessions in the period, OLDEST FIRST (allSessions is newest-first), each
// paired with its intensity info: [{ s, info }]. `scale` (THIRTIETH
// follow-up, from displayScale(state.settings)) puts every session on the
// user's current full scale / noise floor.
// THIRTY-SEVENTH follow-up: `sessionType` 'all' | 'timed' | 'continuous'.
export function periodSessions(allSessions, periodKey, scale, sessionType = 'all') {
  const period = PERIODS.find((p) => p.key === periodKey) || PERIODS[1];
  const cutoff = period.days ? dayKeyDaysAgo(period.days - 1) : null;
  const today = todayKey();
  return allSessions
    .filter((s) => !cutoff || (s.dateKey >= cutoff && s.dateKey <= today))
    .filter((s) => sessionType === 'all' || (sessionType === 'continuous' ? !!s.isContinuous : !s.isContinuous))
    .slice()
    .reverse()
    .map((s) => ({ s, info: sessionIntensity(s, scale) }));
}

// Header tiles: session count (all sessions in the period) and average
// intensity (mean of each measured session's median).
export function overview(items, { weighted = false } = {}) {
  const measured = items.filter((x) => x.info.valid);
  return {
    count: items.length,
    avgIntensity: wavg(measured.map((x) => x.info.median), measured.map((x) => x.s), weighted),
  };
}

// Lowest median intensity in the period (optionally one activity type);
// ties go to the most recent. pctBelowAvg compares it with the average for
// the same filter. null when there's no measured session.
export function calmestSession(items, typeKey = 'all', { weighted = false } = {}) {
  const pool = items.filter((x) => x.info.valid && (typeKey === 'all' || x.s.activityType === typeKey));
  if (pool.length === 0) return null;
  let best = pool[0];
  for (const x of pool) if (x.info.median <= best.info.median) best = x;
  const average = wavg(pool.map((x) => x.info.median), pool.map((x) => x.s), weighted);
  const pctBelowAvg = average > 0 ? Math.round(((average - best.info.median) / average) * 100) : 0;
  return { ...best, average, pctBelowAvg };
}

// Intensity chart: one point per measured session (optionally one type),
// a 3-session rolling average, note markers, band-change markers, and the
// "Avg down from X to Y" subtitle (first vs last 3-session average).
//
// THIRTY-SECOND follow-up:
// - view 'band' (default): the usual tremor-band intensity. The subtitle
//   only compares sessions measured on the SAME band as the most recent one
//   (since the last band change), because a band change alters what's
//   measured; it says "since band change" when that cut anything off.
// - view 'all': "All motion" — each session's median on ALL frequencies
//   (allMotionMedian(); includes voluntary movement, not affected by band
//   changes), so it compares across everything. Only sessions recorded
//   since the thirty-first follow-up have it. No band-change markers.
//   `scale` is the display scale (displayScale(state.settings)).
export function intensityTrend(items, typeKey = 'all', { view = 'band', scale, weighted = false } = {}) {
  const typed = items.filter((x) => typeKey === 'all' || x.s.activityType === typeKey);
  const pts =
    view === 'all'
      ? typed
          .map((x) => ({ ...x, m: allMotionMedian(x.s, scale) }))
          .filter((x) => x.m != null)
      : typed.filter((x) => x.info.valid).map((x) => ({ ...x, m: x.info.median }));
  const medians = pts.map((x) => x.m);
  const ptSessions = pts.map((x) => x.s);
  // 3-session rolling average (duration-weighted when `weighted`).
  const rolling = medians.map((_, i) => {
    const from = Math.max(0, i - 2);
    const win = medians.slice(from, i + 1);
    if (!weighted) return win.reduce((a, b) => a + b, 0) / win.length;
    const ws = ptSessions.slice(from, i + 1).map(sessionSeconds);
    return win.reduce((a, v, j) => a + v * ws[j], 0) / ws.reduce((a, w) => a + w, 0);
  });

  const markers = pts
    .map((x, index) => ({ index, text: (x.s.note || '').trim(), kind: 'note' }))
    .filter((m) => m.text.length > 0);
  // Where the frequency band or band filtering changed between consecutive
  // points (tremor-band view only). Rescaling can't correct for these (they
  // change what was measured), so the chart shows where they happened.
  if (view !== 'all') {
    for (let i = 1; i < pts.length; i++) {
      const text = bandChangeLabel(pts[i - 1].s, pts[i].s);
      if (text) markers.push({ index: i, text, kind: 'band' });
    }
  }
  markers.sort((a, b) => a.index - b.index || (a.kind === 'band' ? -1 : 1));

  const start = view === 'all' ? 0 : sameBandStart(pts);
  const cmp = medians.slice(start);
  const cmpS = ptSessions.slice(start);
  const suffix = start > 0 ? ' since band change' : '';
  let subtitle = 'Not enough sessions yet';
  if (cmp.length >= 2) {
    // Up to 3 sessions at each end, never overlapping — with fewer than 6
    // sessions the two windows used to overlap (3 sessions always read as
    // "steady"), which matters more now that comparisons restart at a band
    // change.
    const k = Math.min(3, Math.floor(cmp.length / 2));
    const first = wavg(cmp.slice(0, k), cmpS.slice(0, k), weighted);
    const last = wavg(cmp.slice(-k), cmpS.slice(-k), weighted);
    subtitle = first === last ? `Avg steady at ${last}${suffix}` : `Avg ${last < first ? 'down' : 'up'} from ${first} to ${last}${suffix}`;
  } else if (cmp.length === 1) {
    subtitle = start > 0 ? `Avg ${cmp[0]} · 1 session since band change` : `Avg ${cmp[0]}`;
  }
  return {
    points: pts.map((x) => ({ median: x.m, band: bandFor(x.m), dateKey: x.s.dateKey })),
    rolling,
    markers,
    subtitle,
    view,
  };
}

// Index of the first point in the final same-band run: every point from
// here on was measured on the same band (or the same "filter off") as the
// most recent point. 0 when there was no band change.
export function sameBandStart(pts) {
  let i = pts.length - 1;
  while (i > 0 && bandChangeLabel(pts[i - 1].s, pts[i].s) === null) i--;
  return Math.max(0, i);
}

// Frequency band a session was measured with: 'off' when band filtering
// wasn't applied (sessions before a first Calibration Mode run — and older
// records that predate the field), otherwise "min-max".
function bandKey(s) {
  if (!s.tremorBandFiltered) return 'off';
  const r = (v) => (typeof v === 'number' ? v.toFixed(1) : '?');
  return `${r(s.tremorBandMinHz)}-${r(s.tremorBandMaxHz)}`;
}

export function bandChangeLabel(prev, curr) {
  const a = bandKey(prev);
  const b = bandKey(curr);
  if (a === b) return null;
  if (a === 'off') return 'Band filter on';
  if (b === 'off') return 'Band filter off';
  return 'Band changed';
}

// Time in bands: one entry per measured session (its band split), plus the
// "High time down from 60% to 4%" subtitle (first vs last session).
export function bandsOverTime(items) {
  const pts = items.filter((x) => x.info.valid);
  // THIRTY-SECOND follow-up: like the intensity subtitle, only compare
  // sessions on the same band as the most recent one.
  const start = sameBandStart(pts);
  const cmp = pts.slice(start);
  const suffix = start > 0 ? ' since band change' : '';
  let subtitle = 'Not enough sessions yet';
  if (cmp.length >= 2) {
    const first = cmp[0].info.pct.high;
    const last = cmp[cmp.length - 1].info.pct.high;
    if (first === 0 && last === 0) subtitle = `No High-band time at start or end${suffix}`;
    else if (first === last) subtitle = `High time steady at ${last}%${suffix}`;
    else subtitle = `High time ${last < first ? 'down' : 'up'} from ${first}% to ${last}%${suffix}`;
  } else if (cmp.length === 1) {
    subtitle = start > 0 ? `High time ${cmp[0].info.pct.high}% · 1 session since band change` : `High time ${cmp[0].info.pct.high}%`;
  }
  return { sessions: pts.map((x) => ({ pct: x.info.pct, dateKey: x.s.dateKey })), subtitle };
}

// Average band split across several sessions (for the activity tiles'
// mini bars), adding to 100. Weighted, it's the true share of all the
// recorded time spent in each band.
function averagePct(measured, weighted) {
  if (measured.length === 0) return null;
  const sum = { none: 0, mild: 0, moderate: 0, high: 0 };
  for (const x of measured) {
    const w = weighted ? sessionSeconds(x.s) : 1;
    for (const b of INTENSITY_BANDS) sum[b.key] += x.info.pct[b.key] * w;
  }
  return roundTo100(sum);
}

function group(items, predicate, weighted) {
  const all = items.filter((x) => predicate(x.s));
  const measured = all.filter((x) => x.info.valid);
  return {
    count: all.length,
    avgIntensity: wavg(measured.map((x) => x.info.median), measured.map((x) => x.s), weighted),
    pct: averagePct(measured, weighted),
  };
}

export function byActivity(items, { weighted = false } = {}) {
  return ACTIVITY_TYPES.map((t) => ({ ...t, ...group(items, (s) => s.activityType === t.key, weighted) }));
}

export function soundAndGuide(items, { weighted = false } = {}) {
  return {
    soundOn: group(items, soundOn, weighted),
    soundOff: group(items, (s) => !soundOn(s), weighted),
    withGuide: group(items, (s) => !!s.guideSource, weighted),
    withoutGuide: group(items, (s) => !s.guideSource, weighted),
  };
}

// Average dominant frequency, and whether it's stable / rising / falling:
// first half of the period vs second half, stable within ±0.5 Hz (agreed).
export const FREQ_STABLE_HZ = 0.5;
export function frequencySummary(items, { weighted = false } = {}) {
  const withF = items.filter((x) => typeof x.s.freq === 'number' && x.s.freq > 0);
  const freqs = withF.map((x) => x.s.freq);
  if (freqs.length === 0) return { avgHz: null, trend: null };
  const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
  const ws = withF.map((x) => (weighted ? sessionSeconds(x.s) : 1));
  const avgHz = Math.round((freqs.reduce((t, f, i) => t + f * ws[i], 0) / ws.reduce((t, w) => t + w, 0)) * 10) / 10;
  if (freqs.length < 2) return { avgHz, trend: null };
  const half = Math.floor(freqs.length / 2);
  const diff = mean(freqs.slice(freqs.length - half)) - mean(freqs.slice(0, half));
  const trend = Math.abs(diff) <= FREQ_STABLE_HZ ? 'stable' : diff > 0 ? 'rising' : 'falling';
  return { avgHz, trend };
}

// Evenly spaced x-axis label positions (session indices) for n points.
export function axisTicks(n, maxTicks = 5) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const k = Math.min(maxTicks, n);
  return [...new Set(Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1))))];
}
