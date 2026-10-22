import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { MedianIntensityRing, TimeInBands } from '../components/IntensityDisplay';
import { sessionIntensity, intensityHeadline, sessionTrace, sessionReduction, displayScale } from '../utils/intensityStats';
import IntensityChart from '../components/IntensityChart';
import { persistSave } from '../services/persistence';
import { saveSetupAsCustomSession } from '../services/sessionLogic';
import { describeCustomSession } from '../utils/customSessions';

export default function SummaryScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const r = state.results;
  const [note, setNote] = useState('');
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  // TWENTY-FOURTH follow-up: "Save this setup as a custom session?" card —
  // shown only when endSession() set results.saveOffer (session started from
  // Session setup, not already saved, no matching custom session).
  const [saveCard, setSaveCard] = useState('offer'); // 'offer' | 'dismissed' | 'saved'
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savedName, setSavedName] = useState('');

  // state.scoreAnim is toggled true ~450ms after arriving here by
  // endSession() in sessionLogic.js, driving the ring's fill-in.

  if (!r) {
    navigation.navigate('home');
    return null;
  }

  // THIRTIETH follow-up: same current-scale display as everywhere else
  // (normally identical — results were just measured on these settings).
  const scale = displayScale(state.settings);
  const intensity = sessionIntensity(r, scale);
  const reduction = sessionReduction(r, scale);

  const insight =
    reduction >= 30
      ? `Your tremor intensity fell ${reduction}% — a strong parasympathetic response. Consistent practice deepens this effect.`
      : reduction >= 15
      ? `A ${reduction}% reduction in tremor intensity. Your nervous system is responding. Keep building the habit.`
      : 'Early in your practice. Even small reductions train the neural pathways that lead to larger shifts over time.';

  const stats = [
    { label: 'DOMINANT FREQ', val: typeof r.peakFreq === 'number' && r.peakFreq > 0 ? `${r.peakFreq.toFixed(1)} Hz` : '—', sub: r.peakFreq > 0 ? 'peak signal' : 'none detected', hi: false },
    { label: 'DURATION', val: `${r.duration} min`, sub: 'session length', hi: false },
  ];

  const openNoteModal = () => {
    setNoteDraft(note); // start the draft from whatever's already committed
    setNoteModalVisible(true);
  };

  const saveNoteDraft = () => {
    setNote(noteDraft.trim());
    setNoteModalVisible(false);
  };

  const cancelNoteDraft = () => {
    setNoteModalVisible(false); // discard noteDraft — committed `note` is untouched
  };

  const openSaveModal = () => {
    setSaveError('');
    setSaveModalVisible(true);
  };

  const confirmSaveSetup = async () => {
    const result = await saveSetupAsCustomSession({ state, actions, setup: r.saveOffer, name: nameDraft });
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSavedName(nameDraft.trim());
    setSaveCard('saved');
    setSaveModalVisible(false);
  };

  const handleReturnHome = async () => {
    const trimmed = note.trim();
    if (trimmed && r.sessionId != null) {
      actions.updateSession(r.sessionId, { note: trimmed });
      // Compute the post-update snapshot explicitly rather than reading
      // state.allSessions again — the dispatch above hasn't been applied
      // to the store yet at this point in the function (dispatch is async).
      const nextAllSessions = state.allSessions.map((s) => (s.id === r.sessionId ? { ...s, note: trimmed } : s));
      await persistSave({ ...state, allSessions: nextAllSessions });
    }
    navigation.navigate('home');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={{ fontSize: 10, letterSpacing: 1, color: c.tx3, marginBottom: 4 }}>SESSION COMPLETE</Text>
        <Text style={[styles.headline, { color: c.tx1 }]}>
          {intensityHeadline(intensity)}
        </Text>

        {/* TWENTY-SIXTH follow-up: median intensity + time in each band
            replace the SteadyPoint Score ring. */}
        <MedianIntensityRing info={intensity} c={c} animate={state.scoreAnim} />
        <TimeInBands info={intensity} c={c} />

        <View style={styles.statsGrid}>
          {stats.map((s) => (
            <View key={s.label} style={[styles.statBox, { backgroundColor: c.bg2 }]}>
              <Text style={{ fontSize: 10, letterSpacing: 0.5, color: c.tx3, marginBottom: 4 }}>{s.label}</Text>
              <Text style={{ fontSize: 20, fontWeight: '500', color: s.hi ? c.success : c.tx1, marginBottom: 2 }}>{s.val}</Text>
              <Text style={{ fontSize: 11, color: c.tx3 }}>{s.sub}</Text>
            </View>
          ))}
        </View>

        <View style={styles.chartWrap}>
          <IntensityChart trace={sessionTrace(r, scale)} durationSec={r.duration * 60} colors={c} />
        </View>

        {r.samples > 0 && (
          <View style={[styles.samplesRow, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 12, color: c.tx3 }}>
              {r.samples.toLocaleString()} samples captured · {r.duration} min
            </Text>
          </View>
        )}

        <View style={[styles.insightBox, { backgroundColor: c.bgInfo, borderColor: c.bdInfo }]}>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 20 }}>{insight}</Text>
        </View>

        {!!r.saveOffer && saveCard === 'offer' && (
          <View style={[styles.saveCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: c.tx1, marginBottom: 4 }}>Save this setup?</Text>
            <Text style={{ fontSize: 12, color: c.tx2, marginBottom: 12 }}>
              Save it as a custom session to start it again from Home with one tap.
            </Text>
            <Text style={{ fontSize: 12, color: c.tx3, marginBottom: 14 }}>{describeCustomSession(r.saveOffer)}</Text>
            <View style={styles.saveCardButtons}>
              <Pressable onPress={openSaveModal} style={[styles.saveButton, { backgroundColor: c.tx1 }]}>
                <Text style={{ color: c.bg1, fontWeight: '700', fontSize: 13 }}>Save as custom session</Text>
              </Pressable>
              <Pressable onPress={() => setSaveCard('dismissed')} hitSlop={8} style={styles.notNowButton}>
                <Text style={{ color: c.tx2, fontSize: 13 }}>Not now</Text>
              </Pressable>
            </View>
          </View>
        )}

        {saveCard === 'saved' && (
          <View style={[styles.saveCard, { backgroundColor: c.bgSuccess, borderColor: c.bd3 }]}>
            <Text style={{ fontSize: 13, color: c.success, fontWeight: '600' }}>
              ✓ Saved "{savedName}" to Custom Sessions
            </Text>
          </View>
        )}

        <Text style={[styles.label, { color: c.tx3 }]}>NOTE</Text>
        <Pressable onPress={openNoteModal} style={[styles.noteRow, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          {note ? (
            <Text numberOfLines={3} style={{ fontSize: 14, color: c.tx1, lineHeight: 20 }}>
              {note}
            </Text>
          ) : (
            <Text style={{ fontSize: 14, color: c.tx3 }}>Add context about this session (optional)</Text>
          )}
        </Pressable>

        <Pressable onPress={handleReturnHome} style={[styles.primaryButton, { backgroundColor: c.tx1 }]}>
          <Text style={{ color: c.bg1, fontWeight: '700' }}>Return to home</Text>
        </Pressable>
      </ScrollView>

      {/* Dedicated full-screen note editor — the note field previously sat
          inline near the bottom of a scrolling page, and KeyboardAvoidingView
          alone wasn't enough to keep it visible above the keyboard. Putting
          the input in its own screen with the field pinned near the TOP
          gives it room the keyboard can never reach. */}
      <Modal visible={noteModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={cancelNoteDraft}>
        <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <Pressable onPress={cancelNoteDraft} hitSlop={8}>
                <Text style={{ fontSize: 15, color: c.tx2 }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.tx1 }}>Session Note</Text>
              <Pressable onPress={saveNoteDraft} hitSlop={8}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.info }}>Save</Text>
              </Pressable>
            </View>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Add context about this session — how you felt, what you were doing, anything worth remembering"
              placeholderTextColor={c.tx3}
              multiline
              autoFocus
              textAlignVertical="top"
              style={[styles.modalTextarea, { color: c.tx1, backgroundColor: c.bg1 }]}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Name entry for "Save as custom session" — its own sheet with the
          field near the top, same reason as the note editor above. */}
      <Modal
        visible={saveModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSaveModalVisible(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setSaveModalVisible(false)} hitSlop={8}>
                <Text style={{ fontSize: 15, color: c.tx2 }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.tx1 }}>Custom Session</Text>
              <Pressable onPress={confirmSaveSetup} disabled={!nameDraft.trim()} hitSlop={8}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: nameDraft.trim() ? c.info : c.tx3 }}>Save</Text>
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 18 }}>
              <Text style={[styles.label, { color: c.tx3, marginTop: 8 }]}>SESSION NAME</Text>
              <TextInput
                value={nameDraft}
                onChangeText={(t) => {
                  setNameDraft(t);
                  if (saveError) setSaveError('');
                }}
                placeholder="e.g. Morning meditation"
                placeholderTextColor={c.tx3}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => nameDraft.trim() && confirmSaveSetup()}
                style={[styles.nameInput, { color: c.tx1, borderColor: c.bd3, backgroundColor: c.bg1 }]}
              />
              {!!saveError && <Text style={{ color: c.danger, fontSize: 12, marginTop: 8 }}>{saveError}</Text>}
              {!!r.saveOffer && (
                <Text style={{ color: c.tx3, fontSize: 12, marginTop: 12 }}>{describeCustomSession(r.saveOffer)}</Text>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  headline: { fontSize: 20, fontWeight: '500', marginBottom: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  chartWrap: { marginBottom: 14 },
  statBox: { width: '47%', borderRadius: radii.md, padding: 12 },
  samplesRow: { padding: 10, borderRadius: radii.md, marginBottom: 14, alignItems: 'center' },
  insightBox: { borderLeftWidth: 2, padding: 14, borderRadius: radii.md, marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  noteRow: { borderWidth: 1, borderRadius: radii.lg, padding: 14, minHeight: 52, justifyContent: 'center', marginBottom: 20 },
  primaryButton: { paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalTextarea: { flex: 1, padding: 18, fontSize: 16, lineHeight: 24 },
  saveCard: { borderWidth: 1, borderRadius: radii.lg, padding: 14, marginBottom: 20 },
  saveCardButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  saveButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: radii.md },
  notNowButton: { paddingVertical: 10 },
  nameInput: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
});
