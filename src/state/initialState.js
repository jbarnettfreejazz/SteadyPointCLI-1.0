// Mirrors the original HTML's global `let` declarations, minus the
// high-frequency BLE buffers (those live in liveSession.js).

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
      fullScaleG: 0.35, // "Full-scale range motion (in g) that reads as intensity 100" — see dsp.js's rmsToLevel()
      sonificationVoice: 'cello', // which single instrument (or 'custom') carries the combined-axis sonification signal
      customTonalRangeMinHz: 200, // Settings > Sonification > "Custom" tonal range — only used when sonificationVoice === 'custom'
      customTonalRangeMaxHz: 700,
      tremorBandMinHz: 3, // Calibration Mode — see Calibration_Mode_Design.pdf
      tremorBandMaxHz: 14,
      noiseFloorG: 0.006, // not measured by Calibration Mode itself; manually editable only (Phase 2)
      hasCalibrated: false, // gates the mandatory first-launch calibration — see RootNavigator.js
      analyticsPeriod: '30d', // THIRTY-FOURTH follow-up: Analytics date range ('7d' | '30d' | 'all'), remembered across launches
      // THIRTY-FIFTH follow-up: band filtering is its own switch (Settings >
      // Calibration), turned on by saving a wizard calibration or by hand.
      bandFilterEnabled: false,
      calibrationSource: null, // 'wizard' | 'manual' — who last set the calibration values
      calibrationSetAt: null, // ISO timestamp of that
      lastCalibratedAt: null, // ISO timestamp of the last completed Calibration Mode run — see HomeScreen.js's recalibration nudge
    },

    // BLE connection status (not packet data — see liveSession.js)
    isConnected: false,
    connectedDeviceName: null,
    bleConnecting: false,
    bleError: '',

    guideMediaSource: null, // 'phone' | null
    guideMediaName: '',
    guideMediaPath: null, // filename within Documents/ — see guideAudioPicker.js for why not a full path
    lastGuideName: '',

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
