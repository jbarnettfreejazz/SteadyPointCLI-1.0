// Mirrors the original HTML's global `let` declarations, minus the
// high-frequency BLE buffers (those live in liveSession.js).

function seedWeeklyData() {
  const DAY_MS = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const stubScores = [58, 70, 71, 77, 65, 68];
  const data = {};
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    data[key] = { scores: [stubScores[6 - i]], totalMins: 10, sessions: 1 };
  }
  return data;
}

export function emptyAnalyticsData() {
  return { totalSessions: 0, totalMins: 0, weeklyScores: {}, activityAvgs: {} };
}

export function demoAnalyticsData() {
  return {
    totalSessions: 8,
    totalMins: 90,
    weeklyScores: seedWeeklyData(),
    activityAvgs: {
      meditative: { sum: 74 + 62 + 84 + 71, count: 4 },
      engaged: { sum: 68 + 65, count: 2 },
      active: { sum: 77 + 58, count: 2 },
    },
  };
}

export function buildInitialState(appMode = 'real') {
  return {
    appMode, // 'demo' | 'real'
    screen: 'home',
    config: { feedbackType: 'both', activityType: 'meditative', activityNote: '', duration: 10, customName: '' },
    pinnedSessions: [],
    setupMode: 'start', // 'start' | 'save'
    editingPinnedId: null,
    results: null,
    scoreAnim: false,
    histFilter: 'week',
    learnFilter: 'all',
    selectedArticle: null,
    selectedSession: null,

    settings: {
      notifications: true,
      reminder: '8:00 AM',
      sonification: true,
      defaultDuration: 10,
      defaultType: 'guided',
    },

    // BLE connection status (not packet data — see liveSession.js)
    isConnected: false,
    bleConnecting: false,
    bleError: '',

    guideMediaSource: null, // 'phone' | null
    guideMediaName: '',
    guideMediaPath: null, // filename within Documents/ — see guideAudioPicker.js for why not a full path
    lastGuideName: '',

    analyticsData: appMode === 'demo' ? demoAnalyticsData() : emptyAnalyticsData(),
    allSessions: [],
    todaySessionNextId: 100,
    pinnedNextId: 1,

    customTemplates: [],
    nextCustomId: 1,
    newCustomType: {
      name: '',
      activityType: 'meditative',
      feedbackType: 'both',
      guideSource: null,
      duration: 10,
    },
  };
}
