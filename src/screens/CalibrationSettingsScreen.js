import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Switch } from 'react-native';
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
  formatCeiling,
  guardrailsDisabled,
  noiseFloorWithGuardrails,
  NOISE_FLOOR_MAX_G,
  NOISE_FLOOR_MAX_UNGUARDED_G,
} from '../utils/calibrationLimits';
import CalibrationEditor from '../components/CalibrationEditor';
import { go } from '../navigation/go';

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

// SIXTY-FOURTH follow-up: what the info button next to Disable Guardrails says.
export const GUARDRAILS_INFO =
  `For advanced users. With guardrails on, the noise floor can be set up to ${NOISE_FLOOR_MAX_G.toFixed(3)} g. ` +
  `Turning this on lets you raise it to 10% of your full scale range (up to ${NOISE_FLOOR_MAX_UNGUARDED_G.toFixed(3)} g ` +
  'with a full scale of 4.00 g).\n\n' +
  'Motion at or below the noise floor reads as intensity 0, so a high noise floor can hide a mild tremor ' +
  'entirely: readings and sound stay at 0 until motion rises above it.\n\n' +
  `Turning guardrails back on lowers a noise floor above ${NOISE_FLOOR_MAX_G.toFixed(3)} g to ${NOISE_FLOOR_MAX_G.toFixed(3)} g.`;

function lastSetNote(settings) {
  const source = settings.calibrationSource || (settings.lastCalibratedAt ? 'wizard' : null);
  const when = dateFromIso(settings.calibrationSetAt || (source === 'wizard' ? settings.lastCalibratedAt : null));
  if (source === 'manual') return `Last set manually${when ? ` on ${when}` : ''}.`;
  if (source === 'default') return `Using the default values${when ? ` (chosen on ${when})` : ''}.`; // FORTIETH follow-up
  if (source === 'wizard') {
    // THIRTY-NINTH follow-up: note when level 100 came from a brief peak.
    const brief = settings.calibrationPeakHeld === false ? ', from a brief peak' : '';
    return `Last set by the calibration wizard${when ? ` on ${when}` : ''}${brief}.`;
  }
  return 'Using the default values.';
}

