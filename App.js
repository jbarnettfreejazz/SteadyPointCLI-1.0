import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;

import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './src/state/StoreContext';
import RootNavigator from './src/navigation/RootNavigator';
import { persistLoad } from './src/services/persistence';
import { useTheme } from './src/utils/theme';

function AppInner() {
  const c = useTheme();
  const { actions } = useStore();
  const [ready, setReady] = useState(false);

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
