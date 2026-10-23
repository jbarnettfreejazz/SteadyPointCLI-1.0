import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, TextInput, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { shareCalibrationLog } from '../services/calibrationLogger';
import { dateFromIso } from '../utils/analyticsStats';
import {
  CALIBRATION_FIELDS,
  CALIBRATION_DEFAULTS,
  formatValue,
  rangeHint,
  stepEntry,
  validateCalibration,
  entriesFromSettings,
  describeChanges,
} from '../utils/calibrationLimits';

// THIRTY-FIFTH follow-up: Settings > Calibration sub-page (was the "Tremor
// Measurement" part of the main Settings page). Shows the four calibration
// values and band filtering read-only; "Edit values" turns them into number
// fields with − / + buttons, checked by utils/calibrationLimits.js, and
// Save / Cancel. Saving asks for confirmation and explains the effect on
// past sessions. Leaving with unsaved edits asks whether to discard them.
//
// Manual edits record calibrationSource 'manual' + calibrationSetAt; they do
// NOT set lastCalibratedAt, which only the calibration wizard sets (it drives
// Home's 90-day recalibration reminder).

function lastSetNote(settings) {
  const source = settings.calibrationSource || (settings.lastCalibratedAt ? 'wizard' : null);
  const when = dateFromIso(settings.calibrationSetAt || (source === 'wizard' ? settings.lastCalibratedAt : null));
  if (source === 'manual') return `Last set manually${when ? ` on ${when}` : ''}.`;
  if (source === 'wizard') return `Last set by the calibration wizard${when ? ` on ${when}` : ''}.`;
  return 'Using the default values.';
}

