import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { DEFAULT_FULL_SCALE_G } from '../utils/dsp';
import { shareCalibrationLog } from '../services/calibrationLogger';

// Formerly its own "SENSITIVITY" section; folded into CALIBRATION below
// since both control the exact same fullScaleG setting — this is just the
// manual/quick way to set it, vs. the Tremor Measurement wizard's
// automatic/more-accurate way. Matches the team's parallel progressive web
// app's Settings > Sensitivity presets, for consistency across platforms.
// One deliberate difference: keeps our own tuned 0.35g (from actual
// on-device calibration earlier this project) in place of the PWA's 0.3g,
// at the user's explicit request, rather than adopting that value verbatim.
// "sensitivity" (not "frequency") in these labels — this setting is a
// full-scale amplitude (g-force) threshold, not a Hz value. Labels run
// Max -> Min as g increases, matching the "Lower = more sensitive" copy
// above the grid (a smaller full-scale-g threshold takes less motion to
// read as intensity 100, i.e. is MORE sensitive) — a lower g value here
// is NOT the same direction as "Low-sensitivity". Originally shipped
// with the direction reversed (High-sensitivity on the least-sensitive
// 3g option); caught and corrected before wide use.
const PRESETS_G = [
  { g: DEFAULT_FULL_SCALE_G, label: 'Max-sensitivity' },
  { g: 1.0, label: 'High-sensitivity' },
  { g: 2.0, label: 'Low-sensitivity' },
  { g: 3.0, label: 'Min-sensitivity' },
];

const VOICE_OPTIONS = [
  { key: 'cello', label: 'Cello' },
  { key: 'viola', label: 'Viola' },
  { key: 'violin', label: 'Violin' },
  { key: 'custom', label: 'Custom' },
];

// Bounds for the "Custom" tonal-range sliders — wide enough to cover (and
// extend past) all three fixed instrument registers (cello 65-130Hz,
// viola 196-330Hz, violin 392-784Hz), so "Custom" can genuinely occupy any
// of those registers or a range of its own, not just the gaps between them.
const CUSTOM_RANGE_SLIDER_MIN = 50;
const CUSTOM_RANGE_SLIDER_MAX = 1000;
// Smallest gap enforced between the Lower and Upper custom-range values —
// keeps the mapped pitch range from collapsing to (near-)zero width, which
// would make every tremor frequency map to effectively the same pitch.
const CUSTOM_RANGE_MIN_GAP_HZ = 10;

