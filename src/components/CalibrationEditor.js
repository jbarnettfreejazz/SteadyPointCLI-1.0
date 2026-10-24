import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, TextInput, Switch } from 'react-native';
import { radii } from '../utils/theme';
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

// THIRTY-SIXTH follow-up: the calibration edit form, shared by Settings >
// Calibration (context 'settings') and the in-session "Edit Calibration
// Settings" dialog on the Recording screen (context 'session'), so the two
// can't drift apart. Four number fields with − / + buttons, the band
// filtering switch, validation from utils/calibrationLimits.js, Save /
// Cancel and Restore defaults. Save asks for confirmation (the wording
// depends on the context) and then calls onSave(patch) with the rounded
// values and bandFilterEnabled. onDirtyChange reports unsaved edits.

const CONFIRM = {
  settings: {
    scale: 'Past sessions will be shown on the new full scale and noise floor.',
    band: 'Band changes apply to new sessions only. Past sessions keep the band they were measured with, and Analytics marks where it changed.',
  },
  session: {
    intro: 'Applies right away and becomes your saved calibration.',
    scale: 'Earlier readings in this session will be shown on the new full scale and noise floor.',
    band: 'Readings before now keep the band they were measured with. The change is marked on this session’s chart.',
  },
};

export function confirmationLines(context, changes) {
  const text = CONFIRM[context] || CONFIRM.settings;
  const lines = [];
  if (changes.scale) lines.push(text.scale);
  if (changes.band) lines.push(text.band);
  if (lines.length && text.intro) lines.unshift(text.intro);
  return lines;
}

export default function CalibrationEditor({ settings, onSave, onCancel, onDirtyChange, c, context = 'settings' }) {
  const [entries, setEntries] = useState(() => entriesFromSettings(settings));
  const [filterOn, setFilterOn] = useState(!!settings.bandFilterEnabled);

  const check = validateCalibration(entries);
  const changes = check.valid ? describeChanges(settings, check.values, filterOn) : { scale: false, band: false };
  const saved = entriesFromSettings(settings);
  const dirty = CALIBRATION_FIELDS.some((f) => entries[f.key] !== saved[f.key]) || filterOn !== !!settings.bandFilterEnabled;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const setEntry = (key, text) => setEntries((prev) => ({ ...prev, [key]: text }));

  const restoreDefaults = () => {
    const out = {};
    for (const f of CALIBRATION_FIELDS) out[f.key] = formatValue(f.key, CALIBRATION_DEFAULTS[f.key]);
    setEntries(out);
    setFilterOn(CALIBRATION_DEFAULTS.bandFilterEnabled);
  };

  const handleSave = () => {
    if (!check.valid || !dirty) return;
    const lines = confirmationLines(context, changes);
    if (lines.length === 0) {
      // Only formatting changed (e.g. "1" -> "1.00"): nothing to save.
      onCancel?.();
      return;
    }
    Alert.alert('Save calibration?', lines.join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: () => onSave({ ...check.values, bandFilterEnabled: filterOn }) },
    ]);
  };

  const canSave = check.valid && dirty;

  return (
    <View>
      {CALIBRATION_FIELDS.map((f, i) => (
        <View key={f.key} style={[styles.fieldBlock, i > 0 && { borderTopWidth: 1, borderColor: c.bd3 }]}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1 }}>{f.label}</Text>
          <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>{f.help}</Text>
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
                { borderColor: check.errors[f.key] ? c.danger : c.bd3, color: c.tx1, backgroundColor: c.bg1 },
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
        </View>
      ))}

      <View style={[styles.fieldBlock, { borderTopWidth: 1, borderColor: c.bd3 }]}>
        <View style={styles.fieldHeader}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.tx1, flex: 1 }}>Band filtering</Text>
          <Switch value={filterOn} onValueChange={setFilterOn} trackColor={{ true: c.info }} accessibilityLabel="Band filtering" />
        </View>
        <Text style={{ fontSize: 12, color: c.tx3, lineHeight: 17, marginTop: 2 }}>
          {filterOn
            ? 'Intensity counts only motion within the tremor band, filtering out slower, voluntary movement.'
            : 'Intensity counts motion at all frequencies. The tremor band isn’t applied.'}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => onCancel?.()}
          style={[styles.button, { borderColor: c.bd2, backgroundColor: c.bg1 }]}
          accessibilityRole="button">
          <Text style={{ color: c.tx2, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.button, { borderColor: c.info, backgroundColor: canSave ? c.info : c.bg1 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}>
          <Text style={{ color: canSave ? '#ffffff' : c.tx3, fontWeight: '600' }}>Save</Text>
        </Pressable>
      </View>
      <Pressable onPress={restoreDefaults} style={{ alignSelf: 'center', marginTop: 12 }} hitSlop={8}>
        <Text style={{ color: c.info, fontSize: 13 }}>Restore defaults</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
