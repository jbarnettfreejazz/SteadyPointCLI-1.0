import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;

import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './src/state/StoreContext';
import RootNavigator from './src/navigation/RootNavigator';
import { persistLoad, persistSave, persistSettings } from './src/services/persistence';
import { recoverOnLaunch } from './src/services/sessionLogic';
import { useTheme } from './src/utils/theme';

function AppInner() {
  const c = useTheme();
  const { state, actions } = useStore();
  const [ready, setReady] = useState(false);
  const savedSettingsRef = useRef(null);

  useEffect(() => {
    (async () => {
      let restored = await persistLoad();
      if (restored && !restored.settings) delete restored.settings; // never replace settings with null
      // THIRTY-SIXTH follow-up: a session that was in progress when the app
      // closed (or whose end-of-session save didn't finish) is rebuilt from
      // its checkpoint and saved, before anything is shown.
      try {
        const rec = await recoverOnLaunch({
          allSessions: restored?.allSessions || [],
          todaySessionNextId: restored?.todaySessionNextId ?? state.todaySessionNextId,
        });
        if (rec.changed) {
          restored = { ...(restored || {}), allSessions: rec.allSessions, todaySessionNextId: rec.todaySessionNextId };
          await persistSave({ ...state, ...restored, settings: restored.settings || state.settings });
        }
      } catch (e) {
        console.warn('session recovery failed', e?.message || e);
      }
      if (restored) {
        actions.restoreState(restored);
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THIRTY-FOURTH follow-up: save settings whenever they change after
  // launch — see persistSettings(). Starts after the saved state has been
  // restored (so defaults never overwrite it) and skips that first,
  // just-restored value.
  useEffect(() => {
    if (!ready) return;
    if (savedSettingsRef.current === null) {
      savedSettingsRef.current = state.settings;
      return;
    }
    if (savedSettingsRef.current === state.settings) return;
    savedSettingsRef.current = state.settings;
    persistSettings(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.settings]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg1 }}>
        <ActivityIndicator color={c.tx2} />
      </View>
    );
  }

  return <RootNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider initialMode="real">
        <AppInner />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