export default function CalibrationSettingsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const settings = state.settings;

  const [editing, setEditing] = useState(false);
  const [entries, setEntries] = useState(() => entriesFromSettings(settings));
  const [filterOn, setFilterOn] = useState(!!settings.bandFilterEnabled);

  const check = validateCalibration(entries);
  const changes = check.valid ? describeChanges(settings, check.values, filterOn) : { scale: false, band: false };
  const dirty =
    editing &&
    (CALIBRATION_FIELDS.some((f) => entries[f.key] !== entriesFromSettings(settings)[f.key]) ||
      filterOn !== !!settings.bandFilterEnabled);

  // Ask before leaving with unsaved edits (back button or swipe).
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const unsubscribe = navigation.addListener?.('beforeRemove', (e) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'Your calibration edits haven’t been saved.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsubscribe;
  }, [navigation]);

  const startEditing = () => {
    setEntries(entriesFromSettings(settings));
    setFilterOn(!!settings.bandFilterEnabled);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEntries(entriesFromSettings(settings));
    setFilterOn(!!settings.bandFilterEnabled);
    setEditing(false);
  };

  const restoreDefaults = () => {
    const out = {};
    for (const f of CALIBRATION_FIELDS) out[f.key] = formatValue(f.key, CALIBRATION_DEFAULTS[f.key]);
    setEntries(out);
    setFilterOn(CALIBRATION_DEFAULTS.bandFilterEnabled);
  };

  const commitSave = () => {
    actions.updateSettings({
      ...check.values,
      bandFilterEnabled: filterOn,
      calibrationSource: 'manual',
      calibrationSetAt: new Date().toISOString(),
    });
    setEditing(false);
  };

  const handleSave = () => {
    if (!check.valid || !dirty) return;
    const lines = [];
    if (changes.scale) lines.push('Past sessions will be shown on the new full scale and noise floor.');
    if (changes.band) {
      lines.push(
        'Band changes apply to new sessions only. Past sessions keep the band they were measured with, and Analytics marks where it changed.',
      );
    }
    if (lines.length === 0) {
      // Only formatting changed (e.g. "1" -> "1.00"): nothing to confirm.
      setEditing(false);
      return;
    }
    Alert.alert('Save calibration?', lines.join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: commitSave },
    ]);
  };

  const handleShareLog = async () => {
    try {
      await shareCalibrationLog();
    } catch (e) {
      Alert.alert('Nothing to share yet', e.message || 'Please try again.');
    }
  };

  const setEntry = (key, text) => setEntries((prev) => ({ ...prev, [key]: text }));

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
        <Text style={[styles.h1, { color: c.tx1 }]}>Calibration</Text>
        <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 16 }}>
          These values control how SteadyPoint turns your movement into an intensity reading.
        </Text>

        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          {CALIBRATION_FIELDS.map((f, i) => (
            <View key={f.key} style={[styles.fieldBlock, i > 0 && { borderTopWidth: 1, borderColor: c.bd3 }]}>
              <View style={styles.fieldHeader}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1, flex: 1 }}>{f.label}</Text>
                {!editing && (
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1 }}>
                    {formatValue(f.key, settings[f.key] ?? CALIBRATION_DEFAULTS[f.key])} {f.unit}
                  </Text>
                )}
              </View>
              <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>{f.help}</Text>
              {editing && (
                <>
                  <View style={styles.editRow}>
                    <Pressable
                      onPress={() => setEntry(f.key, stepEntry(f.key, entries[f.key], -1))}
                      style={[styles.stepButton, { borderColor: c.bd3, backgroundColor: c.bg1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease ${f.label}`}>
                      <Text style={{ fontSize: 18, color: c.tx1 }}>−</Text>
                    </Pressable>
                    <TextInput
                      value={entries[f.key]}
                      onChangeText={(t) => setEntry(f.key, t)}
                      keyboardType="decimal-pad"
                      accessibilityLabel={f.label}
                      style={[
                        styles.input,
                        {
                          borderColor: check.errors[f.key] ? c.danger : c.bd3,
                          color: c.tx1,
                          backgroundColor: c.bg1,
                        },
                      ]}
                    />
                    <Text style={{ fontSize: 14, color: c.tx2, width: 26 }}>{f.unit}</Text>
                    <Pressable
                      onPress={() => setEntry(f.key, stepEntry(f.key, entries[f.key], 1))}
                      style={[styles.stepButton, { borderColor: c.bd3, backgroundColor: c.bg1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${f.label}`}>
                      <Text style={{ fontSize: 18, color: c.tx1 }}>+</Text>
                    </Pressable>
                  </View>
                  {check.errors[f.key] ? (
                    <Text style={{ fontSize: 12, color: c.danger, marginTop: 6 }}>{check.errors[f.key]}</Text>
                  ) : check.warnings[f.key] ? (
                    <Text style={{ fontSize: 12, color: c.warning, marginTop: 6 }}>{check.warnings[f.key]}</Text>
                  ) : (
                    <Text style={{ fontSize: 12, color: c.tx3, marginTop: 6 }}>Allowed: {rangeHint(f.key)}</Text>
                  )}
                </>
              )}
            </View>
          ))}

          <View style={[styles.fieldBlock, { borderTopWidth: 1, borderColor: c.bd3 }]}>
            <View style={styles.fieldHeader}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1, flex: 1 }}>Band filtering</Text>
              {editing ? (
                <Switch
                  value={filterOn}
                  onValueChange={setFilterOn}
                  trackColor={{ true: c.info }}
                  accessibilityLabel="Band filtering"
                />
              ) : (
                <Text style={{ fontSize: 14, fontWeight: '600', color: settings.bandFilterEnabled ? c.success : c.tx3 }}>
                  {settings.bandFilterEnabled ? 'On' : 'Off'}
                </Text>
              )}
            </View>
            <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>
              {(editing ? filterOn : settings.bandFilterEnabled)
                ? 'Intensity counts only motion within the tremor band, filtering out slower, voluntary movement.'
                : 'Intensity counts motion at all frequencies. The tremor band isn’t applied.'}
            </Text>
          </View>

          {editing ? (
            <>
              <View style={styles.buttonRow}>
                <Pressable
                  onPress={cancelEditing}
                  style={[styles.button, { borderColor: c.bd2, backgroundColor: c.bg1 }]}
                  accessibilityRole="button">
                  <Text style={{ color: c.tx2, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={!check.valid || !dirty}
                  style={[
                    styles.button,
                    { borderColor: c.info, backgroundColor: check.valid && dirty ? c.info : c.bg1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !check.valid || !dirty }}>
                  <Text style={{ color: check.valid && dirty ? '#ffffff' : c.tx3, fontWeight: '600' }}>Save</Text>
                </Pressable>
              </View>
              <Pressable onPress={restoreDefaults} style={{ alignSelf: 'center', marginTop: 12 }} hitSlop={8}>
                <Text style={{ color: c.info, fontSize: 13 }}>Restore defaults</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={startEditing}
                style={[styles.button, styles.fullButton, { borderColor: c.info }]}
                accessibilityRole="button">
                <Text style={{ color: c.info, fontWeight: '600' }}>Edit values</Text>
              </Pressable>
              <Text style={{ fontSize: 12, color: c.tx3, textAlign: 'center', marginTop: 10 }}>{lastSetNote(settings)}</Text>
            </>
          )}
        </View>

        {!editing && (
          <>
            <Text style={[styles.sectionLabel, { color: c.tx3 }]}>CALIBRATION WIZARD</Text>
            <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
              <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19 }}>
                Measures your own full scale range and tremor band with your device, by having you produce your biggest
                tremor for a few seconds. Saving its results turns band filtering on.
              </Text>
              <Pressable
                onPress={() => navigation.navigate('calibration', { fromWelcome: false })}
                style={[styles.button, styles.fullButton, { borderColor: c.info }]}
                accessibilityRole="button">
                <Text style={{ color: c.info, fontWeight: '600' }}>
                  {settings.lastCalibratedAt ? 'Recalibrate' : 'Open Calibration'}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleShareLog}
                style={[styles.button, styles.fullButton, { borderColor: c.bd2, marginTop: 8 }]}
                accessibilityRole="button">
                <Text style={{ color: c.tx2, fontWeight: '600' }}>Share Calibration Log</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: '500', marginBottom: 6 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8, marginTop: 20 },
  card: { borderRadius: radii.lg, borderWidth: 1, padding: 16 },
  fieldBlock: { paddingVertical: 12 },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  stepButton: { width: 40, height: 40, borderWidth: 1.5, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: { flex: 1, borderWidth: 1.5, borderRadius: radii.lg, paddingVertical: 12, alignItems: 'center' },
  fullButton: { flex: 0, marginTop: 14 },
});
