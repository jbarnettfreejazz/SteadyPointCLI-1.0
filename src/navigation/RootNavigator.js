import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useStore } from '../state/StoreContext';
import MainTabs from './MainTabs';
import SetupScreen from '../screens/SetupScreen';
import RecordingScreen from '../screens/RecordingScreen';
import SummaryScreen from '../screens/SummaryScreen';
import SessionDetailScreen from '../screens/SessionDetailScreen';
import SessionHistoryScreen from '../screens/SessionHistoryScreen';
import ArticleScreen from '../screens/ArticleScreen';
import CalibrationWelcomeScreen from '../screens/CalibrationWelcomeScreen';
import CalibrationScreen from '../screens/CalibrationScreen';
import CalibrationResultsScreen from '../screens/CalibrationResultsScreen';

const Stack = createNativeStackNavigator();

// MainTabs (Home/Analytics/Learn/Settings) is the only entry that shows the
// bottom nav bar — it's nested one level in, as its own tab navigator.
// Every other screen here is a plain full-screen stack push, which is what
// naturally hides the tab bar for them — mirroring the original's `noNav`
// list (setup, active/recording, summary, article, session-history,
// session-detail) without needing to replicate that logic explicitly.
export default function RootNavigator() {
  const { state } = useStore();
  // Mandatory first-launch calibration (see Calibration_Mode_Design.pdf,
  // Section 2): a brand-new user is routed straight into the Welcome
  // screen instead of mainTabs, with no way to skip it. Safe to read
  // state.settings.hasCalibrated here — App.js already waits for
  // persisted settings to fully load before RootNavigator ever renders,
  // so this is never evaluated against a not-yet-loaded default.
  const initialRouteName = state.settings.hasCalibrated ? 'mainTabs' : 'calibrationWelcome';

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRouteName}>
        <Stack.Screen name="mainTabs" component={MainTabs} />
        <Stack.Screen name="setup" component={SetupScreen} />
        <Stack.Screen name="recording" component={RecordingScreen} />
        <Stack.Screen name="summary" component={SummaryScreen} />
        <Stack.Screen name="sessionDetail" component={SessionDetailScreen} />
        <Stack.Screen name="sessionHistory" component={SessionHistoryScreen} />
        <Stack.Screen name="article" component={ArticleScreen} />
        <Stack.Screen name="calibrationWelcome" component={CalibrationWelcomeScreen} />
        <Stack.Screen name="calibration" component={CalibrationScreen} />
        <Stack.Screen name="calibrationResults" component={CalibrationResultsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
