import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { DEFAULT_FULL_SCALE_G } from '../utils/dsp';

// Matches the team's parallel progressive web app's Settings > Sensitivity
// section, for consistency across platforms — see that app's screenshot.
// One deliberate difference: keeps our own tuned 0.35g (from actual
// on-device calibration earlier this project) in place of the PWA's 0.3g,
// at the user's explicit request, rather than adopting that value verbatim.
const PRESETS_G = [DEFAULT_FULL_SCALE_G, 1.0, 2.0, 3.0];

export default function SettingsScreen() {
  const c = useTheme();
  const { state, actions } = useStore();
  const currentValue = state.settings.fullScaleG ?? DEFAULT_FULL_SCALE_G;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.h1, { color: c.tx1 }]}>Settings</Text>

        <Text style={[styles.sectionLabel, { color: c.tx3 }]}>SENSITIVITY</Text>
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.tx1, marginBottom: 6 }}>Full-scale range</Text>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 14 }}>
            Motion (in g) that reads as intensity 100. Lower = more sensitive.
          </Text>

          <View style={styles.pillRow}>
            {PRESETS_G.map((g) => {
              const selected = currentValue === g;
              return (
                <Pressable
                  key={g}
                  onPress={() => actions.updateSettings({ fullScaleG: g })}
                  style={[
                    styles.pill,
                    {
                      borderColor: selected ? c.info : c.bd3,
                      backgroundColor: selected ? c.bgInfo : c.bg1,
                    },
                  ]}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: selected ? c.info : c.tx1 }}>{g}g</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: c.bd3 }]} />

          <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 18 }}>
            Scores recorded at different sensitivities are not directly comparable. Each session
            stores the value it was recorded at.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '500', marginBottom: 20 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  card: { borderRadius: radii.lg, borderWidth: 1, padding: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1.5, borderRadius: radii.lg, paddingHorizontal: 16, paddingVertical: 10 },
  divider: { height: 1, marginVertical: 14 },
});
