import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';

// THIRTY-FIFTH follow-up: Settings > Sonification sub-page — the former
// SONIFICATION section of the main Settings page, moved here unchanged.

export const VOICE_OPTIONS = [
  { key: 'cello', label: 'Cello' },
  { key: 'viola', label: 'Viola' },
  { key: 'violin', label: 'Violin' },
  { key: 'custom', label: 'Custom' },
];

// Bounds for the "Custom" tonal-range sliders — originally chosen to cover
// (and extend past) the three fixed one-octave instrument registers
// (cello 65-130Hz, viola 196-330Hz, violin 392-784Hz). Since the
// TWENTY-SECOND follow-up the multi-sampled strings span far wider ranges
// (cello 65-1000Hz, viola 131-1175Hz, violin 196-1568Hz — see audio.js
// VOICE_CONFIG); these slider bounds are unchanged.
const CUSTOM_RANGE_SLIDER_MIN = 50;
const CUSTOM_RANGE_SLIDER_MAX = 1000;
// Smallest gap enforced between the Lower and Upper custom-range values —
// keeps the mapped pitch range from collapsing to (near-)zero width, which
// would make every tremor frequency map to effectively the same pitch.
const CUSTOM_RANGE_MIN_GAP_HZ = 10;

export default function SonificationSettingsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  // TWENTY-SECOND follow-up: the 'cello_a'/'cello_b' test voices were
  // removed (Cello A became Cello) — treat any stale value as Cello so a
  // pill is always shown selected. persistence.js also migrates it.
  const savedVoice = state.settings.sonificationVoice ?? 'cello';
  const currentVoice = VOICE_OPTIONS.some((v) => v.key === savedVoice) ? savedVoice : 'cello';
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic">
        <Pressable onPress={() => navigation.goBack()} style={styles.backRow} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: c.tx2, fontSize: 18, marginRight: 6 }}>←</Text>
          <Text style={{ color: c.tx2, fontSize: 14 }}>Settings</Text>
        </Pressable>
        <Text style={[styles.h1, { color: c.tx1 }]}>Sonification</Text>

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
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: '500', marginBottom: 16 },
  card: { borderRadius: radii.lg, borderWidth: 1, padding: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1.5, borderRadius: radii.lg, paddingHorizontal: 16, paddingVertical: 10 },
  divider: { height: 1, marginVertical: 14 },
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
