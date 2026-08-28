import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MainTabs from './MainTabs';
import SetupScreen from '../screens/SetupScreen';
import RecordingScreen from '../screens/RecordingScreen';
import SummaryScreen from '../screens/SummaryScreen';
import SessionDetailScreen from '../screens/SessionDetailScreen';
import SessionHistoryScreen from '../screens/SessionHistoryScreen';
import ArticleScreen from '../screens/ArticleScreen';

const Stack = createNativeStackNavigator();

// MainTabs (Home/Analytics/Learn/Settings) is the only entry that shows the
// bottom nav bar — it's nested one level in, as its own tab navigator.
// Every other screen here is a plain full-screen stack push, which is what
// naturally hides the tab bar for them — mirroring the original's `noNav`
// list (setup, active/recording, summary, article, session-history,
// session-detail) without needing to replicate that logic explicitly.
export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="mainTabs">
        <Stack.Screen name="mainTabs" component={MainTabs} />
        <Stack.Screen name="setup" component={SetupScreen} />
        <Stack.Screen name="recording" component={RecordingScreen} />
        <Stack.Screen name="summary" component={SummaryScreen} />
        <Stack.Screen name="sessionDetail" component={SessionDetailScreen} />
        <Stack.Screen name="sessionHistory" component={SessionHistoryScreen} />
        <Stack.Screen name="article" component={ArticleScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
