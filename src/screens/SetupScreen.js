import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, Switch, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { startSession, savePinnedSession, resetSetupConfig } from '../services/sessionLogic';
import { pickGuideAudioFile, deleteGuideAudioFile } from '../services/guideAudioPicker';

const ACTIVITY_TYPES = ['Meditative', 'Engaged', 'Active'];
const DURATIONS = [5, 10, 20];

// Being reconsidered for a later version — flip to true to bring the
// pre-session note field back. state.config.activityNote and everything
// depending on it is untouched either way.
const FEATURE_SETUP_NOTE = false;

export default function SetupScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const [pickingAudio, setPickingAudio] = useState(false);

  const isSaveMode = state.setupMode === 'save';
  const isEditing = state.editingPinnedId !== null;
  const notConnected = !state.isConnected;
  const needsAudio = state.guideMediaSource === 'phone' && !state.guideMediaName;
  const disabled = (notConnected || needsAudio) && !isSaveMode;
  const btnLabel = notConnected ? 'Connect device to begin' : needsAudio ? 'Select audio to begin' : 'Begin session';
  const hasId = !!(state.config.customName || '').trim() || !!(state.config.activityNote || '').trim();
  const atCapacity = state.pinnedSessions.length >= 3 && !isEditing;

  const handleBack = () => {
    actions.setSetupMode('start');
    navigation.navigate('home');
  };

  const handleCancel = () => {
    actions.setSetupMode('start');
    actions.updateConfig({ customName: '' });
    navigation.navigate('home');
  };

  const handleToggleGuideCard = async (source) => {
    if (state.guideMediaSource === source) {
      if (state.guideMediaPath) await deleteGuideAudioFile(state.guideMediaPath);
      actions.clearGuideMedia();
      return;
    }
    if (source === 'phone') {
      await handlePickAudio();
    } else {
      actions.clearGuideMedia();
    }
  };

  const handlePickAudio = async () => {
    setPickingAudio(true);
    try {
      const picked = await pickGuideAudioFile();
      if (picked) {
        actions.setGuideMedia('phone', picked.name, picked.path);
      }
    } catch (e) {
      Alert.alert('Could not select audio', e.message || 'Please try again.');
    } finally {
      setPickingAudio(false);
    }
  };

  const handleClearAudio = async () => {
    if (state.guideMediaPath) await deleteGuideAudioFile(state.guideMediaPath);
    actions.clearGuideMedia();
  };

  const chip = (selected) => [
    styles.chip,
    { backgroundColor: selected ? c.tx1 : c.bg2, borderColor: selected ? c.tx1 : c.bd3 },
  ];
  const chipText = (selected) => ({ color: selected ? c.bg1 : c.tx1, fontWeight: '600', fontSize: 13 });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={handleBack} style={styles.backRow} hitSlop={8}>
          <Text style={{ color: c.tx2, fontSize: 18, marginRight: 6 }}>←</Text>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Back</Text>
        </Pressable>

        <Text style={[styles.h1, { color: c.tx1 }]}>
          {isSaveMode ? (isEditing ? 'Edit custom session' : 'New custom session') : 'Session setup'}
        </Text>
        <Text style={[styles.h2, { color: c.tx2 }]}>
          {isSaveMode ? 'Configure and pin to Home' : 'Configure your practice'}
        </Text>

        {isSaveMode && (
          <View style={styles.section}>
            <Text style={[styles.label, { color: c.tx3 }]}>SESSION NAME</Text>
            <TextInput
              value={state.config.customName}
              onChangeText={(text) => actions.updateConfig({ customName: text })}
              placeholder="e.g. Morning meditation"
              placeholderTextColor={c.tx3}
              style={[styles.input, { color: c.tx1, borderColor: c.bd3, backgroundColor: c.bg1 }]}
            />
          </View>
        )}

        {notConnected && !isSaveMode && (
          <View style={[styles.warningBanner, { backgroundColor: c.bgWarning }]}>
            <Text style={{ color: c.warning, fontSize: 13, flex: 1 }}>
              Connect your M5Stick from the home screen before starting.
            </Text>
          </View>
        )}

        {/* FEEDBACK TYPE */}
        <Text style={[styles.label, { color: c.tx3 }]}>FEEDBACK TYPE</Text>
        <View style={[styles.toggleRow, { backgroundColor: c.bg2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: c.tx1 }}>Sound feedback</Text>
            <Text style={{ fontSize: 11, color: c.tx2, marginTop: 2 }}>Visual feedback is always included</Text>
          </View>
          <Switch
            value={state.config.feedbackType === 'both' || state.config.feedbackType === 'audio'}
            onValueChange={(on) => actions.updateConfig({ feedbackType: on ? 'both' : 'visual' })}
            trackColor={{ false: c.bd2, true: c.info }}
          />
        </View>

        {/* GUIDE */}
        <Text style={[styles.label, { color: c.tx3, marginTop: 20 }]}>GUIDE</Text>
        <View style={styles.guideGrid}>
          <Pressable
            onPress={() => handleToggleGuideCard('phone')}
            disabled={pickingAudio}
            style={[styles.guideCard, { backgroundColor: c.bg2, borderColor: state.guideMediaSource === 'phone' ? c.info : c.bd3 }]}>
            <Text style={{ fontSize: 12, fontWeight: '500', color: state.guideMediaSource === 'phone' ? c.info : c.tx1 }}>
              From my phone
            </Text>
            <Text style={{ fontSize: 10, color: c.tx2, marginTop: 2 }}>Local audio file</Text>
          </Pressable>
          <Pressable
            onPress={() => handleToggleGuideCard(null)}
            style={[styles.guideCard, { backgroundColor: c.bg2, borderColor: !state.guideMediaSource ? c.info : c.bd3 }]}>
            <Text style={{ fontSize: 12, fontWeight: '500', color: !state.guideMediaSource ? c.info : c.tx1 }}>No guide</Text>
            <Text style={{ fontSize: 10, color: c.tx2, marginTop: 2 }}>Observation only</Text>
          </Pressable>
        </View>

        {pickingAudio && (
          <View style={styles.pickingRow}>
            <ActivityIndicator size="small" color={c.tx2} />
            <Text style={{ color: c.tx2, fontSize: 12, marginLeft: 8 }}>Opening file picker…</Text>
          </View>
        )}

        {!pickingAudio && state.guideMediaSource === 'phone' && state.guideMediaName && (
          <View style={[styles.guideDetail, { backgroundColor: c.bg2 }]}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500', color: c.tx1 }}>
                {state.guideMediaName}
              </Text>
              <Text style={{ fontSize: 11, color: c.success }}>Ready · will play when session begins</Text>
            </View>
            <Pressable onPress={handleClearAudio} hitSlop={8}>
              <Text style={{ color: c.tx3, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
        )}

        {!pickingAudio && state.guideMediaSource === 'phone' && !state.guideMediaName && (
          <Pressable onPress={handlePickAudio} style={[styles.guideDetail, { backgroundColor: c.bgInfo }]}>
            <Text style={{ fontSize: 13, color: c.info }}>Tap to select an audio file from your phone</Text>
          </Pressable>
        )}

        {/* ACTIVITY TYPE */}
        <Text style={[styles.label, { color: c.tx3, marginTop: 20 }]}>ACTIVITY TYPE</Text>
        <View style={styles.chipRow}>
          {ACTIVITY_TYPES.map((a) => {
            const val = a.toLowerCase();
            const selected = state.config.activityType === val;
            return (
              <Pressable key={a} onPress={() => actions.updateConfig({ activityType: val })} style={chip(selected)}>
                <Text style={chipText(selected)}>{a}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* NOTE — hidden for now (FEATURE_SETUP_NOTE), being reconsidered
            for a later version. state.config.activityNote and everything
            that reads it (auto-pin naming, session label fallback) is
            untouched — this only hides the input. */}
        {FEATURE_SETUP_NOTE && (
          <TextInput
            value={state.config.activityNote}
            onChangeText={(text) => actions.updateConfig({ activityNote: text })}
            placeholder="Add a note — what will you be doing? (optional)"
            placeholderTextColor={c.tx3}
            multiline
            style={[styles.textarea, { color: c.tx1, borderColor: c.bd3, backgroundColor: c.bg1 }]}
          />
        )}

        {/* DURATION */}
        <Text style={[styles.label, { color: c.tx3 }]}>DURATION</Text>
        <View style={styles.chipRow}>
          {DURATIONS.map((d) => (
            <Pressable key={d} onPress={() => actions.updateConfig({ duration: d })} style={chip(state.config.duration === d)}>
              <Text style={chipText(state.config.duration === d)}>{d} min</Text>
            </Pressable>
          ))}
        </View>

        {isSaveMode ? (
          <>
            {!hasId && (
              <Text style={{ fontSize: 12, color: c.tx3, textAlign: 'center', marginBottom: 10 }}>
                Add a name or note to save to Home
              </Text>
            )}
            <Pressable
              onPress={() => savePinnedSession({ state, actions, navigation })}
              disabled={!hasId}
              style={[styles.primaryButton, { backgroundColor: hasId ? c.tx1 : c.bg3, opacity: hasId ? 1 : 0.6 }]}>
              <Text style={{ color: hasId ? c.bg1 : c.tx3, fontWeight: '700', fontSize: 15 }}>
                {isEditing ? 'Update on Home' : 'Save to Home'}
              </Text>
            </Pressable>
            <Pressable onPress={handleCancel} style={[styles.secondaryButton, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
              <Text style={{ color: c.tx1, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => startSession({ state, actions, navigation })}
              disabled={disabled}
              style={[styles.primaryButton, { backgroundColor: disabled ? c.bg3 : c.tx1, opacity: disabled ? 0.6 : 1 }]}>
              <Text style={{ color: disabled ? c.tx3 : c.bg1, fontWeight: '700', fontSize: 15 }}>{btnLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                actions.setSetupMode('save');
                actions.setEditingPinnedId(null);
              }}
              disabled={atCapacity}
              style={[styles.secondaryButton, { backgroundColor: c.bg2, borderColor: c.bd2, opacity: atCapacity ? 0.5 : 1 }]}>
              <Text style={{ color: c.tx1, fontWeight: '700' }}>Save to Home{atCapacity ? ' (full)' : ''}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: '500', marginBottom: 4 },
  h2: { fontSize: 13, marginBottom: 20 },
  section: { marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: radii.lg, padding: 12, fontSize: 14 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radii.lg, marginBottom: 16 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
    padding: 14,
    marginBottom: 8,
  },
  guideGrid: { flexDirection: 'row', marginHorizontal: -4 },
  guideCard: { flex: 1, marginHorizontal: 4, borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  pickingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  guideDetail: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.lg, padding: 12, marginTop: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginHorizontal: 4, marginBottom: 8 },
  textarea: { borderWidth: 1, borderRadius: radii.lg, padding: 12, fontSize: 13, minHeight: 72, textAlignVertical: 'top', marginBottom: 20 },
  primaryButton: { paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center', marginBottom: 12 },
  secondaryButton: { paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center', borderWidth: 1 },
});
