// TWENTY-SEVENTH follow-up: calculations behind the redesigned Analytics
// screen (no SteadyPoint Score). Everything is derived from saved session
// records via sessionIntensity() (utils/intensityStats.js), so sessions from
// before the redesign are included. Pure functions — no React — so they can
// be tested on their own.
import { sessionIntensity, roundTo100, INTENSITY_BANDS } from './intensityStats';
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
const soundOn = (s) => s.feedbackType === 'both' || s.feedbackType === 'audio';

// Sessions in the period, OLDEST FIRST (allSessions is newest-first), each
// paired with its intensity info: [{ s, info }].
export function periodSessions(allSessions, periodKey) {
  const period = PERIODS.find((p) => p.key === periodKey) || PERIODS[1];
  const cutoff = period.days ? dayKeyDaysAgo(period.days - 1) : null;
  const today = todayKey();
  return allSessions
    .filter((s) => !cutoff || (s.dateKey >= cutoff && s.dateKey <= today))
    .slice()
    .reverse()
    .map((s) => ({ s, info: sessionIntensity(s) }));
}

// Header tiles: session count (all sessions in the period) and average
// intensity (mean of each measured session's median).
export function overview(items) {
  const measured = items.filter((x) => x.info.valid);
  return { count: items.length, avgIntensity: avg(measured.map((x) => x.info.median)) };
}

// Lowest median intensity in the period (optionally one activity type);
// ties go to the most recent. pctBelowAvg compares it with the average for
// the same filter. null when there's no measured session.
export function calmestSession(items, typeKey = 'all') {
  const pool = items.filter((x) => x.info.valid && (typeKey === 'all' || x.s.activityType === typeKey));
  if (pool.length === 0) return null;
  let best = pool[0];
  for (const x of pool) if (x.info.median <= best.info.median) best = x;
  const average = avg(pool.map((x) => x.info.median));
  const pctBelowAvg = average > 0 ? Math.round(((average - best.info.median) / average) * 100) : 0;
  return { ...best, average, pctBelowAvg };
}

// Intensity chart: one point per measured session (optionally one type),
// a 3-session rolling average, note markers, and the "Avg down from X to Y"
// subtitle (first vs last 3-session average, as agreed).
export function intensityTrend(items, typeKey = 'all') {
  const pts = items.filter((x) => x.info.valid && (typeKey === 'all' || x.s.activityType === typeKey));
  const medians = pts.map((x) => x.info.median);
  const rolling = medians.map((_, i) => {
    const win = medians.slice(Math.max(0, i - 2), i + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
  let subtitle = 'Not enough sessions yet';
  if (pts.length >= 2) {
    const first = avg(medians.slice(0, Math.min(3, medians.length)));
    const last = avg(medians.slice(-Math.min(3, medians.length)));
    subtitle = first === last ? `Avg steady at ${last}` : `Avg ${last < first ? 'down' : 'up'} from ${first} to ${last}`;
  } else if (pts.length === 1) {
    subtitle = `Avg ${medians[0]}`;
  }
  const markers = pts
    .map((x, index) => ({ index, text: (x.s.note || '').trim() }))
    .filter((m) => m.text.length > 0);
  return {
    points: pts.map((x) => ({ median: x.info.median, band: x.info.band, dateKey: x.s.dateKey })),
    rolling,
    markers,
    subtitle,
  };
}

// Time in bands: one entry per measured session (its band split), plus the
// "High time down from 60% to 4%" subtitle (first vs last session).
export function bandsOverTime(items) {
  const pts = items.filter((x) => x.info.valid);
  let subtitle = 'Not enough sessions yet';
  if (pts.length >= 2) {
    const first = pts[0].info.pct.high;
    const last = pts[pts.length - 1].info.pct.high;
    if (first === 0 && last === 0) subtitle = 'No High-band time at start or end';
    else if (first === last) subtitle = `High time steady at ${last}%`;
    else subtitle = `High time ${last < first ? 'down' : 'up'} from ${first}% to ${last}%`;
  } else if (pts.length === 1) {
    subtitle = `High time ${pts[0].info.pct.high}%`;
  }
  return { sessions: pts.map((x) => ({ pct: x.info.pct, dateKey: x.s.dateKey })), subtitle };
}

// Average band split across several sessions (for the activity tiles'
// mini bars), adding to 100.
function averagePct(measured) {
  if (measured.length === 0) return null;
  const sum = { none: 0, mild: 0, moderate: 0, high: 0 };
  for (const x of measured) for (const b of INTENSITY_BANDS) sum[b.key] += x.info.pct[b.key];
  return roundTo100(sum);
}

function group(items, predicate) {
  const all = items.filter((x) => predicate(x.s));
  const measured = all.filter((x) => x.info.valid);
  return { count: all.length, avgIntensity: avg(measured.map((x) => x.info.median)), pct: averagePct(measured) };
}

export function byActivity(items) {
  return ACTIVITY_TYPES.map((t) => ({ ...t, ...group(items, (s) => s.activityType === t.key) }));
}

export function soundAndGuide(items) {
  return {
    soundOn: group(items, soundOn),
    soundOff: group(items, (s) => !soundOn(s)),
    withGuide: group(items, (s) => !!s.guideSource),
    withoutGuide: group(items, (s) => !s.guideSource),
  };
}

// Average dominant frequency, and whether it's stable / rising / falling:
// first half of the period vs second half, stable within ±0.5 Hz (agreed).
export const FREQ_STABLE_HZ = 0.5;
export function frequencySummary(items) {
  const freqs = items.map((x) => x.s.freq).filter((f) => typeof f === 'number' && f > 0);
  if (freqs.length === 0) return { avgHz: null, trend: null };
  const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
  const avgHz = Math.round(mean(freqs) * 10) / 10;
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
