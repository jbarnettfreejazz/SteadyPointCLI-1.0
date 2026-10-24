import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as live from '../state/liveSession';

// THIRTY-SIXTH follow-up: saves the session in progress while it runs, so a
// session isn't lost if the app is closed unexpectedly, and can be continued
// after a Bluetooth disconnect.
//
// Storage layout:
//   sp_activeSession        meta: status, the session's setup, calibration
//                           segments, events, elapsed time, how many chunks
//   sp_activeChunk_<n>      readings recorded since the previous chunk,
//                           { g: [...], a: [...] } (in-band and all-frequency
//                           motion, g, rounded to 0.0001) — each written once
//
// A chunk is written every CHECKPOINT_INTERVAL_MS and whenever the app goes
// to the background (iOS may close a background app without warning). All
// writes go through one queue so they land in order.
//
// status: 'recording'    session in progress (if found at launch, the app
//                        was closed mid-session — see recoverOnLaunch in
//                        sessionLogic.js)
//         'disconnected' ended by a disconnect; can be continued within
//                        RESUME_WINDOW_MIN (utils/sessionRecord.js)
//         'finished'     ended normally; cleared once the session is saved

export const META_KEY = 'sp_activeSession';
const chunkKey = (n) => `sp_activeChunk_${n}`;
export const CHECKPOINT_INTERVAL_MS = 60 * 1000;

let meta = null; // in-memory copy of the meta being written
// Bumped whenever a new session starts checkpointing or the checkpoint is
// cleared, so a queued end-of-session write can tell it's been superseded.
let generation = 0;
let timer = null;
let queue = Promise.resolve();
let appStateSub = null;

function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.warn('session checkpoint failed', e?.message || e));
  return queue;
}

const round = (v) => Math.round(v * 10000) / 10000;

// Writes readings recorded since the last chunk (if any) plus the meta.
// `rec` defaults to the live recording at the time of writing; the end of a
// session passes a snapshot taken when it ended.
async function writeNow(rec = live.getRecording()) {
  if (!meta) return;
  const n = Math.min(rec.rmsTraceG.length, rec.rmsAllTraceG.length);
  const pairs = [];
  if (n > meta.savedReadings) {
    const chunk = {
      g: rec.rmsTraceG.slice(meta.savedReadings, n).map(round),
      a: rec.rmsAllTraceG.slice(meta.savedReadings, n).map(round),
    };
    pairs.push([chunkKey(meta.chunkCount), JSON.stringify(chunk)]);
    meta = { ...meta, chunkCount: meta.chunkCount + 1, savedReadings: n };
  }
  meta = {
    ...meta,
    segments: rec.segments,
    events: rec.events,
    elapsed: rec.elapsed,
    packetCount: rec.packetCount,
    liveFreqHz: rec.liveFreqHz,
    lastSavedAtMs: Date.now(),
  };
  pairs.push([META_KEY, JSON.stringify(meta)]);
  await AsyncStorage.multiSet(pairs);
}

export function flushCheckpoint() {
  return enqueue(writeNow);
}

// Starts checkpointing a session. `base` is the session's setup (config,
// guide, origin, startedAtMs, totalSeconds, …). When continuing a session,
// pass the previous meta's chunkCount / savedReadings so chunks carry on.
// A brand-new session first removes any old checkpoint (fresh: true).
export function startCheckpointing(base, { fresh = false } = {}) {
  stopTimer();
  if (fresh) enqueue(removeStoredKeys);
  generation += 1;
  meta = { v: 1, chunkCount: 0, savedReadings: 0, ...base, status: 'recording' };
  timer = setInterval(flushCheckpoint, CHECKPOINT_INTERVAL_MS);
  appStateSub = AppState.addEventListener?.('change', (next) => {
    if (next !== 'active') flushCheckpoint();
  });
  return flushCheckpoint();
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  appStateSub?.remove?.();
  appStateSub = null;
}

// Updates fields of the meta (e.g. feedbackType after the sonification
// switch) and saves.
export function updateCheckpointMeta(patch) {
  if (!meta) return Promise.resolve();
  meta = { ...meta, ...patch };
  return flushCheckpoint();
}

// The session ended: last readings, final status, stop the timer.
// status 'finished' | 'disconnected'; extra e.g. { sessionId, disconnectedAtMs }.
export function finishCheckpointing(status, extra = {}) {
  stopTimer();
  if (!meta) return Promise.resolve();
  const rec = live.getRecording(); // snapshot now, before anything else can reset it
  const mine = generation;
  return enqueue(async () => {
    if (generation !== mine || !meta) return; // a newer session took over
    await writeNow(rec);
    meta = { ...meta, ...extra, status };
    await AsyncStorage.multiSet([[META_KEY, JSON.stringify(meta)]]);
  });
}

// Called after the session list has been saved: a finished session's
// checkpoint is no longer needed.
export function onSessionPersisted() {
  return enqueue(async () => {
    if (meta && meta.status === 'finished') {
      meta = null;
      await removeStoredKeys();
    }
  });
}

// Removes the stored meta and every chunk it lists (storage only).
async function removeStoredKeys() {
  const raw = await AsyncStorage.multiGet([META_KEY]);
  let count = 0;
  try {
    count = raw[0][1] ? JSON.parse(raw[0][1]).chunkCount || 0 : 0;
  } catch (e) {
    count = 0;
  }
  const keys = [META_KEY, ...Array.from({ length: count }, (_, i) => chunkKey(i))];
  if (AsyncStorage.multiRemove) await AsyncStorage.multiRemove(keys);
  else for (const k of keys) await AsyncStorage.removeItem(k);
}

// Removes the checkpoint (session saved, declined to continue, or expired).
export function clearCheckpoint() {
  stopTimer();
  generation += 1;
  meta = null;
  return enqueue(removeStoredKeys);
}

// Reads the checkpoint: { meta, rmsTraceG, rmsAllTraceG } or null.
export async function loadCheckpoint() {
  await queue; // let pending writes land first
  const raw = await AsyncStorage.multiGet([META_KEY]);
  if (!raw[0][1]) return null;
  let stored;
  try {
    stored = JSON.parse(raw[0][1]);
  } catch (e) {
    return null;
  }
  const keys = Array.from({ length: stored.chunkCount || 0 }, (_, i) => chunkKey(i));
  const chunks = keys.length ? await AsyncStorage.multiGet(keys) : [];
  const rmsTraceG = [];
  const rmsAllTraceG = [];
  for (const [, value] of chunks) {
    if (!value) continue;
    try {
      const c = JSON.parse(value);
      rmsTraceG.push(...(c.g || []));
      rmsAllTraceG.push(...(c.a || []));
    } catch (e) {
      // skip a damaged chunk
    }
  }
  return { meta: stored, rmsTraceG, rmsAllTraceG };
}

// The in-memory meta (null when no session is being checkpointed).
export function getCheckpointMeta() {
  return meta;
}

// Test helper: forget in-memory state without touching storage.
export function _resetForTests() {
  stopTimer();
  generation += 1;
  meta = null;
  queue = Promise.resolve();
}
