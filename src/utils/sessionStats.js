const DAY_MS = 86400000;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Downsamples a session's full tremor-level trace to a fixed maximum
// number of points before persisting it with the session record — a
// Continuous Session could run for hours, producing tens of thousands of
// ~300ms samples, which would be wasteful to store in full and pointless
// to render anyway (the Intensity Over Session chart is only ~320
// logical pixels wide, so it can't meaningfully show more detail than
// this regardless of how long the session ran). Simple stride-based
// sampling — reasonable for a visual trend line, not precision data.
export function downsampleTrace(trace, maxPoints = 150) {
  if (!trace || trace.length <= maxPoints) return trace || [];
  const step = trace.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(trace[Math.floor(i * step)]);
  }
  return result;
}

export function todayKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function getTodaySessions(allSessions) {
  const key = todayKey();
  return allSessions.filter((s) => s.dateKey === key);
}

// Ported from sessionInsight(s) — per-session detail-page insight text.
export function sessionInsight(reduction) {
  if (reduction >= 35) {
    return `A ${reduction}% reduction in tremor intensity — a strong parasympathetic response. Consistent practice deepens this effect over time.`;
  }
  if (reduction >= 20) {
    return `A ${reduction}% reduction in tremor intensity. Your nervous system is responding. Keep building the daily habit.`;
  }
  return `Even a ${reduction}% reduction is meaningful. These sessions train the neural pathways that lead to larger shifts as the practice develops.`;
}

// Ported from the day-grouping logic in renderSessionHistory() — groups
// past (non-today) sessions by date, labeling "Yesterday" specially, other
// days of the last week by weekday name, and older days by date
// ("Tue, Oct 13"; the year is added when it isn't this year). Returns
// [{ label, dateKey, sessions }], most recent day first (allSessions is
// already newest-first).
//
// FORTY-SIXTH follow-up: withinDays limits the result to the last N days
// counting today (Session History's "This week" = 7: today and the six days
// before it — the same 7 days as Home's daily bars). Omit it for all days.
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function groupPastSessionsByDay(allSessions, { withinDays = null } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterdayKey = new Date(today.getTime() - DAY_MS).toISOString().slice(0, 10);
  const weekStartKey = new Date(today.getTime() - 6 * DAY_MS).toISOString().slice(0, 10);
  const cutoffKey = withinDays ? new Date(today.getTime() - (withinDays - 1) * DAY_MS).toISOString().slice(0, 10) : null;
  const tKey = todayKey();

  // dateKeys are YYYY-MM-DD, so they compare correctly as strings.
  const past = allSessions.filter((s) => s.dateKey !== tKey && (!cutoffKey || s.dateKey >= cutoffKey));
  const groups = [];
  const groupIndex = {};

  for (const s of past) {
    const d = new Date(s.dateKey + 'T00:00:00');
    let label;
    if (s.dateKey === yesterdayKey) label = 'Yesterday';
    else if (s.dateKey >= weekStartKey) label = DAY_LABELS[d.getDay()];
    else {
      label = `${DAY_LABELS[d.getDay()]}, ${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
      if (d.getFullYear() !== today.getFullYear()) label += `, ${d.getFullYear()}`;
    }
    if (groupIndex[s.dateKey] === undefined) {
      groupIndex[s.dateKey] = groups.length;
      groups.push({ label, dateKey: s.dateKey, sessions: [] });
    }
    groups[groupIndex[s.dateKey]].sessions.push(s);
  }
  return groups;
}
