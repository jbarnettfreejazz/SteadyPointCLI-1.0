import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import DeviceInfo from 'react-native-device-info';
import { VOICE_OPTIONS } from './SonificationSettingsScreen';
import { formatValue } from '../utils/calibrationLimits';

// THIRTY-FIFTH follow-up: the main Settings page is now a short menu —
// Calibration and Sonification each open their own sub-page
// (CalibrationSettingsScreen / SonificationSettingsScreen) — plus the app
// version at the bottom. The old full-scale preset grid is gone: the four
// calibration values are edited directly on the Calibration sub-page.

// "Version 1.2 (34)" — falls back gracefully if the native module isn't
// available (e.g. a build made before `pod install` picked it up).
function appVersionLabel() {
  try {
    const version = DeviceInfo.getVersion();
    const build = DeviceInfo.getBuildNumber();
    if (!version) return '';
    return build && build !== version ? `Version ${version} (${build})` : `Version ${version}`;
  } catch (e) {
    return '';
  }
}

function MenuRow({ title, subtitle, onPress, c, first }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, !first && { borderTopWidth: 1, borderColor: c.bd3 }]}
      accessibilityRole="button"
      accessibilityLabel={title}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.tx1 }}>{title}</Text>
        {!!subtitle && <Text style={{ fontSize: 12, color: c.tx3, marginTop: 3 }}>{subtitle}</Text>}
      </View>
      <Text style={{ fontSize: 20, color: c.tx3 }}>›</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state } = useStore();
  const s = state.settings;

  const calibrationSummary = `${formatValue('fullScaleG', s.fullScaleG)} g full scale · band filtering ${
    s.bandFilterEnabled ? 'on' : 'off'
  }`;
  const voice = VOICE_OPTIONS.find((v) => v.key === s.sonificationVoice) || VOICE_OPTIONS[0];
  const sonificationSummary =
    voice.key === 'custom'
      ? `Custom · ${Math.round(s.customTonalRangeMinHz ?? 200)}–${Math.round(s.customTonalRangeMaxHz ?? 700)} Hz`
      : voice.label;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll} contentInsetAdjustmentBehavior="automatic">
        <Text style={[styles.h1, { color: c.tx1 }]}>Settings</Text>

        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <MenuRow
            first
            title="Calibration"
            subtitle={calibrationSummary}
            onPress={() => navigation.navigate('calibrationSettings')}
            c={c}
          />
          <MenuRow
            title="Sonification"
            subtitle={sonificationSummary}
            onPress={() => navigation.navigate('sonificationSettings')}
            c={c}
          />
        </View>

        {/* THIRTY-FOURTH follow-up: app version and build number, read from
            the iOS bundle (CFBundleShortVersionString / CFBundleVersion — the
            Version and Build set in Xcode, i.e. what TestFlight shows). */}
        <Text style={{ fontSize: 12, color: c.tx3, textAlign: 'center', marginTop: 24, marginBottom: 24 }}>
          SteadyPoint {appVersionLabel()}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '500', marginBottom: 20 },
  card: { borderRadius: radii.lg, borderWidth: 1, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
});