export default function SettingsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const currentValue = state.settings.fullScaleG ?? DEFAULT_FULL_SCALE_G;
  const currentVoice = state.settings.sonificationVoice ?? 'cello';
  const customMinHz = state.settings.customTonalRangeMinHz ?? 200;
  const customMaxHz = state.settings.customTonalRangeMaxHz ?? 700;

  // Sub-pane expand/collapse is purely transient UI state, not data worth
  // persisting — it always starts collapsed, even when "Custom" is already
  // the active voice from a prior session.
  const [customExpanded, setCustomExpanded] = useState(false);

  // Local text-field buffers, separate from the committed store values, so
  // the user can freely type/clear digits mid-edit without each keystroke
  // being re-validated and bounced back. Kept in sync with the store
  // whenever the slider (or the other field, after a valid commit) changes
  // the committed value out from under an untouched field.
  const [minText, setMinText] = useState(String(Math.round(customMinHz)));
  const [maxText, setMaxText] = useState(String(Math.round(customMaxHz)));
  React.useEffect(() => {
    setMinText(String(Math.round(customMinHz)));
  }, [customMinHz]);
  React.useEffect(() => {
    setMaxText(String(Math.round(customMaxHz)));
  }, [customMaxHz]);

  const handleVoiceSelect = (key) => {
    if (key === 'custom' && currentVoice === 'custom') {
      // Pressing Custom again while it's already selected just toggles the
      // sub-pane, per spec — doesn't need to also re-write the setting.
      setCustomExpanded((prev) => !prev);
      return;
    }
    actions.updateSettings({ sonificationVoice: key });
    if (key === 'custom') setCustomExpanded(true);
  };

  // Shared validation for both the sliders and the numeric fields: clamps
  // to the slider bounds and enforces Lower < Upper (with a minimum gap)
  // before ever committing to the store.
  const commitMin = (rawValue) => {
    const clamped = Math.min(Math.max(rawValue, CUSTOM_RANGE_SLIDER_MIN), CUSTOM_RANGE_SLIDER_MAX);
    const safeMin = Math.min(clamped, customMaxHz - CUSTOM_RANGE_MIN_GAP_HZ);
    actions.updateSettings({ customTonalRangeMinHz: safeMin });
  };
  const commitMax = (rawValue) => {
    const clamped = Math.min(Math.max(rawValue, CUSTOM_RANGE_SLIDER_MIN), CUSTOM_RANGE_SLIDER_MAX);
    const safeMax = Math.max(clamped, customMinHz + CUSTOM_RANGE_MIN_GAP_HZ);
    actions.updateSettings({ customTonalRangeMaxHz: safeMax });
  };

  const handleMinTextChange = (text) => {
    setMinText(text);
    const parsed = Number(text);
    if (text.trim() !== '' && Number.isFinite(parsed)) commitMin(parsed);
  };
  const handleMaxTextChange = (text) => {
    setMaxText(text);
    const parsed = Number(text);
    if (text.trim() !== '' && Number.isFinite(parsed)) commitMax(parsed);
  };
  // On blur, snap the field back to whatever the committed value actually
  // ended up being — covers the case where the user left the field on an
  // invalid/out-of-range entry (or empty) without a valid keystroke after it.
  const handleMinBlur = () => setMinText(String(Math.round(customMinHz)));
  const handleMaxBlur = () => setMaxText(String(Math.round(customMaxHz)));

  const handleShareLog = async () => {
    try {
      await shareCalibrationLog();
    } catch (e) {
      Alert.alert('Nothing to share yet', e.message || 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic">
        <Text style={[styles.h1, { color: c.tx1 }]}>Settings</Text>

        <Text style={[styles.sectionLabel, { color: c.tx3 }]}>CALIBRATION</Text>
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 14 }}>
            Select pre-determined full-scale range values, or use Tremor Measurement Calibration to measure your
            own.
          </Text>

          <Text style={{ fontSize: 16, fontWeight: '600', color: c.tx1, marginBottom: 6 }}>Full-scale range</Text>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 14 }}>
            Motion (in g) that reads as intensity 100. Lower = more sensitive.
          </Text>

          <View style={styles.presetGrid}>
            {PRESETS_G.map((p) => {
              const selected = currentValue === p.g;
              return (
                <Pressable
                  key={p.g}
                  onPress={() => actions.updateSettings({ fullScaleG: p.g })}
                  style={[
                    styles.presetCell,
                    {
                      borderColor: selected ? c.info : c.bd3,
                      backgroundColor: selected ? c.bgInfo : c.bg1,
                    },
                  ]}>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '700',
                      letterSpacing: 0.4,
                      color: selected ? c.info : c.tx3,
                      textAlign: 'center',
                      marginBottom: 4,
                    }}>
                    {p.label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: selected ? c.info : c.tx1 }}>{p.g}g</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: c.bd3 }]} />

          <Text style={{ fontSize: 16, fontWeight: '600', color: c.tx1, marginBottom: 6 }}>Tremor Measurement</Text>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 14 }}>
            Measures your own "level 100" and tremor frequency range directly, by having you produce your biggest
            tremor for a few seconds — more accurate than picking a preset above.
          </Text>

          <View style={[styles.calibRow, { borderColor: c.bd3 }]}>
            <Text style={{ color: c.tx2, fontSize: 13 }}>Full scale (level 100)</Text>
            <Text style={{ color: c.tx1, fontSize: 13, fontWeight: '600' }}>{state.settings.fullScaleG.toFixed(2)} g</Text>
          </View>
          <View style={[styles.calibRow, { borderColor: c.bd3 }]}>
            <Text style={{ color: c.tx2, fontSize: 13 }}>Tremor band</Text>
            <Text style={{ color: c.tx1, fontSize: 13, fontWeight: '600' }}>
              {state.settings.tremorBandMinHz.toFixed(1)}-{state.settings.tremorBandMaxHz.toFixed(1)} Hz
            </Text>
          </View>

          <Pressable
            onPress={() => navigation.navigate('calibration', { fromWelcome: false })}
            style={[styles.calibButton, { borderColor: c.info }]}>
            <Text style={{ color: c.info, fontWeight: '600' }}>
              {state.settings.hasCalibrated ? 'Recalibrate' : 'Open Calibration'}
            </Text>
          </Pressable>

          <Pressable onPress={handleShareLog} style={[styles.calibButton, { borderColor: c.bd2, marginTop: 8 }]}>
            <Text style={{ color: c.tx2, fontWeight: '600' }}>Share Calibration Log</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: c.tx3, marginTop: 20 }]}>SONIFICATION</Text>
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.tx1, marginBottom: 6 }}>Tonal Range</Text>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 14 }}>
            Your movement is represented as a single voice, blending all three axes together.
            Choose the tonal range for the sonification.
          </Text>

          <View style={styles.pillRow}>
            {VOICE_OPTIONS.map((v) => {
              const selected = currentVoice === v.key;
              return (
                <Pressable
                  key={v.key}
                  onPress={() => handleVoiceSelect(v.key)}
                  style={[
                    styles.pill,
                    {
                      borderColor: selected ? c.info : c.bd3,
                      backgroundColor: selected ? c.bgInfo : c.bg1,
                    },
                  ]}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: selected ? c.info : c.tx1 }}>{v.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {currentVoice === 'custom' && customExpanded && (
            <View style={[styles.customPane, { borderColor: c.bd3 }]}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.tx1, marginBottom: 14 }}>Custom Tonal Range</Text>

              <View style={styles.sliderLabelRow}>
                <Text style={{ fontSize: 13, color: c.tx2 }}>Lower</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.tx1 }}>{Math.round(customMinHz)}hz</Text>
              </View>
              <Slider
                minimumValue={CUSTOM_RANGE_SLIDER_MIN}
                maximumValue={CUSTOM_RANGE_SLIDER_MAX}
                step={1}
                value={customMinHz}
                onValueChange={commitMin}
                minimumTrackTintColor={c.info}
                maximumTrackTintColor={c.bd3}
                thumbTintColor={c.info}
                style={styles.slider}
              />

              <View style={[styles.sliderLabelRow, { marginTop: 10 }]}>
                <Text style={{ fontSize: 13, color: c.tx2 }}>Upper</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.tx1 }}>{Math.round(customMaxHz)}hz</Text>
              </View>
              <Slider
                minimumValue={CUSTOM_RANGE_SLIDER_MIN}
                maximumValue={CUSTOM_RANGE_SLIDER_MAX}
                step={1}
                value={customMaxHz}
                onValueChange={commitMax}
                minimumTrackTintColor={c.info}
                maximumTrackTintColor={c.bd3}
                thumbTintColor={c.info}
                style={styles.slider}
              />

              <View style={[styles.divider, { backgroundColor: c.bd3, marginVertical: 16 }]} />

              <View style={styles.numericFieldRow}>
                <View style={styles.numericField}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: c.tx3, marginBottom: 6 }}>Lower</Text>
                  <TextInput
                    value={minText}
                    onChangeText={handleMinTextChange}
                    onBlur={handleMinBlur}
                    keyboardType="number-pad"
                    style={[styles.numericInput, { borderColor: c.bd3, color: c.tx1, backgroundColor: c.bg1 }]}
                  />
                </View>
                <View style={styles.numericField}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: c.tx3, marginBottom: 6 }}>Upper</Text>
                  <TextInput
                    value={maxText}
                    onChangeText={handleMaxTextChange}
                    onBlur={handleMaxBlur}
                    keyboardType="number-pad"
                    style={[styles.numericInput, { borderColor: c.bd3, color: c.tx1, backgroundColor: c.bg1 }]}
                  />
                </View>
              </View>
            </View>
          )}
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
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  presetCell: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1.5,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  divider: { height: 1, marginVertical: 14 },
  calibRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  calibButton: { borderWidth: 1.5, borderRadius: radii.lg, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  customPane: { borderTopWidth: 1, marginTop: 16, paddingTop: 16 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  slider: { width: '100%', height: 36 },
  numericFieldRow: { flexDirection: 'row', gap: 12 },
  numericField: { flex: 1 },
  numericInput: {
    borderWidth: 1.5,
    borderRadius: radii.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
  },
});
