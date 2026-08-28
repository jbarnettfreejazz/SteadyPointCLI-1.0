const DAY_MS = 86400000;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Sessions that didn't meet the SteadyPoint Score's validity gate (< 10
// tremor-level samples or < 30 seconds) have score: null — filter these
// out before any average/max/comparison involving score, everywhere.
export function hasScore(s) {
  return s.score !== null && s.score !== undefined;
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

// Ported from build7DayChart() — real mode only (this app doesn't expose
// a demo-mode toggle in the UI, so we always build from allSessions).
export function build7DayChart(allSessions) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const scoresByDate = allSessions.filter(hasScore).reduce((acc, s) => {
    if (!acc[s.dateKey]) acc[s.dateKey] = [];
    acc[s.dateKey].push(s.score);
    return acc;
  }, {});

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    const scores = scoresByDate[key] || [];
    const isToday = i === 0;
    const label = isToday ? 'Today' : DAY_LABELS[d.getDay()];
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    days.push({ key, label, avg, isToday });
  }
  return days;
}

const ACTIVITY_CONFIG = [
  { key: 'meditative', label: 'Meditative', bg: 'bgInfo', color: 'info' },
  { key: 'engaged', label: 'Engaged', bg: 'bgSuccess', color: 'success' },
  { key: 'active', label: 'Active', bg: 'bgWarning', color: 'warning' },
];

// Ported from the BY ACTIVITY TYPE section of renderAnalytics().
export function byActivityType(allSessions) {
  return ACTIVITY_CONFIG.map((a) => {
    const ss = allSessions.filter((s) => s.activityType === a.key);
    const scored = ss.filter(hasScore);
    const av = scored.length > 0 ? Math.round(scored.reduce((t, s) => t + s.score, 0) / scored.length) : null;
    return { ...a, avg: av, count: ss.length };
  });
}

// Ported from the BY SOUND FEEDBACK section.
export function bySoundFeedback(allSessions) {
  const avg = (arr) => {
    const scored = arr.filter(hasScore);
    return scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null;
  };
  const sOn = allSessions.filter((s) => s.feedbackType === 'both' || s.feedbackType === 'audio');
  const sOff = allSessions.filter((s) => s.feedbackType !== 'both' && s.feedbackType !== 'audio');
  const onAvg = avg(sOn);
  const offAvg = avg(sOff);
  const onBetter = (onAvg || 0) >= (offAvg || 0);
  return [
    { label: 'Sound OFF', count: sOff.length, avg: offAvg, best: !onBetter && offAvg !== null },
    { label: 'Sound ON', count: sOn.length, avg: onAvg, best: onBetter && onAvg !== null },
  ];
}

const GUIDE_CONFIG = [
  { key: 'none', label: 'No guide' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'phone', label: 'Local audio' },
];

// Ported from the BY GUIDE SOURCE section — rows with zero sessions are
// dropped, same as the original. Spotify/YouTube will simply never appear
// since this app doesn't produce sessions with those guide sources yet.
export function byGuideSource(allSessions) {
  return GUIDE_CONFIG.map((g) => {
    const ss = allSessions.filter((s) => (s.guideSource || 'none') === g.key);
    const scored = ss.filter(hasScore);
    const av = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null;
    return { ...g, count: ss.length, avg: av };
  }).filter((g) => g.count > 0);
}

// Ported from the KEY INSIGHT section — the highest-scoring activity type.
export function keyInsight(allSessions) {
  const candidates = byActivityType(allSessions).filter((a) => a.avg !== null && a.avg > 0);
  if (candidates.length === 0) {
    return 'Complete a session to see your personalised insight here.';
  }
  const best = candidates.reduce((b, a) => (a.avg > b.avg ? a : b));
  return `${best.label} is your highest-scoring activity type (avg ${best.avg}). Your tremor responds most positively in this mode.`;
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
// past (non-today) sessions by date, labeling "Yesterday" specially and
// other days by weekday name. Returns [{ label, sessions }], most recent
// day first (matching allSessions being newest-first already).
export function groupPastSessionsByDay(allSessions) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterdayKey = new Date(today.getTime() - DAY_MS).toISOString().slice(0, 10);
  const tKey = todayKey();

  const past = allSessions.filter((s) => s.dateKey !== tKey);
  const groups = [];
  const groupIndex = {};

  for (const s of past) {
    const d = new Date(s.dateKey + 'T00:00:00');
    const label = s.dateKey === yesterdayKey ? 'Yesterday' : DAY_LABELS[d.getDay()];
    if (groupIndex[s.dateKey] === undefined) {
      groupIndex[s.dateKey] = groups.length;
      groups.push({ label, dateKey: s.dateKey, sessions: [] });
    }
    groups[groupIndex[s.dateKey]].sessions.push(s);
  }
  return groups;
}

export function scoreColor(score, colors) {
  if (score == null) return colors.bg2;
  if (score >= 70) return colors.bgSuccess;
  if (score >= 45) return colors.bgWarning;
  return colors.bgDanger;
}

export function scoreTextColor(score, colors) {
  if (score == null) return colors.tx3;
  if (score >= 70) return colors.success;
  if (score >= 45) return colors.warning;
  return colors.danger;
}
