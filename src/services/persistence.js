import AsyncStorage from '@react-native-async-storage/async-storage';

// ══════════════════════════════════════════════════════
// PERSISTENCE
// Mirrors SP_KEYS / persistSave / persistLoad from the original HTML.
// localStorage -> AsyncStorage. IndexedDB audio blobs -> files in
// RNFS.DocumentDirectoryPath, referenced by path instead of by Blob.
// ══════════════════════════════════════════════════════

export const SP_KEYS = {
  meta: 'sp_meta',
  pinned: 'sp_pinnedSessions',
  // TWENTY-EIGHTH follow-up: no longer written (it only held per-day
  // SteadyPoint Score totals, which nothing read). Kept so persistLoad can
  // remove the old entry from storage.
  analytics: 'sp_analyticsData',
  settings: 'sp_settings',
  sessions: 'sp_allSessions',
  mode: 'sp_appMode',
  pinnedNextId: 'sp_pinnedNextId',
  todaySessionNextId: 'sp_todaySessionNextId',
};

export async function persistSave(state) {
  if (state.appMode === 'demo') return; // Demo mode is fully sandboxed — never persist
  try {
    // pinnedSessions in RN store a guideAudioPath (string) instead of a
    // Blob/ObjectURL pair, so there's nothing transient to strip before save.
    await AsyncStorage.multiSet([
      [SP_KEYS.pinned, JSON.stringify(state.pinnedSessions)],
      [SP_KEYS.settings, JSON.stringify(state.settings)],
      [SP_KEYS.sessions, JSON.stringify(state.allSessions)],
      [SP_KEYS.mode, state.appMode],
      // pinnedNextId/todaySessionNextId must be saved too — without them,
      // these counters reset to their initial values on every app restart
      // while the arrays they index into (which DO persist) keep their old
      // ids, causing a fresh entry to collide with an existing one (visible
      // as a React "duplicate key" warning on Home).
      [SP_KEYS.pinnedNextId, String(state.pinnedNextId)],
      [SP_KEYS.todaySessionNextId, String(state.todaySessionNextId)],
      [SP_KEYS.meta, JSON.stringify({ savedAt: new Date().toISOString(), version: '0.3.0' })],
    ]);
  } catch (e) {
    console.warn('persistSave failed', e);
  }
}

// THIRTY-FOURTH follow-up: save just the settings, right after they change
// (App.js). Settings changed outside a session — calibration values,
// voice, custom tonal range, Analytics date range — were previously only
// saved by the next full persistSave (e.g. at session end), so closing the
// app first lost them. Also writes meta so persistLoad() doesn't ignore the
// save for a user who hasn't completed a session yet.
export async function persistSettings(state) {
  if (state.appMode === 'demo') return;
  try {
    await AsyncStorage.multiSet([
      [SP_KEYS.settings, JSON.stringify(state.settings)],
      [SP_KEYS.mode, state.appMode],
      [SP_KEYS.meta, JSON.stringify({ savedAt: new Date().toISOString(), version: '0.3.0' })],
    ]);
  } catch (e) {
    console.warn('persistSettings failed', e);
  }
}

