// THIRTY-SIXTH follow-up: builds a saved session record from the readings a
// session collected. Used for every way a session can end — End Session, a
// timed session completing, a Bluetooth disconnect, a resumed session
// ending, and a session recovered after the app closed unexpectedly — so
// they all produce identical records. Pure functions (no React / storage).
//
// Readings: one every 0.3 s, as the motion behind each intensity reading in
// g — rmsG (what intensity is scored from: in-band when band filtering is
// on) and rmsAllG (all frequencies). Intensity is re-scored from rmsG on the
// session's FINAL full scale / noise floor, so a mid-session full-scale or
// noise-floor change leaves the whole session on one consistent scale.
// Band changes can't be converted; they're kept as events for the chart.

import { rmsToLevel } from './dsp';
import { median, bandPercentages } from './intensityStats';

// How long after a disconnect the session can still be continued.
export const RESUME_WINDOW_MIN = 10;

// Same day-key convention as the rest of the app (local midnight -> ISO date).
export function dayKeyOf(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// "9:05 AM"
export function timeOfDay(ms) {
  const d = new Date(ms);
  const hh = d.getHours();
  const mm = d.getMinutes();
  return `${hh % 12 || 12}:${mm.toString().padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}

// Saved trace length: every reading for short sessions (up to 150), else
// 150 points for up to 30 minutes, 5 per minute beyond that, at most 600
// (reached at 2 hours). Returns how many readings each point averages.
export function sliceSize(n, durationSec) {
  if (n <= 150) return 1;
  const maxPoints = Math.min(600, Math.max(150, Math.round((durationSec / 60) * 5)));
  return Math.ceil(n / maxPoints);
}

const roundG = (v) => Math.round(v * 10000) / 10000;
const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;

// Averages readings into time slices of k readings. Peaks (the largest g in
// each slice) are only kept when slices hold more than one reading.
export function sliceTraces({ levels, g, gAll }, k) {
  const out = { intensityTrace: [], rmsTraceG: [], rmsAllTraceG: [], rmsPeakTraceG: k > 1 ? [] : null };
  for (let i = 0; i < levels.length; i += k) {
    const lv = levels.slice(i, i + k);
    const gs = g.slice(i, i + k);
    const ga = gAll.slice(i, i + k);
    out.intensityTrace.push(Math.round(mean(lv)));
    out.rmsTraceG.push(roundG(mean(gs)));
    out.rmsAllTraceG.push(roundG(mean(ga)));
    if (out.rmsPeakTraceG) out.rmsPeakTraceG.push(roundG(Math.max(...gs)));
  }
  return out;
}

// Combined motion of several readings (root-mean-square of their RMS values).
function combinedRms(values) {
  return values.length ? Math.sqrt(mean(values.map((v) => v * v))) : 0;
}

const bandKey = (seg) =>
  seg.tremorBandFiltered ? `${Number(seg.tremorBandMinHz).toFixed(1)}-${Number(seg.tremorBandMaxHz).toFixed(1)}` : 'off';

// Chart events from calibration changes made during the session, plus any
// passed-in events (e.g. reconnects), sorted by time.
export function calibrationEvents(segments, extraEvents = []) {
  const events = [];
  for (let i = 1; i < (segments || []).length; i++) {
    const prev = segments[i - 1];
    const seg = segments[i];
    const band = bandKey(prev) !== bandKey(seg);
    const scale = prev.fullScaleG !== seg.fullScaleG || prev.noiseFloorG !== seg.noiseFloorG;
    if (band || scale) events.push({ atSec: seg.atSec, kind: band ? 'band' : 'scale' });
  }
  return [...events, ...extraEvents].sort((a, b) => a.atSec - b.atSec);
}

const STATUS = {
  disconnected: 'Session ended early — the app lost connection to your M5Stick device.',
  interrupted: 'The app closed unexpectedly during this session. It was recovered up to its last automatic save.',
};

const LABELS = { meditative: 'Meditation session', engaged: 'Engaged session', active: 'Active session' };

// data: {
//   rmsG, rmsAllG          readings (g), index-aligned
//   segments               [{ i, atSec, fullScaleG, noiseFloorG, tremorBandMinHz, tremorBandMaxHz, tremorBandFiltered }]
//   events                 extra chart events, e.g. [{ atSec, kind: 'reconnect' }]
//   elapsedSec             recorded time (excludes any disconnected gap)
//   startedAtMs, endedAtMs
//   config                 { activityType, feedbackType, duration, activityNote }
//   guide                  { source, name, path }
//   origin, customSessionId, saveOffer
//   peakFreq, packetCount
//   endReason              'completed' | 'disconnected' | 'interrupted'
// }
// Returns { record, results }: the session record (no id) and Summary's results.
export function buildSessionRecord(data) {
  const rmsG = data.rmsG || [];
  const rmsAllG = data.rmsAllG || [];
  const n = Math.min(rmsG.length, rmsAllG.length);
  const g = rmsG.slice(0, n);
  const gAll = rmsAllG.slice(0, n);
  const segments = data.segments?.length
    ? data.segments
    : [{ i: 0, atSec: 0, fullScaleG: 0.35, noiseFloorG: 0.006, tremorBandMinHz: 3, tremorBandMaxHz: 14, tremorBandFiltered: false }];
  const final = segments[segments.length - 1];
  const secs = data.elapsedSec || 0;

  const levels = g.map((v) => rmsToLevel(v, final.fullScaleG, final.noiseFloorG));
  const intensityValid = n >= 10 && secs >= 30;
  const medianIntensity = intensityValid ? Math.round(median(levels)) : null;
  const bandPct = intensityValid ? bandPercentages(levels) : null;

  // Start vs end: all-frequency motion over the first and last 10% of the
  // readings (was computed from the raw sensor samples, no longer kept).
  let startLevel = 0;
  let endLevel = 0;
  let reduction = 0;
  if (n >= 10) {
    const tenPct = Math.max(3, Math.floor(n * 0.1));
    startLevel = rmsToLevel(combinedRms(gAll.slice(0, tenPct)), final.fullScaleG, final.noiseFloorG);
    endLevel = rmsToLevel(combinedRms(gAll.slice(-tenPct)), final.fullScaleG, final.noiseFloorG);
    reduction = startLevel > 0 ? Math.max(0, Math.round(((startLevel - endLevel) / startLevel) * 100)) : 0;
  }

  const traces = sliceTraces({ levels, g, gAll }, sliceSize(n, secs));
  const config = data.config || {};
  const guide = data.guide || {};
  const startedAtMs = data.startedAtMs || data.endedAtMs || Date.now();
  const endReason = data.endReason || 'completed';
  const events = calibrationEvents(segments, data.events || []);
  const duration = Math.max(1, Math.round(secs / 60));

  const record = {
    dateKey: dayKeyOf(startedAtMs),
    date: 'Today',
    time: timeOfDay(startedAtMs),
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(data.endedAtMs || Date.now()).toISOString(),
    elapsedSec: secs,
    label: (config.activityNote || '').trim() || LABELS[config.activityType] || 'Session',
    reduction,
    fullScaleG: final.fullScaleG,
    noiseFloorG: final.noiseFloorG,
    tremorBandMinHz: final.tremorBandMinHz,
    tremorBandMaxHz: final.tremorBandMaxHz,
    tremorBandFiltered: !!final.tremorBandFiltered,
    duration,
    isContinuous: !config.duration,
    freq: data.peakFreq > 0 ? data.peakFreq : null,
    samples: data.packetCount || 0,
    intensityTrace: traces.intensityTrace,
    rmsTraceG: traces.rmsTraceG,
    rmsAllTraceG: traces.rmsAllTraceG,
    ...(traces.rmsPeakTraceG ? { rmsPeakTraceG: traces.rmsPeakTraceG } : {}),
    events,
    intensityValid,
    medianIntensity,
    bandPct,
    startLevel,
    endLevel,
    activityType: config.activityType,
    feedbackType: config.feedbackType,
    guideSource: guide.source || null,
    guidePath: guide.source === 'phone' ? guide.path || null : null,
    guideName: guide.source === 'phone' ? guide.name || '' : '',
    origin: data.origin || 'setup',
    customSessionId: data.customSessionId ?? null,
    endReason,
    statusMessage: STATUS[endReason] || null,
  };

  const results = {
    reduction,
    fullScaleG: final.fullScaleG,
    noiseFloorG: final.noiseFloorG,
    startLevel,
    endLevel,
    duration,
    peakFreq: record.freq,
    samples: record.samples,
    intensityTrace: record.intensityTrace,
    rmsTraceG: record.rmsTraceG,
    rmsAllTraceG: record.rmsAllTraceG,
    ...(record.rmsPeakTraceG ? { rmsPeakTraceG: record.rmsPeakTraceG } : {}),
    events,
    elapsedSec: secs,
    startedAt: record.startedAt, // THIRTY-SEVENTH follow-up: long-session chart
    intensityValid,
    medianIntensity,
    bandPct,
    origin: record.origin,
    customSessionId: record.customSessionId,
    saveOffer: data.saveOffer ?? null,
  };

  return { record, results };
}
