import * as T from './actionTypes';
import { buildInitialState } from './initialState';

export function appReducer(state, action) {
  switch (action.type) {
    case T.NAVIGATE:
      return { ...state, screen: action.screen };

    case T.SET_APP_MODE:
      return { ...state, appMode: action.mode };

    case T.RESET_TO_MODE:
      return buildInitialState(action.mode);

    case T.UPDATE_CONFIG:
      return { ...state, config: { ...state.config, ...action.patch } };

    case T.SET_SETUP_MODE:
      return { ...state, setupMode: action.mode };

    case T.SET_EDITING_PINNED_ID:
      return { ...state, editingPinnedId: action.id };

    case T.SET_RESULTS:
      return { ...state, results: action.results };

    case T.SET_SCORE_ANIM:
      return { ...state, scoreAnim: action.value };

    case T.SET_HIST_FILTER:
      return { ...state, histFilter: action.filter };

    case T.SET_LEARN_FILTER:
      return { ...state, learnFilter: action.filter };

    case T.SET_SELECTED_ARTICLE:
      return { ...state, selectedArticle: action.article };

    case T.SET_SELECTED_SESSION:
      return { ...state, selectedSession: action.session };

    case T.UPDATE_SETTINGS:
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case T.BLE_CONNECTING:
      return { ...state, bleConnecting: true, bleError: '' };

    case T.BLE_CONNECTED:
      return { ...state, isConnected: true, bleConnecting: false, bleError: '', connectedDeviceName: action.deviceName || null };

    case T.BLE_DISCONNECTED:
      return { ...state, isConnected: false, bleConnecting: false, connectedDeviceName: null };

    case T.BLE_ERROR:
      return { ...state, bleError: action.message, bleConnecting: false, isConnected: false, connectedDeviceName: null };

    case T.SET_GUIDE_MEDIA:
      return {
        ...state,
        guideMediaSource: action.source,
        guideMediaName: action.name ?? state.guideMediaName,
        guideMediaPath: action.path ?? state.guideMediaPath,
      };

    case T.CLEAR_GUIDE_MEDIA:
      return { ...state, guideMediaSource: null, guideMediaName: '', guideMediaPath: null };

    case T.ADD_PINNED_SESSION: {
      const session = { ...action.session, id: state.pinnedNextId };
      return {
        ...state,
        // No cap (was .slice(0, 3)) — see savePinnedSession() in sessionLogic.js.
        pinnedSessions: [...state.pinnedSessions, session],
        pinnedNextId: state.pinnedNextId + 1,
      };
    }

    case T.UPDATE_PINNED_SESSION:
      return {
        ...state,
        pinnedSessions: state.pinnedSessions.map((s) =>
          s.id === action.id ? { ...s, ...action.patch } : s,
        ),
      };

    case T.REMOVE_PINNED_SESSION:
      return {
        ...state,
        pinnedSessions: state.pinnedSessions.filter((s) => s.id !== action.id),
      };

    case T.ADD_SESSION: {
      const session = { ...action.session, id: state.todaySessionNextId };
      return {
        ...state,
        allSessions: [session, ...state.allSessions],
        todaySessionNextId: state.todaySessionNextId + 1,
      };
    }

    case T.UPDATE_SESSION:
      return {
        ...state,
        allSessions: state.allSessions.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      };

    case T.ADD_CUSTOM_TEMPLATE:
      return {
        ...state,
        customTemplates: [...state.customTemplates, { ...action.template, id: state.nextCustomId }],
        nextCustomId: state.nextCustomId + 1,
      };

    case T.UPDATE_NEW_CUSTOM_TYPE:
      return { ...state, newCustomType: { ...state.newCustomType, ...action.patch } };

    case T.RESET_NEW_CUSTOM_TYPE:
      return {
        ...state,
        newCustomType: {
          name: '',
          activityType: 'meditative',
          feedbackType: 'both',
          guideSource: null,
          duration: 10,
        },
      };

    case T.RESTORE_STATE:
      return { ...state, ...action.state };

    default:
      return state;
  }
}
