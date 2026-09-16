import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';

// Calibration Mode Screen 3 — Results & Save. See
// Calibration_Mode_Design.pdf, Section 3 (Screen 3) and Section 4.
//
// Note on scope: the design doc describes saving as also retroactively
// recalculating past sessions' intensity scores against the new
// FULL_SCALE_G. That's a separate, larger piece of work (needs raw
// per-session data this app doesn't yet persist) — deliberately not
// built in this pass. This screen only writes the new settings; it does
// not yet describe or perform historical rescoring, to avoid promising
// behavior that isn't implemented.
export default function CalibrationResultsScreen({ route }) {
  const c = useTheme();
  const navigation = useNavigation();
  const { actions } = useStore();
  const { fullScaleG, tremorBandMinHz, tremorBandMaxHz, measuredBand, fromWelcome } = route.params;

  const handleSave = () => {
    actions.updateSettings({
      fullScaleG,
      tremorBandMinHz,
      tremorBandMaxHz,
      hasCalibrated: true,
    });
    navigation.reset({ index: 0, routes: [{ name: 'mainTabs' }] });
  };

  const handleRecalibrate = () => {
    navigation.replace('calibration', { fromWelcome });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.eyebrow, { color: c.tx3 }]}>CALIBRATION MODE · RESULTS</Text>
        <Text style={[styles.title, { color: c.tx1 }]}>Your new settings</Text>

        <View style={[styles.row, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <View>
            <Text style={{ color: c.tx1, fontSize: 14, fontWeight: '600' }}>Full scale (level 100)</Text>
            <Text style={{ color: c.tx3, fontSize: 11 }}>FULL_SCALE_G</Text>
          </View>
          <Text style={{ color: c.info, fontSize: 16, fontWeight: '700' }}>{fullScaleG.toFixed(2)} g</Text>
        </View>

        <View style={[styles.row, { backgroundColor: c.bg2, borderColor: c.bd3, marginTop: 10 }]}>
          <View>
            <Text style={{ color: c.tx1, fontSize: 14, fontWeight: '600' }}>Tremor band - min</Text>
            <Text style={{ color: c.tx3, fontSize: 11 }}>TREMOR_BAND_MIN_HZ</Text>
          </View>
          <Text style={{ color: c.info, fontSize: 16, fontWeight: '700' }}>{tremorBandMinHz.toFixed(1)} Hz</Text>
        </View>
        <View style={[styles.row, { backgroundColor: c.bg2, borderColor: c.bd3, marginTop: 10 }]}>
          <View>
            <Text style={{ color: c.tx1, fontSize: 14, fontWeight: '600' }}>Tremor band - max</Text>
            <Text style={{ color: c.tx3, fontSize: 11 }}>TREMOR_BAND_MAX_HZ</Text>
          </View>
          <Text style={{ color: c.info, fontSize: 16, fontWeight: '700' }}>{tremorBandMaxHz.toFixed(1)} Hz</Text>
        </View>

        {!measuredBand && (
          <View style={[styles.warningCard, { backgroundColor: c.bgWarning, borderColor: c.bd3 }]}>
            <Text style={{ color: c.tx1, fontSize: 12, lineHeight: 18 }}>
              We couldn't clearly measure a sustained tremor frequency from that recording, so the frequency band
              above was kept at your existing setting. Your full-scale amplitude was still captured normally — if
              you'd like a frequency reading too, try recalibrating with a longer, steadier hold.
            </Text>
          </View>
        )}

        <Text style={{ color: c.tx3, fontSize: 12, textAlign: 'center', marginTop: 18, lineHeight: 18 }}>
          Saving will update your settings. Calibration isn't tied to a specific session — you can recalibrate
          again at any time.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={handleSave} style={[styles.button, { backgroundColor: c.info }]}>
          <Text style={styles.buttonText}>Save to Settings</Text>
        </Pressable>
        <Pressable onPress={handleRecalibrate} style={[styles.secondaryButton, { borderColor: c.bd2 }]}>
          <Text style={{ color: c.tx1, fontWeight: '600' }}>Recalibrate</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between' },
  scroll: { padding: 20 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
  },
  warningCard: { borderRadius: radii.md, borderWidth: 1, padding: 14, marginTop: 16 },
  footer: { padding: 20 },
  button: { borderRadius: radii.lg, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { borderRadius: radii.lg, borderWidth: 1, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
});