export async function persistLoad() {
  try {
    const entries = await AsyncStorage.multiGet([
      SP_KEYS.pinned,
      SP_KEYS.analytics,
      SP_KEYS.settings,
      SP_KEYS.sessions,
      SP_KEYS.mode,
      SP_KEYS.pinnedNextId,
      SP_KEYS.todaySessionNextId,
      SP_KEYS.meta,
    ]);
    const map = Object.fromEntries(entries);
    if (map[SP_KEYS.analytics]) AsyncStorage.removeItem(SP_KEYS.analytics).catch(() => {});
    if (!map[SP_KEYS.meta]) return null; // nothing saved yet

    let pinnedSessions = map[SP_KEYS.pinned] ? JSON.parse(map[SP_KEYS.pinned]) : [];
    let allSessions = map[SP_KEYS.sessions] ? JSON.parse(map[SP_KEYS.sessions]) : [];

    // Repair any duplicate ids already saved from before this fix existed —
    // re-number in place so nothing regenerates as `1, 1, 1`.
    const seenIds = new Set();
    let repaired = false;
    pinnedSessions = pinnedSessions.map((s, i) => {
      if (s.id == null || seenIds.has(s.id)) {
        repaired = true;
        seenIds.add(i + 1);
        return { ...s, id: i + 1 };
      }
      seenIds.add(s.id);
      return s;
    });
    if (repaired) {
      await AsyncStorage.setItem(SP_KEYS.pinned, JSON.stringify(pinnedSessions));
    }

    // Same repair for allSessions — session records didn't get an id field
    // at all before this fix, which breaks list keys and session-detail
    // lookups. allSessions is newest-first, so number from the end (oldest)
    // upward to keep ids stable/increasing with actual chronological order.
    let sessionsRepaired = false;
    const seenSessionIds = new Set();
    allSessions = allSessions
      .slice()
      .reverse()
      .map((s, i) => {
        if (s.id == null || seenSessionIds.has(s.id)) {
          sessionsRepaired = true;
          seenSessionIds.add(100 + i);
          return { ...s, id: 100 + i };
        }
        seenSessionIds.add(s.id);
        return s;
      })
      .reverse();
    if (sessionsRepaired) {
      await AsyncStorage.setItem(SP_KEYS.sessions, JSON.stringify(allSessions));
    }

    // Fall back to (highest existing id + 1) if the counter itself is
    // missing (e.g. data saved before this fix existed) — safer than
    // trusting a stale default of 1 when ids up to N might already exist.
    const maxPinnedId = pinnedSessions.reduce((m, s) => Math.max(m, s.id || 0), 0);
    const maxSessionId = allSessions.reduce((m, s) => Math.max(m, s.id || 0), 0);

    // Backfills fields added to settings after this user's data was first
    // saved — critically, hasCalibrated backfills to true here (not the
    // fresh-install default of false), since reaching this point at all
    // means a prior settings blob existed, proving this is a returning
    // user who's already been using the app — not someone who should
    // suddenly hit the mandatory first-launch Calibration Mode gate after
    // simply updating. A genuinely brand-new install never reaches this
    // line at all (see the `!map[SP_KEYS.meta]` return above), so it
    // still correctly gets hasCalibrated: false from initialState.js.
    const loadedSettings = map[SP_KEYS.settings] ? JSON.parse(map[SP_KEYS.settings]) : null;
    const settings = loadedSettings
      ? {
          tremorBandMinHz: 3,
          tremorBandMaxHz: 14,
          noiseFloorG: 0.006,
          lastCalibratedAt: null,
          customTonalRangeMinHz: 200,
          customTonalRangeMaxHz: 700,
          ...loadedSettings,
          hasCalibrated: loadedSettings.hasCalibrated ?? true,
          // THIRTY-FIFTH follow-up: band filtering used to be "on once the
          // wizard was saved" (lastCalibratedAt); it's now its own setting.
          // Existing users keep exactly the behaviour they had.
          bandFilterEnabled: loadedSettings.bandFilterEnabled ?? !!loadedSettings.lastCalibratedAt,
        }
      : null;
    // TWENTY-SECOND follow-up: 'cello_a' ("Cello A (test)") became the
    // regular Cello and 'cello_b' ("Cello B (test)") was removed — map
    // either saved choice to 'cello'.
    if (settings && (settings.sonificationVoice === 'cello_a' || settings.sonificationVoice === 'cello_b')) {
      settings.sonificationVoice = 'cello';
    }

    return {
      pinnedSessions,
      settings,
      allSessions,
      appMode: map[SP_KEYS.mode] || 'real',
      pinnedNextId: map[SP_KEYS.pinnedNextId] ? parseInt(map[SP_KEYS.pinnedNextId], 10) : maxPinnedId + 1,
      todaySessionNextId: map[SP_KEYS.todaySessionNextId]
        ? parseInt(map[SP_KEYS.todaySessionNextId], 10)
        : Math.max(100, maxSessionId + 1),
    };
  } catch (e) {
    console.warn('persistLoad failed', e);
    return null;
  }
}
