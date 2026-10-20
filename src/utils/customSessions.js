// Custom sessions (stored as state.pinnedSessions) — shared helpers for
// Home's "CUSTOM SESSIONS" section and the full Custom Sessions screen.

// How many custom sessions Home shows before the "View all (n)" link.
export const HOME_CUSTOM_SESSION_LIMIT = 2;

// Most recently used first. `lastUsedAt` (ms) is set when a custom session
// is created and whenever it's started (see sessionLogic.js). Sessions saved
// before that field existed have no timestamp; they sort after any that do,
// newest-created first by id (ids only ever increase).
export function sortByRecentUse(sessions) {
  return [...sessions].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0) || (b.id || 0) - (a.id || 0));
}

// "Meditative · 10 min · Sound on · No guide" — the configuration line shown
// under each custom session's name.
export function describeCustomSession(s) {
  const act = s.activityType ? s.activityType.charAt(0).toUpperCase() + s.activityType.slice(1) : 'Session';
  const duration = s.duration ? `${s.duration} min` : 'Continuous';
  const sound = s.feedbackType === 'both' || s.feedbackType === 'audio' ? 'Sound on' : 'No sound';
  const guide = s.guideSource === 'phone' ? (s.guideName ? 'Local audio' : '⚠ Reselect audio') : 'No guide';
  return `${act} · ${duration} · ${sound} · ${guide}`;
}
