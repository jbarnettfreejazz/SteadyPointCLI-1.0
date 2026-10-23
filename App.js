import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;

import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './src/state/StoreContext';
import RootNavigator from './src/navigation/RootNavigator';
import { persistLoad, persistSettings } from './src/services/persistence';
import { useTheme } from './src/utils/theme';

function AppInner() {
  const c = useTheme();
  const { state, actions } = useStore();
  const [ready, setReady] = useState(false);
  const savedSettingsRef = useRef(null);

  useEffect(() => {
    (async () => {
      const restored = await persistLoad();
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
