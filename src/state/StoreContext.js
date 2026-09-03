import React, { createContext, useContext, useMemo, useReducer } from 'react';
import { appReducer } from './reducer';
import { buildInitialState } from './initialState';
import * as T from './actionTypes';

const StoreContext = createContext(null);

export function StoreProvider({ children, initialMode = 'real' }) {
  const [state, dispatch] = useReducer(appReducer, buildInitialState(initialMode));

  const actions = useMemo(
    () => ({
      navigate: (screen) => dispatch({ type: T.NAVIGATE, screen }),
      setAppMode: (mode) => dispatch({ type: T.SET_APP_MODE, mode }),
      resetToMode: (mode) => dispatch({ type: T.RESET_TO_MODE, mode }),
      updateConfig: (patch) => dispatch({ type: T.UPDATE_CONFIG, patch }),
      setSetupMode: (mode) => dispatch({ type: T.SET_SETUP_MODE, mode }),
      setEditingPinnedId: (id) => dispatch({ type: T.SET_EDITING_PINNED_ID, id }),
      setResults: (results) => dispatch({ type: T.SET_RESULTS, results }),
      setScoreAnim: (value) => dispatch({ type: T.SET_SCORE_ANIM, value }),
      setHistFilter: (filter) => dispatch({ type: T.SET_HIST_FILTER, filter }),
      setLearnFilter: (filter) => dispatch({ type: T.SET_LEARN_FILTER, filter }),
      setSelectedArticle: (article) => dispatch({ type: T.SET_SELECTED_ARTICLE, article }),
      setSelectedSession: (session) => dispatch({ type: T.SET_SELECTED_SESSION, session }),
      updateSettings: (patch) => dispatch({ type: T.UPDATE_SETTINGS, patch }),

      bleConnecting: () => dispatch({ type: T.BLE_CONNECTING }),
      bleConnected: (deviceName) => dispatch({ type: T.BLE_CONNECTED, deviceName }),
      bleDisconnected: () => dispatch({ type: T.BLE_DISCONNECTED }),
      bleErrorSet: (message) => dispatch({ type: T.BLE_ERROR, message }),

      setGuideMedia: (source, name, path) => dispatch({ type: T.SET_GUIDE_MEDIA, source, name, path }),
      clearGuideMedia: () => dispatch({ type: T.CLEAR_GUIDE_MEDIA }),

      addPinnedSession: (session) => dispatch({ type: T.ADD_PINNED_SESSION, session }),
      updatePinnedSession: (id, patch) => dispatch({ type: T.UPDATE_PINNED_SESSION, id, patch }),
      removePinnedSession: (id) => dispatch({ type: T.REMOVE_PINNED_SESSION, id }),

      recordCompletedSession: (score, durationMins, activityType) =>
        dispatch({ type: T.RECORD_COMPLETED_SESSION, score, durationMins, activityType }),
      addSession: (session) => dispatch({ type: T.ADD_SESSION, session }),
      updateSession: (id, patch) => dispatch({ type: T.UPDATE_SESSION, id, patch }),

      addCustomTemplate: (template) => dispatch({ type: T.ADD_CUSTOM_TEMPLATE, template }),
      updateNewCustomType: (patch) => dispatch({ type: T.UPDATE_NEW_CUSTOM_TYPE, patch }),
      resetNewCustomType: () => dispatch({ type: T.RESET_NEW_CUSTOM_TYPE }),

      restoreState: (restored) => dispatch({ type: T.RESTORE_STATE, state: restored }),
    }),
    [dispatch],
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [state, actions]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
}
