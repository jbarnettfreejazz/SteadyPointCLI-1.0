import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from '../utils/theme';
import { HomeIcon, ActivityIcon, BulbIcon, SettingsIcon } from '../components/TabIcons';

import HomeScreen from '../screens/HomeScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import LearnScreen from '../screens/LearnScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

// Mirrors renderNav()'s four items — Home, Analytics ('history'), Learn
// ('insights'), Settings — the only screens the original's nav bar ever
// shows on. Every other screen (setup, active/recording, summary, article,
// session-history, session-detail) is in the original's `noNav` list, which
// here just means those screens live outside this tab navigator entirely
// (as plain stack pushes in RootNavigator.js) — pushing one of them
// naturally hides this tab bar, no extra logic needed to replicate noNav.
export default function MainTabs() {
  const c = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.info,
        tabBarInactiveTintColor: c.tx3,
        tabBarStyle: { backgroundColor: c.bg1, borderTopColor: c.bd3 },
        tabBarLabelStyle: { fontSize: 11 },
        tabBarIcon: ({ color, size }) => {
          const iconSize = size ? Math.min(size, 22) : 22;
          if (route.name === 'home') return <HomeIcon color={color} size={iconSize} />;
          if (route.name === 'analytics') return <ActivityIcon color={color} size={iconSize} />;
          if (route.name === 'learn') return <BulbIcon color={color} size={iconSize} />;
          if (route.name === 'settings') return <SettingsIcon color={color} size={iconSize} />;
          return null;
        },
      })}>
      <Tab.Screen name="home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="analytics" component={AnalyticsScreen} options={{ tabBarLabel: 'Analytics' }} />
      <Tab.Screen name="learn" component={LearnScreen} options={{ tabBarLabel: 'Learn' }} />
      <Tab.Screen name="settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}