export default function CalibrationSettingsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const settings = state.settings;

  const [editing, setEditing] = useState(false);
  // Remounting the editor (new key) restarts it from the saved values.
  const [editorKey, setEditorKey] = useState(0);

  // Ask before leaving with unsaved edits (back button or swipe).
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((d) => {
    dirtyRef.current = d;
  }, []);
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
    setEditorKey((k) => k + 1);
    setEditing(true);
  };

  const stopEditing = () => {
    dirtyRef.current = false;
    setEditing(false);
  };

  const handleSave = (patch) => {
    actions.updateSettings({
      ...patch,
      calibrationSource: 'manual',
      calibrationSetAt: new Date().toISOString(),
    });
    stopEditing();
  };

  // SIXTY-FOURTH follow-up: Disable Guardrails. Saved right away (it's a
  // setting, not a calibration value). Turning it off (guardrails back on)
  // lowers the noise floor to min(floor, 0.100 g) if needed, after asking.
  const unguarded = guardrailsDisabled(settings);
  const setGuardrailsDisabled = (on) => {
    if (on) {
      actions.updateSettings({ calibrationGuardrailsDisabled: true });
      return;
    }
    const next = noiseFloorWithGuardrails(settings);
    if (next == null) {
      actions.updateSettings({ calibrationGuardrailsDisabled: false });
      return;
    }
    Alert.alert(
      'Turn guardrails back on?',
      `Your noise floor will be lowered from ${formatValue('noiseFloorG', settings.noiseFloorG)} g to ` +
        `${formatValue('noiseFloorG', next)} g, the most allowed with guardrails on. Past sessions will be shown on the new noise floor.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn On Guardrails',
          onPress: () =>
            actions.updateSettings({
              calibrationGuardrailsDisabled: false,
              noiseFloorG: next,
              calibrationSource: 'manual',
              calibrationSetAt: new Date().toISOString(),
            }),
        },
      ],
    );
  };
  const showGuardrailsInfo = () => Alert.alert('Disable Guardrails', GUARDRAILS_INFO, [{ text: 'OK' }]);

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
        <Pressable onPress={() => navigation.goBack()} style={styles.backRow} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: c.tx2, fontSize: 18, marginRight: 6 }}>←</Text>
          <Text style={{ color: c.tx2, fontSize: 14 }}>Settings</Text>
        </Pressable>
        <Text style={[styles.h1, { color: c.tx1 }]}>Calibration</Text>
        <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 16 }}>
          These values control how SteadyPoint turns your movement into an intensity reading.
        </Text>

        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          {editing ? (
            <CalibrationEditor
              key={editorKey}
              settings={settings}
              onSave={handleSave}
              onCancel={stopEditing}
              onDirtyChange={onDirtyChange}
              c={c}
              context="settings"
            />
          ) : (
            <>
              {CALIBRATION_FIELDS.map((f, i) => (
                <View key={f.key} style={[styles.fieldBlock, i > 0 && { borderTopWidth: 1, borderColor: c.bd3 }]}>
                  <View style={styles.fieldHeader}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1, flex: 1 }}>{f.label}</Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1 }}>
                      {formatValue(f.key, settings[f.key] ?? CALIBRATION_DEFAULTS[f.key])} {f.unit}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>{f.help}</Text>
                </View>
              ))}
              <View style={[styles.fieldBlock, { borderTopWidth: 1, borderColor: c.bd3 }]}>
                <View style={styles.fieldHeader}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1, flex: 1 }}>Band filtering</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: settings.bandFilterEnabled ? c.success : c.tx3 }}>
                    {settings.bandFilterEnabled ? 'On' : 'Off'}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>
                  {settings.bandFilterEnabled
                    ? 'Intensity counts only motion within the tremor band, filtering out slower, voluntary movement.'
                    : 'Intensity counts motion at all frequencies. The tremor band isn’t applied.'}
                </Text>
              </View>
              {/* FIFTIETH follow-up: optional upper intensity limit (sound only) */}
              <View style={[styles.fieldBlock, { borderTopWidth: 1, borderColor: c.bd3 }]}>
                <View style={styles.fieldHeader}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1, flex: 1 }}>Upper limit</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: settings.intensityCeilingG ? c.tx1 : c.tx3 }}>
                    {formatCeiling(settings.intensityCeilingG)}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>
                  {settings.intensityCeilingG
                    ? 'Sound goes silent when intensity is above this. Doesn’t change readings.'
                    : 'Off: intensity above full scale plays at full volume.'}
                </Text>
              </View>
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
                onPress={() => go(navigation, 'calibration', { fromWelcome: false })}
                style={[styles.button, styles.fullButton, { borderColor: c.info }]}
                accessibilityRole="button">
                <Text style={{ color: c.info, fontWeight: '600' }}>
                  {settings.lastCalibratedAt ? 'Recalibrate' : 'Calibrate' /* FIFTY-FIFTH follow-up: was 'Open Calibration' */}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleShareLog}
                style={[styles.button, styles.fullButton, { borderColor: c.bd2, marginTop: 8 }]}
                accessibilityRole="button">
                <Text style={{ color: c.tx2, fontWeight: '600' }}>Share Calibration Log</Text>
              </Pressable>
            </View>

            {/* SIXTY-FOURTH follow-up: Disable Guardrails (advanced). Hidden
                while editing values, like the wizard card above. */}
            <Text style={[styles.sectionLabel, { color: c.tx3 }]}>ADVANCED</Text>
            <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
              <View style={styles.fieldHeader}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1 }}>Disable Guardrails</Text>
                <Pressable
                  onPress={showGuardrailsInfo}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="About Disable Guardrails"
                  style={[styles.infoButton, { borderColor: c.info }]}>
                  <Text style={{ color: c.info, fontSize: 13, fontWeight: '700', lineHeight: 16 }}>i</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Switch
                  value={unguarded}
                  onValueChange={setGuardrailsDisabled}
                  trackColor={{ true: c.warning }}
                  accessibilityLabel="Disable Guardrails"
                />
              </View>
              <Text style={{ fontSize: 12, color: unguarded ? c.warning : c.tx3, lineHeight: 17, marginTop: 4 }}>
                {unguarded
                  ? `On: noise floor can be up to 10% of full scale (at most ${NOISE_FLOOR_MAX_UNGUARDED_G.toFixed(3)} g).`
                  : `Off: noise floor up to ${NOISE_FLOOR_MAX_G.toFixed(3)} g and at most 10% of full scale.`}
              </Text>
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
  button: { flex: 1, borderWidth: 1.5, borderRadius: radii.lg, paddingVertical: 12, alignItems: 'center' },
  fullButton: { flex: 0, marginTop: 14 },
  infoButton: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
